import { createSocket, type Socket } from 'node:dgram'
import type { AddressInfo } from 'node:net'
import { FRAME_HEADER_BYTES, FRAME_PANEL_BYTES, type PanelColor } from '../main/device/frame'

export interface DecodedFrame {
  transitionTime: number
  panels: PanelColor[]
}

/**
 * A test double of the streaming port: it decodes the External Control v2
 * frames received over UDP, so CI can cover the whole path without hardware.
 */
export class FakeStreamReceiver {
  readonly frames: DecodedFrame[] = []

  private socket: Socket | undefined
  private waiters: Array<() => void> = []

  get port(): number {
    const address = this.socket?.address()
    if (!address || typeof address === 'string') {
      throw new Error('FakeStreamReceiver not started')
    }
    return (address as AddressInfo).port
  }

  async start(): Promise<void> {
    const socket = createSocket('udp4')
    socket.on('message', (message) => {
      const frame = decodeFrame(message)
      if (frame === null) return
      this.frames.push(frame)
      for (const notify of this.waiters.splice(0)) notify()
    })
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve))
    this.socket = socket
  }

  async stop(): Promise<void> {
    if (!this.socket) return
    await new Promise<void>((resolve) => this.socket!.close(resolve))
    this.socket = undefined
  }

  /** Waits until at least `count` frames have arrived, then returns them all. */
  async waitForFrames(count: number, timeoutMs = 1000): Promise<DecodedFrame[]> {
    const deadline = Date.now() + timeoutMs

    while (this.frames.length < count) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new Error(`Only ${this.frames.length} frame(s) received out of ${count} expected`)
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining)
        this.waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }

    return [...this.frames]
  }
}

/** The inverse of `encodeFrameV2`. Returns `null` on a malformed datagram. */
function decodeFrame(message: Buffer): DecodedFrame | null {
  if (message.length < FRAME_HEADER_BYTES) return null

  const count = message.readUInt16BE(0)
  if (message.length !== FRAME_HEADER_BYTES + count * FRAME_PANEL_BYTES) return null

  const panels: PanelColor[] = []
  let transitionTime = 0

  for (let index = 0; index < count; index += 1) {
    const at = FRAME_HEADER_BYTES + index * FRAME_PANEL_BYTES
    panels.push({
      panelId: message.readUInt16BE(at),
      color: {
        r: message.readUInt8(at + 2),
        g: message.readUInt8(at + 3),
        b: message.readUInt8(at + 4),
      },
    })
    transitionTime = message.readUInt16BE(at + 6)
  }

  return { transitionTime, panels }
}
