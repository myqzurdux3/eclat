import { describe, expect, it } from 'vitest'
import { encodeFrameV2, FRAME_HEADER_BYTES, FRAME_PANEL_BYTES } from './frame'

const panel = (panelId: number, r: number, g: number, b: number) => ({
  panelId,
  color: { r, g, b },
})

describe('encodeFrameV2', () => {
  it('encodes an empty frame in two bytes', () => {
    expect(encodeFrameV2([])).toEqual(Buffer.from([0x00, 0x00]))
  })

  it('encodes one panel, big-endian, W at 0 and transitionTime defaulting to 1', () => {
    expect(encodeFrameV2([panel(1, 255, 0, 128)])).toEqual(
      Buffer.from([0x00, 0x01, 0x00, 0x01, 0xff, 0x00, 0x80, 0x00, 0x00, 0x01]),
    )
  })

  it('encodes a panelId beyond 255 across two bytes', () => {
    expect(encodeFrameV2([panel(4660, 0, 0, 0)]).subarray(2, 4)).toEqual(
      Buffer.from([0x12, 0x34]),
    )
  })

  it('honours the advertised size for several panels', () => {
    const frame = encodeFrameV2([panel(1, 1, 2, 3), panel(2, 4, 5, 6), panel(3, 7, 8, 9)])

    expect(frame.readUInt16BE(0)).toBe(3)
    expect(frame).toHaveLength(FRAME_HEADER_BYTES + 3 * FRAME_PANEL_BYTES)
  })

  it('bounds out-of-range channels', () => {
    const frame = encodeFrameV2([panel(1, 300, -5, 12.7)])

    expect([...frame.subarray(4, 7)]).toEqual([255, 0, 13])
  })

  it('writes the requested transitionTime', () => {
    expect(encodeFrameV2([panel(1, 0, 0, 0)], 20).readUInt16BE(8)).toBe(20)
  })

  it('bounds transitionTime into a uint16', () => {
    expect(encodeFrameV2([panel(1, 0, 0, 0)], 99999).readUInt16BE(8)).toBe(65535)
    expect(encodeFrameV2([panel(1, 0, 0, 0)], -3).readUInt16BE(8)).toBe(0)
  })
})
