import type { DeviceState, PanelLayout } from '../shared/types'
import { IPC_CHANNELS, type RendererDevice } from '../shared/ipc-contract'
import { NanoleafClient } from './device/client'
import { NanoleafError } from './device/errors'
import { discoverDevices, type MdnsFactory } from './device/discovery'
import { pairDevice } from './device/pairing'
import type { ConfigStore, StoredDevice } from './store'

export interface DeviceServiceOptions {
  store: ConfigStore
  mdnsFactory: MdnsFactory
  discoverTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  pairAttempts?: number
}

/**
 * Logique métier derrière les canaux IPC. Sans dépendance à Electron pour
 * rester testable hors application.
 */
export class DeviceService {
  /** Devices vus en mDNS mais pas encore appairés, indexés par id. */
  private readonly seen = new Map<string, { name: string; ip: string; port: number; model?: string; firmware?: string }>()

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

  async selectEffect(deviceId: string, name: string): Promise<void> {
    await (await this.client(deviceId)).selectEffect(name)
  }

  /** Construit un client authentifié ; le token reste dans le processus main. */
  private async client(deviceId: string): Promise<NanoleafClient> {
    const config = await this.options.store.load()
    const stored = config.devices[deviceId]
    if (stored === undefined) {
      throw new NanoleafError(`Device non appairé : ${deviceId}`, 401)
    }
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
  ipcMain.handle(IPC_CHANNELS.selectEffect, (_event, id: string, name: string) =>
    service.selectEffect(id, name),
  )
}
