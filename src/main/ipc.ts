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

export interface DeviceServiceOptions {
  store: ConfigStore
  mdnsFactory: MdnsFactory
  discoverTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  pairAttempts?: number
  /** Arbiter factory, one per device: two walls arbitrate separately. */
  arbiterFactory?: () => SourceArbiter
  /** Receives whatever the device reports of its own accord. */
  onDeviceEvent?: (event: DeviceEvent) => void
  /** Receives the analysed audio, block by block. */
  onAudioFeatures?: (features: AudioFeatures) => void
  /** Injected by tests to aim at a local UDP receiver. */
  streamFactory?: (options: { client: NanoleafClient; ip: string }) => PanelStream
}

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

    const stored = await this.stored(deviceId)
    this.subscriptions.set(
      deviceId,
      subscribeToEvents({
        ip: stored.ip,
        port: stored.port,
        token: stored.token,
        deviceId,
        onEvent: (event) => {
          if (event.kind === 'effect') {
            void this.noteEffectChange(deviceId, String(event.value)).catch(() => undefined)
          }
          this.options.onDeviceEvent?.(event)
        },
      }),
    )
  }

  async listDevices(): Promise<RendererDevice[]> {
    const config = await this.options.store.load()
    const merged = new Map<string, RendererDevice>()
    const moved: StoredDevice[] = []

    for (const [id, entry] of this.seen) {
      merged.set(id, { id, ...entry, paired: false })
    }

    for (const stored of Object.values(config.devices)) {
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
    // A stream in flight restores the power it found at arming: tell it the
    // user has moved that baseline, or its release undoes this command.
    this.streams.get(deviceId)?.notePower(on)
  }

  async setBrightness(deviceId: string, value: number): Promise<void> {
    await (await this.client(deviceId)).setBrightness(value)
  }

  async getLayout(deviceId: string): Promise<PanelLayout> {
    return (await this.client(deviceId)).getLayout()
  }

  async getEffects(deviceId: string): Promise<string[]> {
    return (await this.client(deviceId)).getEffects()
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

    let stream = this.streams.get(deviceId)
    if (stream === undefined) {
      stream =
        this.options.streamFactory?.({ client, ip: stored.ip }) ??
        new PanelStream({ client, ip: stored.ip })
      this.streams.set(deviceId, stream)
    }

    if (!this.panelIds.has(deviceId)) {
      const layout = await client.getLayout()
      this.panelIds.set(
        deviceId,
        layout.panels.map((panel) => panel.panelId),
      )
    }

    await stream.arm()
    this.arbiter(deviceId).activate(source)
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
  ): Promise<boolean> {
    const arbiter = this.arbiter(deviceId)
    if (source === 'manual') arbiter.touchManual()
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
    if (!this.streams.has(deviceId)) {
      // A click on a panel asks for light, and external control lights
      // nothing on an off wall. Switching the power on here — before the
      // stream saves its snapshot — also keeps the release from putting the
      // wall back into the dark three seconds later.
      const client = await this.client(deviceId)
      if (!(await client.getState()).on) await client.setOn(true)

      await this.startStream(deviceId, 'manual')
    }

    const panelIds = this.panelIds.get(deviceId)
    if (panelIds === undefined) return false

    let painted = this.painted.get(deviceId)
    if (painted === undefined) {
      painted = new Map<number, Color>()
      this.painted.set(deviceId, painted)
    }
    painted.set(panelId, color)

    return this.sendFrame(
      deviceId,
      'manual',
      panelIds.map((id) => painted.get(id) ?? { r: 0, g: 0, b: 0 }),
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

    for (const subscription of this.subscriptions.values()) subscription.close()
    this.subscriptions.clear()


    const streams = [...this.streams.values()]
    this.streams.clear()
    this.panelIds.clear()
    this.painted.clear()
    this.arbiters.clear()
    await Promise.all(streams.map((stream) => stream.stop()))
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
  ipcMain.handle(IPC_CHANNELS.pair, (_event, id: string) => service.pair(id))
  ipcMain.handle(IPC_CHANNELS.getState, (_event, id: string) => service.getState(id))
  ipcMain.handle(IPC_CHANNELS.setOn, (_event, id: string, on: boolean) => service.setOn(id, on))
  ipcMain.handle(IPC_CHANNELS.setBrightness, (_event, id: string, value: number) =>
    service.setBrightness(id, value),
  )
  ipcMain.handle(IPC_CHANNELS.getLayout, (_event, id: string) => service.getLayout(id))
  ipcMain.handle(IPC_CHANNELS.getEffects, (_event, id: string) => service.getEffects(id))
  ipcMain.handle(IPC_CHANNELS.effectPalettes, (_event, id: string) =>
    service.getEffectPalettes(id),
  )
  ipcMain.handle(IPC_CHANNELS.selectEffect, (_event, id: string, name: string) =>
    service.selectEffect(id, name),
  )
  ipcMain.handle(IPC_CHANNELS.audioSources, () => service.listAudioSources())
  ipcMain.handle(IPC_CHANNELS.audioStart, (_event, sourceId: number) =>
    service.startAudioCapture(sourceId),
  )
  ipcMain.handle(IPC_CHANNELS.audioStop, () => service.stopAudioCapture())
  ipcMain.handle(
    IPC_CHANNELS.paintPanel,
    (_event, id: string, panelId: number, color: Color) =>
      service.paintPanel(id, panelId, color),
  )
  ipcMain.handle(IPC_CHANNELS.setColor, (_event, id: string, hue: number, sat: number) =>
    service.setColor(id, hue, sat),
  )
  ipcMain.handle(IPC_CHANNELS.startStream, (_event, id: string, source: SourceId) =>
    service.startStream(id, source),
  )
  ipcMain.handle(IPC_CHANNELS.stopStream, (_event, id: string, source: SourceId) =>
    service.stopStream(id, source),
  )
  ipcMain.handle(
    IPC_CHANNELS.frame,
    (_event, id: string, source: SourceId, colors: Color[], transitionTime?: number) =>
      service.sendFrame(id, source, colors, transitionTime),
  )
}
