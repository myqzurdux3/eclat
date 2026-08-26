import { EXT_CONTROL_EFFECT } from '../shared/types'
import type { Color, DeviceState, EffectPalette, PanelLayout, SourceId } from '../shared/types'
import { IPC_CHANNELS, type RendererDevice } from '../shared/ipc-contract'
import { SourceArbiter } from './device/arbiter'
import { NanoleafClient } from './device/client'
import { NanoleafError } from './device/errors'
import { discoverDevices, type MdnsFactory } from './device/discovery'
import { subscribeToEvents, type DeviceEvent, type EventSubscription } from './device/events'
import { pairDevice } from './device/pairing'
import { PanelStream } from './device/stream'
import { AudioCapture } from './audio/capture'
import { listAudioSources, type AudioSource } from './audio/sources'
import type { AudioFeatures } from '../shared/audio/analyser'
import type { ConfigStore, StoredDevice } from './store'
import {
  asBoolean,
  asColor,
  asColors,
  asDeviceId,
  asNumber,
  asPaintEntries,
  asSource,
  asText,
} from '../shared/ipc-guards'

export interface DeviceServiceOptions {
  store: ConfigStore
  mdnsFactory: MdnsFactory
  discoverTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  pairAttempts?: number
  /** Arbiter factory, one per device: two walls arbitrate separately. */
  arbiterFactory?: () => SourceArbiter
  /** How long a stored device has to answer before it counts as absent. */
  probeTimeoutMs?: number
  /** Injected by tests: the wait before re-opening a dead event stream. */
  retrackDelayMs?: number
  /** Injected by tests: how long `shutdown` waits on the walls. */
  shutdownTimeoutMs?: number
  /** Receives whatever the device reports of its own accord. */
  onDeviceEvent?: (event: DeviceEvent) => void
  /** Receives the analysed audio, block by block. */
  onAudioFeatures?: (features: AudioFeatures) => void
  /** Injected by tests to aim at a local UDP receiver. */
  streamFactory?: (options: { client: NanoleafClient; ip: string }) => PanelStream
}

/**
 * How long a refused stroke waits before trying again: one governor interval
 * at its 30 Hz cap, with a little room to spare.
 */
const RETRY_DELAY_MS = 40

/**
 * How long to wait before re-opening an event stream that died.
 *
 * Long enough that a wall switched off at the socket is not retried in a
 * tight loop, short enough that a Wi-Fi blip costs a few seconds of
 * deafness rather than the rest of the session.
 */
const RETRACK_DELAY_MS = 5000

/** How long quitting waits for the walls to take their effects back. */
const SHUTDOWN_TIMEOUT_MS = 3000

/**
 * The business logic behind the IPC channels. No dependency on Electron,
 * so it stays testable outside the application.
 */
export class DeviceService {
  /** Devices seen over mDNS but not yet paired, keyed by id. */
  private readonly seen = new Map<string, { name: string; ip: string; port: number; model?: string; firmware?: string }>()

  private readonly streams = new Map<string, PanelStream>()
  /** `panelId` in layout order, remembered at arming time. */
  private readonly panelIds = new Map<string, number[]>()
  /** The last colour laid on each panel, per device. */
  private readonly painted = new Map<string, Map<number, Color>>()
  private readonly arbiters = new Map<string, SourceArbiter>()
  /** Pending re-sends of a painting the rate governor refused, per device. */
  private readonly flushes = new Map<string, ReturnType<typeof setTimeout>>()
  /** What we last knew of each wall's power, to avoid re-reading it. */
  private readonly powered = new Map<string, boolean>()
  /** Pending re-openings of an event stream that died, per device. */
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly subscriptions = new Map<string, EventSubscription>()
  private audio: AudioCapture | null = null
  /**
   * A device's arbiter, created on demand.
   *
   * A shared arbiter would mean a screen sync on one wall forbade painting
   * on another: the spec's priorities hold per device, not for the whole
   * application.
   */
  private arbiter(deviceId: string): SourceArbiter {
    let arbiter = this.arbiters.get(deviceId)
    if (arbiter === undefined) {
      arbiter = this.options.arbiterFactory?.() ?? new SourceArbiter()
      this.arbiters.set(deviceId, arbiter)
    }
    return arbiter
  }

  constructor(private readonly options: DeviceServiceOptions) {}

  async discover(): Promise<RendererDevice[]> {
    const found = await discoverDevices(this.options.mdnsFactory, {
      timeoutMs: this.options.discoverTimeoutMs ?? 3000,
      sleep: this.options.sleep,
    })

    // Replaced, not merged: a wall that has left the network must stop being
    // offered for pairing, or the click runs fifteen attempts against
    // nothing and ends by blaming the user for the power button.
    this.seen.clear()

    for (const device of found) {
      this.seen.set(device.id, {
        name: device.name,
        ip: device.ip,
        port: device.port,
        model: device.model,
        firmware: device.firmware,
      })
    }

    return this.listDevices()
  }

  /**
   * Subscribes to a paired device's stream, exactly once.
   *
   * Without it, a command from the mobile app or the physical button
   * would go unnoticed and the interface would show a stale state.
   */
  private async track(deviceId: string): Promise<void> {
    if (this.options.onDeviceEvent === undefined) return
    if (this.subscriptions.has(deviceId)) return

    // Claimed before the first await: `pair()` and `watchPairedDevices()` can
    // both reach this for one device, and two subscriptions would leave one
    // of them running with nobody holding its handle.
    this.subscriptions.set(deviceId, { close: () => undefined })

    let stored
    try {
      stored = await this.stored(deviceId)
    } catch (cause) {
      this.subscriptions.delete(deviceId)
      throw cause
    }

    this.subscriptions.set(
      deviceId,
      subscribeToEvents({
        ip: stored.ip,
        port: stored.port,
        token: stored.token,
        deviceId,
        onClosed: () => this.retrack(deviceId),
        onEvent: (event) => {
          if (event.kind === 'on') this.powered.set(deviceId, Boolean(event.value))
          if (event.kind === 'effect') {
            void this.noteEffectChange(deviceId, String(event.value)).catch(() => undefined)
          }
          this.options.onDeviceEvent?.(event)
        },
      }),
    )
  }

  /**
   * Re-opens an event stream that ended on its own.
   *
   * A stream dies on a Wi-Fi blip, a controller reboot, or a wall switched
   * off at the socket. Left dead, the application stops hearing the device
   * for the rest of the session: it never learns of a power cut made on the
   * button, and it never stands down when a scene is chosen from the phone —
   * so its re-arm probe overwrites that scene ten seconds later.
   *
   * The delay keeps an unreachable wall from being retried in a tight loop.
   */
  private retrack(deviceId: string): void {
    if (!this.subscriptions.has(deviceId)) return
    this.subscriptions.delete(deviceId)

    const timer = setTimeout(() => {
      this.retries.delete(deviceId)
      void this.track(deviceId).catch(() => undefined)
    }, this.options.retrackDelayMs ?? RETRACK_DELAY_MS)

    this.retries.set(deviceId, timer)
  }

  async listDevices(): Promise<RendererDevice[]> {
    const config = await this.options.store.load()
    const merged = new Map<string, RendererDevice>()
    const moved: StoredDevice[] = []

    for (const [id, entry] of this.seen) {
      merged.set(id, { id, ...entry, paired: false })
    }

    const known = Object.values(config.devices)
    // A panel announcing itself over mDNS is alive by definition; the others
    // are asked directly, all at once so a switched-off wall costs one
    // timeout rather than one per device in a row.
    const answers = await Promise.all(
      known.map((entry) => (this.seen.has(entry.id) ? true : this.answers(entry))),
    )

    for (const [index, stored] of known.entries()) {
      if (!answers[index]) continue

      // A panel announcing itself right now is more trustworthy about its
      // own address than a value written weeks ago: a renewed DHCP lease
      // would otherwise strand the pairing for good.
      const live = this.seen.get(stored.id)
      const ip = live?.ip ?? stored.ip
      const port = live?.port ?? stored.port

      if (live !== undefined && (ip !== stored.ip || port !== stored.port)) {
        moved.push({ ...stored, ip, port })
      }

      merged.set(stored.id, {
        id: stored.id,
        name: stored.name,
        ip,
        port,
        model: live?.model,
        firmware: live?.firmware,
        paired: true,
      })
    }

    // Persisted after the loop so the next start finds the panel directly,
    // without waiting on another discovery pass.
    for (const device of moved) await this.options.store.upsertDevice(device)

    return [...merged.values()]
  }

  /**
   * Whether a stored device answers right now.
   *
   * A wall on a switched-off socket answers nothing, and listing it invites
   * the user to drive a device that cannot hear them — every command they
   * try then ends on a timeout. The pairing itself is kept: a token is only
   * obtained by holding the power button for five seconds, so discarding it
   * over a power cut would charge the user that dance every time.
   */
  private async answers(device: StoredDevice): Promise<boolean> {
    return new NanoleafClient({
      ip: device.ip,
      port: device.port,
      token: device.token,
      timeoutMs: this.options.probeTimeoutMs ?? 1500,
    }).isReachable()
  }

  async pair(deviceId: string): Promise<RendererDevice> {
    const candidate = this.seen.get(deviceId)
    if (candidate === undefined) {
      throw new NanoleafError(`Unknown device: ${deviceId}`, 404, 'error.deviceUnknown')
    }

    const token = await pairDevice({
      ip: candidate.ip,
      port: candidate.port,
      attempts: this.options.pairAttempts,
      sleep: this.options.sleep,
    })

    const stored: StoredDevice = {
      id: deviceId,
      name: candidate.name,
      ip: candidate.ip,
      port: candidate.port,
      token,
    }
    await this.options.store.upsertDevice(stored)
    void this.track(deviceId).catch(() => undefined)

    return {
      id: stored.id,
      name: stored.name,
      ip: stored.ip,
      port: stored.port,
      model: candidate.model,
      firmware: candidate.firmware,
      paired: true,
    }
  }

  async getState(deviceId: string): Promise<DeviceState> {
    return (await this.client(deviceId)).getState()
  }

  async setOn(deviceId: string, on: boolean): Promise<void> {
    await (await this.client(deviceId)).setOn(on)
    this.powered.set(deviceId, on)

    // A stream in flight restores the power it found at arming: tell it the
    // user has moved that baseline, or its release undoes this command.
    const stream = this.streams.get(deviceId)
    if (stream === undefined) return
    stream.notePower(on)

    // Switching the wall back on has to bring the painting with it. The
    // panels were chosen, the power cut them, and nothing else would ever
    // send them again — the wall would come back on showing nothing.
    if (!on) return
    await stream.arm()
    if (!(await this.sendPainted(deviceId))) this.scheduleFlush(deviceId)
  }

  /**
   * Makes sure a wall has power before anything is painted on it.
   *
   * External control lights nothing on a wall that is off. The check used to
   * live in the arming path, which was enough while a stroke lasted three
   * seconds and armed its own stream every time; now that painting holds the
   * wall the stream is already there, and a click after a power cut lit the
   * panel on screen while the room stayed dark.
   */
  private async ensureOn(deviceId: string): Promise<void> {
    if (this.powered.get(deviceId) === true) return

    const client = await this.client(deviceId)
    if (this.powered.get(deviceId) === undefined && (await client.getState()).on) {
      this.powered.set(deviceId, true)
      return
    }

    await client.setOn(true)
    this.powered.set(deviceId, true)
    this.streams.get(deviceId)?.notePower(true)
  }

  async setBrightness(deviceId: string, value: number): Promise<void> {
    await (await this.client(deviceId)).setBrightness(value)
  }

  async getLayout(deviceId: string): Promise<PanelLayout> {
    return (await this.client(deviceId)).getLayout()
  }

  async getEffectPalettes(deviceId: string): Promise<EffectPalette[]> {
    return (await this.client(deviceId)).getEffectPalettes()
  }

  /**
   * Choosing a scene explicitly hands control back to the device: any
   * running stream is cut first, otherwise the re-arm probe would restore
   * external control within ten seconds and the effect would not hold.
   */
  async selectEffect(deviceId: string, name: string): Promise<void> {
    await this.release(deviceId, { restore: false })
    await (await this.client(deviceId)).selectEffect(name)
  }

  /** Arms external control and declares the source to the arbiter. */
  async startStream(deviceId: string, source: SourceId): Promise<void> {
    const stored = await this.stored(deviceId)
    const client = new NanoleafClient({
      ip: stored.ip,
      token: stored.token,
      port: stored.port,
    })

    const existing = this.streams.get(deviceId)
    const stream =
      existing ??
      this.options.streamFactory?.({ client, ip: stored.ip }) ??
      new PanelStream({ client, ip: stored.ip })

    // Filed only once it is usable. A wall that goes quiet between the layout
    // read and the arming would otherwise leave an unarmed stream with no
    // panel ids in the map, and every later stroke would take the "already
    // streaming" branch and do nothing, for the rest of the session.
    try {
      const panelIds =
        this.panelIds.get(deviceId) ??
        (await client.getLayout()).panels.map((panel) => panel.panelId)

      await stream.arm()

      this.streams.set(deviceId, stream)
      this.panelIds.set(deviceId, panelIds)
      this.arbiter(deviceId).activate(source)
    } catch (cause) {
      if (existing === undefined) await stream.stop({ restore: false }).catch(() => undefined)
      throw cause
    }
  }

  /** Removes the source; only disarms once nobody is writing. */
  async stopStream(deviceId: string, source: SourceId): Promise<void> {
    this.arbiter(deviceId).deactivate(source)
    if (this.arbiter(deviceId).current() !== null) return

    await this.release(deviceId, { restore: true })
  }

  /**
   * Broadcasts a frame produced by the renderer. Colours are spread over
   * the panels in layout order; a shorter list is cycled. Returns `false`
   * when the source does not hold control or the maximum rate has already
   * been reached.
   */
  async sendFrame(
    deviceId: string,
    source: SourceId,
    colors: Color[],
    transitionTime?: number,
    internal = false,
  ): Promise<boolean> {
    const arbiter = this.arbiter(deviceId)
    // A stroke from the user takes the wall for a moment. The service's own
    // re-broadcasts — restoring a painting after a power-on, or a frame the
    // rate governor refused — must not: they would steal three seconds from
    // a running sync every time the wall was switched on.
    if (source === 'manual' && !internal) arbiter.touchManual()
    if (!arbiter.accepts(source)) return false

    const stream = this.streams.get(deviceId)
    const panelIds = this.panelIds.get(deviceId)
    if (stream === undefined || panelIds === undefined || colors.length === 0) return false

    return stream.send(
      panelIds.map((panelId, index) => ({ panelId, color: colors[index % colors.length]! })),
      transitionTime,
    )
  }

  /**
   * Paints a panel and rebroadcasts the whole wall: the v2 protocol has no
   * partial frame. Panels never painted stay black — their colour
   * before arming cannot be recovered.
   *
   * Arms the stream when needed: clicking a panel must be enough, with no
   * need to start a sync first.
   */
  async paintPanel(deviceId: string, panelId: number, color: Color): Promise<boolean> {
    return this.paintPanels(deviceId, [{ panelId, color }])
  }

  /**
   * Paints several panels in one frame.
   *
   * Recolouring a selection has to arrive as a single frame: sent one panel
   * at a time the rate governor would refuse all but the first, and the wall
   * would end up showing half the change.
   */
  async paintPanels(
    deviceId: string,
    entries: Array<{ panelId: number; color: Color }>,
  ): Promise<boolean> {
    if (entries.length === 0) return false

    // Before the stream takes its snapshot, so a later release leaves the
    // wall lit rather than dropping it back into the dark.
    await this.ensureOn(deviceId)

    if (!this.streams.has(deviceId)) {
      await this.startStream(deviceId, 'manual')
    }

    const panelIds = this.panelIds.get(deviceId)
    if (panelIds === undefined) return false

    let painted = this.painted.get(deviceId)
    if (painted === undefined) {
      painted = new Map<number, Color>()
      this.painted.set(deviceId, painted)
    }
    for (const entry of entries) painted.set(entry.panelId, entry.color)

    if (await this.sendPainted(deviceId, false)) return true

    // The rate governor caps the stream and refuses anything closer than its
    // interval. A stroke is not a stream frame — dropping it loses a
    // deliberate action and the panel simply never lights — so the frame is
    // sent again shortly, without making this call wait for it. Waiting here
    // would stall the caller on every write, and dragging the colour wheel
    // writes as fast as the pointer moves.
    this.scheduleFlush(deviceId)
    return true
  }

  /**
   * Broadcasts what is currently painted on a wall.
   *
   * `internal` tells the arbiter whether this is the user acting. A stroke
   * takes the wall for a moment; the service's own re-broadcasts must not,
   * or switching the wall on would steal three seconds from a running sync.
   */
  private async sendPainted(deviceId: string, internal = true): Promise<boolean> {
    const panelIds = this.panelIds.get(deviceId)
    const painted = this.painted.get(deviceId)
    if (panelIds === undefined || painted === undefined) return false

    return this.sendFrame(
      deviceId,
      'manual',
      panelIds.map((id) => painted.get(id) ?? { r: 0, g: 0, b: 0 }),
      undefined,
      internal,
    )
  }

  /**
   * Sends the painting again once the governor will have it.
   *
   * One pending flush per device is enough: it reads `painted`, so by the
   * time it fires it carries every stroke made in the meantime.
   */
  private scheduleFlush(deviceId: string): void {
    if (this.flushes.has(deviceId)) return

    this.flushes.set(
      deviceId,
      setTimeout(() => {
        this.flushes.delete(deviceId)
        void this.sendPainted(deviceId).catch(() => undefined)
      }, RETRY_DELAY_MS),
    )
  }

  async setColor(deviceId: string, hue: number, sat: number): Promise<void> {
    await (await this.client(deviceId)).setHueSat(hue, sat)
  }

  /**
   * Takes note of an effect the device announced by itself.
   *
   * Manual painting holds the wall until something takes it back, and the
   * stream's probe re-arms external control every ten seconds. Left alone
   * that probe would overwrite whatever the phone app or the physical button
   * chooses, a few seconds after every choice. The device announcing an
   * effect that is not our own external control is the signal to stand down.
   */
  async noteEffectChange(deviceId: string, effect: string): Promise<void> {
    if (effect === EXT_CONTROL_EFFECT) return
    if (!this.streams.has(deviceId)) return

    await this.release(deviceId, { restore: false })
  }

  /** Cuts a device's stream, with or without restoring its effect. */
  private async release(deviceId: string, options: { restore: boolean }): Promise<void> {
    const flush = this.flushes.get(deviceId)
    if (flush !== undefined) {
      clearTimeout(flush)
      this.flushes.delete(deviceId)
    }

    const stream = this.streams.get(deviceId)
    if (stream === undefined) return

    this.streams.delete(deviceId)
    this.panelIds.delete(deviceId)
    this.painted.delete(deviceId)
    this.arbiter(deviceId).reset()
    await stream.stop(options)
  }

  /** The machine's audio outputs; their monitors carry what is played. */
  async listAudioSources(): Promise<AudioSource[]> {
    return listAudioSources()
  }

  /**
   * Starts analysing one audio output.
   *
   * The features are pushed rather than polled: a block lasts 21 ms at
   * 48 kHz, and asking for them one at a time would cost more than the
   * analysis itself.
   */
  startAudioCapture(sourceId: number): void {
    if (this.options.onAudioFeatures === undefined) return
    this.audio ??= new AudioCapture({
      onFeatures: (features) => this.options.onAudioFeatures?.(features),
    })
    this.audio.start(sourceId)
  }

  stopAudioCapture(): void {
    this.audio?.stop()
  }

  /** Gives every device its effect back. Called on quit and on signal. */
  /** Opens event tracking for every device already paired. */
  async watchPairedDevices(): Promise<void> {
    const config = await this.options.store.load()
    for (const stored of Object.values(config.devices)) {
      await this.track(stored.id).catch(() => undefined)
    }
  }

  async shutdown(): Promise<void> {
    this.audio?.stop()
    this.audio = null

    for (const timer of this.retries.values()) clearTimeout(timer)
    this.retries.clear()

    for (const subscription of this.subscriptions.values()) subscription.close()
    this.subscriptions.clear()

    for (const flush of this.flushes.values()) clearTimeout(flush)
    this.flushes.clear()

    const streams = [...this.streams.values()]
    this.streams.clear()
    this.panelIds.clear()
    this.painted.clear()
    this.arbiters.clear()
    this.powered.clear()
    this.seen.clear()

    // Restoring a wall costs two REST round trips, and an unreachable one
    // costs the client's full timeout twice over. Quitting must not wait on a
    // device that has already gone: the panels of a wall we cannot reach are
    // not ours to put back anyway.
    await Promise.race([
      Promise.all(streams.map((stream) => stream.stop())),
      new Promise((resolve) =>
        setTimeout(resolve, this.options.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS),
      ),
    ])
  }

  private async stored(deviceId: string): Promise<StoredDevice> {
    const config = await this.options.store.load()
    const stored = config.devices[deviceId]
    if (stored === undefined) {
      throw new NanoleafError(`Device not paired: ${deviceId}`, 401, 'error.deviceUnpaired')
    }
    return stored
  }

  /** Builds an authenticated client; the token stays in the main process. */
  private async client(deviceId: string): Promise<NanoleafClient> {
    const stored = await this.stored(deviceId)
    return new NanoleafClient({ ip: stored.ip, token: stored.token, port: stored.port })
  }
}

/**
 * The subset of `ipcMain` used here, so channels can be registered without
 * depending on Electron in tests. Electron types IPC message arguments as
 * `any`: the boundary is serialised, hence unverifiable.
 */
export interface IpcMainLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void
}

export function registerIpc(ipcMain: IpcMainLike, service: DeviceService): void {
  ipcMain.handle(IPC_CHANNELS.discover, () => service.discover())
  ipcMain.handle(IPC_CHANNELS.list, () => service.listDevices())
  ipcMain.handle(IPC_CHANNELS.pair, (_event, id: unknown) => service.pair(asDeviceId(id)))
  ipcMain.handle(IPC_CHANNELS.getState, (_event, id: unknown) => service.getState(asDeviceId(id)))
  ipcMain.handle(IPC_CHANNELS.setOn, (_event, id: unknown, on: unknown) =>
    service.setOn(asDeviceId(id), asBoolean(on, 'on')),
  )
  ipcMain.handle(IPC_CHANNELS.setBrightness, (_event, id: unknown, value: unknown) =>
    service.setBrightness(asDeviceId(id), asNumber(value, 'brightness', 0, 100)),
  )
  ipcMain.handle(IPC_CHANNELS.getLayout, (_event, id: unknown) => service.getLayout(asDeviceId(id)))
  ipcMain.handle(IPC_CHANNELS.effectPalettes, (_event, id: unknown) =>
    service.getEffectPalettes(asDeviceId(id)),
  )
  ipcMain.handle(IPC_CHANNELS.selectEffect, (_event, id: unknown, name: unknown) =>
    service.selectEffect(asDeviceId(id), asText(name, 'effect name')),
  )
  ipcMain.handle(IPC_CHANNELS.audioSources, () => service.listAudioSources())
  ipcMain.handle(IPC_CHANNELS.audioStart, (_event, sourceId: unknown) =>
    service.startAudioCapture(asNumber(sourceId, 'sourceId', 0, Number.MAX_SAFE_INTEGER)),
  )
  ipcMain.handle(IPC_CHANNELS.audioStop, () => service.stopAudioCapture())
  ipcMain.handle(
    IPC_CHANNELS.paintPanel,
    (_event, id: unknown, panelId: unknown, color: unknown) =>
      service.paintPanel(
        asDeviceId(id),
        asNumber(panelId, 'panelId', 0, Number.MAX_SAFE_INTEGER),
        asColor(color),
      ),
  )
  ipcMain.handle(IPC_CHANNELS.paintPanels, (_event, id: unknown, entries: unknown) =>
    service.paintPanels(asDeviceId(id), asPaintEntries(entries)),
  )
  ipcMain.handle(IPC_CHANNELS.setColor, (_event, id: unknown, hue: unknown, sat: unknown) =>
    service.setColor(asDeviceId(id), asNumber(hue, 'hue', 0, 360), asNumber(sat, 'sat', 0, 100)),
  )
  ipcMain.handle(IPC_CHANNELS.startStream, (_event, id: unknown, source: unknown) =>
    service.startStream(asDeviceId(id), asSource(source)),
  )
  ipcMain.handle(IPC_CHANNELS.stopStream, (_event, id: unknown, source: unknown) =>
    service.stopStream(asDeviceId(id), asSource(source)),
  )
  ipcMain.handle(
    IPC_CHANNELS.frame,
    (_event, id: unknown, source: unknown, colors: unknown, transitionTime?: unknown) =>
      service.sendFrame(
        asDeviceId(id),
        asSource(source),
        asColors(colors),
        transitionTime === undefined
          ? undefined
          : asNumber(transitionTime, 'transitionTime', 0, 65535),
      ),
  )
}
