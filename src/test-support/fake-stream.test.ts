import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSocket } from 'node:dgram'
import { encodeFrameV2 } from '../main/device/frame'
import { FakeStreamReceiver } from './fake-stream'

let receiver: FakeStreamReceiver

beforeEach(async () => {
  receiver = new FakeStreamReceiver()
  await receiver.start()
})

afterEach(async () => {
  await receiver.stop()
})

const emit = (payload: Buffer): Promise<void> =>
  new Promise((resolve, reject) => {
    const socket = createSocket('udp4')
    socket.send(payload, receiver.port, '127.0.0.1', (err) => {
      socket.close()
      if (err) reject(err)
      else resolve()
    })
  })

describe('FakeStreamReceiver', () => {
  it('décode une trame émise', async () => {
    await emit(encodeFrameV2([{ panelId: 7, color: { r: 10, g: 20, b: 30 } }], 1))

    const [frame] = await receiver.waitForFrames(1)

    expect(frame).toEqual({
      transitionTime: 1,
      panels: [{ panelId: 7, color: { r: 10, g: 20, b: 30 } }],
    })
  })

  it('accumule les trames dans l ordre', async () => {
    await emit(encodeFrameV2([{ panelId: 1, color: { r: 1, g: 0, b: 0 } }]))
    await emit(encodeFrameV2([{ panelId: 2, color: { r: 2, g: 0, b: 0 } }]))

    const frames = await receiver.waitForFrames(2)

    expect(frames.map((f) => f.panels[0]!.panelId)).toEqual([1, 2])
  })

  it('décode une trame vide', async () => {
    await emit(encodeFrameV2([]))

    const [frame] = await receiver.waitForFrames(1)

    expect(frame!.panels).toEqual([])
  })

  it('ignore un datagramme tronqué', async () => {
    await emit(Buffer.from([0x00, 0x02, 0x00, 0x01]))
    await emit(encodeFrameV2([{ panelId: 9, color: { r: 0, g: 0, b: 0 } }]))

    const frames = await receiver.waitForFrames(1)

    expect(frames).toHaveLength(1)
    expect(frames[0]!.panels[0]!.panelId).toBe(9)
  })

  it('rejette si le compte attendu n arrive pas', async () => {
    await expect(receiver.waitForFrames(1, 50)).rejects.toThrow(/trame/i)
  })
})
