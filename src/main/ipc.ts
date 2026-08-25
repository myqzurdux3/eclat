import type { Color, DeviceState, EffectPalette, PanelLayout, SourceId } from '../shared/types'
import { IPC_CHANNELS, type RendererDevice } from '../shared/ipc-contract'
import { SourceArbiter } from './device/arbiter'
import { NanoleafClient } from './device/client'
import { NanoleafError } from './device/errors'
import { discoverDevices, type MdnsFactory } from './device/discovery'
import { pairDevice } from './device/pairing'
import { PanelStream } from './device/stream'
import type { ConfigStore, StoredDevice } from './store'

export interface DeviceServiceOptions {
  store: ConfigStore
  mdnsFactory: MdnsFactory
  discoverTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  pairAttempts?: number
  arbiter?: SourceArbiter
  /** Injecté par les tests pour viser un récepteur UDP local. */
  streamFactory?: (options: { client: NanoleafClient; ip: string }) => PanelStream
}

/**
 * Logique métier derrière les canaux IPC. Sans dépendance à Electron pour
 * rester testable hors application.
 */
export class DeviceService {
  /** Devices vus en mDNS mais pas encore appairés, indexés par id. */
  private readonly seen = new Map<string, { name: string; ip: string; port: number; model?: string; firmware?: string }>()

  private readonly streams = new Map<string, PanelStream>()
  /** `panelId` dans l'ordre du layout, mémorisé à l'armement. */
  private readonly panelIds = new Map<string, number[]>()
  /** Dernière couleur posée sur chaque panneau, par device. */
  private readonly painted = new Map<string, Map<number, Color>>()
  private readonly arbiter: SourceArbiter

  constructor(private readonly options: DeviceServiceOptions) {
    this.arbiter = options.arbiter ?? new SourceArbiter()
  }

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

  async listDevices(): Promise<RendererDevice[]> {
    const config = await this.options.store.load()
    const merged = new Map<string, RendererDevice>()

    for (const [id, entry] of this.seen) {
      merged.set(id, { id, ...entry, paired: false })
    }

    for (const stored of Object.values(config.devices)) {
      merged.set(stored.id, {
        id: stored.id,
        name: stored.name,
        ip: stored.ip,
        port: stored.port,
        model: merged.get(stored.id)?.model,
        firmware: merged.get(stored.id)?.firmware,
        paired: true,
      })
    }

    return [...merged.values()]
  }

  async pair(deviceId: string): Promise<RendererDevice> {
    const candidate = this.seen.get(deviceId)
    if (candidate === undefined) {
      throw new NanoleafError(`Device inconnu : ${deviceId}`, 404)
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

  async selectEffect(deviceId: string, name: string): Promise<void> {
    await (await this.client(deviceId)).selectEffect(name)
  }

  /** Arme le mode externe et déclare la source auprès de l'arbitre. */
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
    this.arbiter.activate(source)
  }

  /** Retire la source ; ne désarme que si plus personne n'écrit. */
  async stopStream(deviceId: string, source: SourceId): Promise<void> {
    this.arbiter.deactivate(source)
    if (this.arbiter.current() !== null) return

    const stream = this.streams.get(deviceId)
    if (stream === undefined) return
    this.streams.delete(deviceId)
    this.panelIds.delete(deviceId)
    this.painted.delete(deviceId)
    await stream.stop()
  }

  /**
   * Diffuse une frame produite par le renderer. Les couleurs sont réparties
   * sur les panneaux dans l'ordre du layout ; une liste plus courte est
   * cyclée. Renvoie `false` si la source n'a pas la main ou si la cadence
   * maximale est déjà atteinte.
   */
  async sendFrame(
    deviceId: string,
    source: SourceId,
    colors: Color[],
    transitionTime?: number,
  ): Promise<boolean> {
    if (source === 'manual') this.arbiter.touchManual()
    if (!this.arbiter.accepts(source)) return false

    const stream = this.streams.get(deviceId)
    const panelIds = this.panelIds.get(deviceId)
    if (stream === undefined || panelIds === undefined || colors.length === 0) return false

    return stream.send(
      panelIds.map((panelId, index) => ({ panelId, color: colors[index % colors.length]! })),
      transitionTime,
    )
  }

  /**
   * Peint un panneau et rediffuse le mur entier : le protocole v2 n'a pas de
   * trame partielle. Les panneaux jamais peints restent noirs — leur couleur
   * d'avant l'armement n'est pas récupérable.
   *
   * Arme le stream au besoin : cliquer un panneau doit suffire, sans avoir à
   * démarrer un sync au préalable.
   */
  async paintPanel(deviceId: string, panelId: number, color: Color): Promise<boolean> {
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
    painted.set(panelId, color)

    return this.sendFrame(
      deviceId,
      'manual',
      panelIds.map((id) => painted.get(id) ?? { r: 0, g: 0, b: 0 }),
    )
  }

  async setColor(deviceId: string, hue: number, sat: number): Promise<void> {
    const client = await this.client(deviceId)
    await client.setHue(hue)
    await client.setSat(sat)
  }

  /** Rend son effet à chaque device. Appelé à la fermeture et sur signal. */
  async shutdown(): Promise<void> {
    const streams = [...this.streams.values()]
    this.streams.clear()
    this.panelIds.clear()
    this.painted.clear()
    this.arbiter.reset()
    await Promise.all(streams.map((stream) => stream.stop()))
  }

  private async stored(deviceId: string): Promise<StoredDevice> {
    const config = await this.options.store.load()
    const stored = config.devices[deviceId]
    if (stored === undefined) {
      throw new NanoleafError(`Device non appairé : ${deviceId}`, 401)
    }
    return stored
  }

  /** Construit un client authentifié ; le token reste dans le processus main. */
  private async client(deviceId: string): Promise<NanoleafClient> {
    const stored = await this.stored(deviceId)
    return new NanoleafClient({ ip: stored.ip, token: stored.token, port: stored.port })
  }
}

/**
 * Sous-ensemble d'`ipcMain` utilisé ici, pour enregistrer les canaux sans
 * dépendre d'Electron dans les tests. Les arguments d'un message IPC sont
 * typés `any` par Electron : la frontière est sérialisée, donc non vérifiable.
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
