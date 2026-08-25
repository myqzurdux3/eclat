import { createSocket } from 'node:dgram'
import { EXT_CONTROL_EFFECT, type DeviceState } from '../../shared/types'
import type { NanoleafClient } from './client'
import { encodeFrameV2, type PanelColor } from './frame'
import { RateGovernor } from './rate'

/** Port UDP d'écoute du contrôleur en mode External Control. */
export const STREAM_PORT = 60222
/** Périodicité de la sonde de réarmement, imposée par la spec. */
export const PROBE_INTERVAL_MS = 10_000

export interface UdpSocketLike {
  send(
    data: Buffer,
    port: number,
    address: string,
    callback?: (error: Error | null) => void,
  ): void
  close(callback?: () => void): void
}

export interface SchedulerLike {
  setInterval(handler: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

export interface PanelStreamOptions {
  client: NanoleafClient
  ip: string
  port?: number
  socketFactory?: () => UdpSocketLike
  governor?: RateGovernor
  probeIntervalMs?: number
  scheduler?: SchedulerLike
}

const defaultScheduler: SchedulerLike = {
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}

/**
 * Seul writer de la socket UDP. Possède l'armement du mode External Control,
 * l'émission des trames, la sonde de réarmement et la restauration de
 * l'état d'origine.
 */
export class PanelStream {
  private readonly client: NanoleafClient
  private readonly ip: string
  private readonly port: number
  private readonly socketFactory: () => UdpSocketLike
  private readonly governor: RateGovernor
  private readonly probeIntervalMs: number
  private readonly scheduler: SchedulerLike

  private socket: UdpSocketLike | undefined
  private probeHandle: unknown = null
  private saved: DeviceState | null = null

  constructor(options: PanelStreamOptions) {
    this.client = options.client
    this.ip = options.ip
    this.port = options.port ?? STREAM_PORT
    this.socketFactory = options.socketFactory ?? (() => createSocket('udp4'))
    this.governor = options.governor ?? new RateGovernor()
    this.probeIntervalMs = options.probeIntervalMs ?? PROBE_INTERVAL_MS
    this.scheduler = options.scheduler ?? defaultScheduler
  }

  get armed(): boolean {
    return this.socket !== undefined
  }

  /**
   * Sauvegarde l'état courant, arme External Control et ouvre la socket.
   * Sans la sauvegarde préalable, les panneaux resteraient figés sur la
   * dernière trame diffusée à l'arrêt.
   */
  async arm(): Promise<void> {
    if (this.saved === null) {
      this.saved = await this.client.getState()
    }

    await this.client.enableExternalControl()

    if (this.socket === undefined) {
      this.socket = this.socketFactory()
    }

    if (this.probeHandle === null) {
      this.probeHandle = this.scheduler.setInterval(() => {
        void this.probe()
      }, this.probeIntervalMs)
    }
  }

  /**
   * Émet une trame. Renvoie `false` si le mode n'est pas armé ou si la
   * cadence maximale est déjà atteinte — l'appelant n'a rien à rattraper.
   */
  send(panels: PanelColor[], transitionTime = 1): boolean {
    if (this.socket === undefined) return false
    if (!this.governor.shouldSend()) return false

    this.socket.send(encodeFrameV2(panels, transitionTime), this.port, this.ip, () => {
      // Un datagramme perdu n'est pas rattrapable : la trame suivante corrige.
    })
    this.governor.recordSent()
    return true
  }

  /** Vérifie que le mode tient toujours, et le réarme sinon. */
  async probe(): Promise<void> {
    if (this.socket === undefined) return

    try {
      const state = await this.client.getState()
      if (state.effect !== EXT_CONTROL_EFFECT) {
        await this.client.enableExternalControl()
      }
    } catch {
      // Device momentanément injoignable : la sonde suivante retentera.
    }
  }

  /** Ferme la socket et rend au device l'effet qu'il affichait. */
  async stop(): Promise<void> {
    if (this.probeHandle !== null) {
      this.scheduler.clearInterval(this.probeHandle)
      this.probeHandle = null
    }

    if (this.socket !== undefined) {
      this.socket.close()
      this.socket = undefined
    }

    const saved = this.saved
    this.saved = null
    if (saved === null) return

    try {
      if (saved.effect !== EXT_CONTROL_EFFECT) {
        await this.client.selectEffect(saved.effect)
      }
      await this.client.setOn(saved.on)
    } catch {
      // Device injoignable à l'arrêt : rien de mieux à tenter.
    }
  }
}
