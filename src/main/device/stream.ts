import { createSocket } from 'node:dgram'
import { EXT_CONTROL_EFFECT, type DeviceState } from '../../shared/types'
import type { NanoleafClient } from './client'
import { encodeFrameV2, type PanelColor } from './frame'
import { RateGovernor } from './rate'

/** The UDP port the controller listens on in External Control mode. */
export const STREAM_PORT = 60222
/** How often the re-arm probe runs, as the spec requires. */
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
 * The only writer of the UDP socket. It owns arming External Control,
 * sending frames, the re-arm probe, and restoring the original state.
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
   * Saves the current state, arms External Control and opens the socket.
   * Without saving first, the panels would stay frozen on the last frame
   * broadcast when it stops.
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
   * Records a power change made behind the stream's back.
   *
   * What gets put back on release is the snapshot taken at arming. An
   * explicit power command from the user replaces it: without this, a release
   * firing three seconds after a `Turn off` would light the wall back up
   * because the snapshot still says the wall was on.
   */
  notePower(on: boolean): void {
    if (this.saved !== null) this.saved = { ...this.saved, on }
  }

  /**
   * Sends a frame. Returns `false` when the mode is not armed or the maximum
   * rate is already reached — the caller has nothing to make up for.
   */
  send(panels: PanelColor[], transitionTime = 1): boolean {
    if (this.socket === undefined) return false
    if (!this.governor.shouldSend()) return false

    this.socket.send(encodeFrameV2(panels, transitionTime), this.port, this.ip, () => {
      // A lost datagram cannot be recovered: the next frame corrects it.
    })
    this.governor.recordSent()
    return true
  }

  /** Checks the mode still holds, and re-arms it otherwise. */
  async probe(): Promise<void> {
    if (this.socket === undefined) return

    try {
      const state = await this.client.getState()
      if (state.effect !== EXT_CONTROL_EFFECT) {
        await this.client.enableExternalControl()
      }
    } catch {
      // Device briefly unreachable: the next probe will try again.
    }
  }

  /**
   * Closes the socket and, unless told otherwise, gives the device back the
   * effect it was showing. `restore: false` is for when the caller is about
   * to impose another effect: rewriting the old one on the way would make it
   * blink.
   */
  async stop({ restore = true }: { restore?: boolean } = {}): Promise<void> {
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
    if (saved === null || !restore) return

    try {
      if (saved.effect !== EXT_CONTROL_EFFECT) {
        await this.client.selectEffect(saved.effect)
      }
      await this.client.setOn(saved.on)
    } catch {
      // Device unreachable on stop: nothing better to try.
    }
  }
}
