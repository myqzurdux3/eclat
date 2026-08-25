import type { Color } from '../../shared/types'

/** A colour aimed at one specific panel, identified by its `panelId`. */
export interface PanelColor {
  panelId: number
  color: Color
}

/** `uint16 nPanels`. */
export const FRAME_HEADER_BYTES = 2
/** `uint16 panelId`, `uint8` R, G, B, W, `uint16 transitionTime`. */
export const FRAME_PANEL_BYTES = 8

const clampByte = (value: number): number =>
  Math.min(255, Math.max(0, Math.round(value)))

const clampUint16 = (value: number): number =>
  Math.min(65535, Math.max(0, Math.round(value)))

/**
 * Encodes an External Control v2 frame, big-endian.
 *
 * `transitionTime` is expressed in hundreds of milliseconds and defaults to
 * 1: the controller interpolates between frames on its own, which smooths
 * the result and absorbs network jitter. At 0, the panels flicker.
 *
 * The W channel stays at 0: Shapes and Lines have no dedicated white LED.
 */
export function encodeFrameV2(panels: PanelColor[], transitionTime = 1): Buffer {
  const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + panels.length * FRAME_PANEL_BYTES)
  const ticks = clampUint16(transitionTime)

  frame.writeUInt16BE(panels.length, 0)

  panels.forEach(({ panelId, color }, index) => {
    const at = FRAME_HEADER_BYTES + index * FRAME_PANEL_BYTES
    frame.writeUInt16BE(clampUint16(panelId), at)
    frame.writeUInt8(clampByte(color.r), at + 2)
    frame.writeUInt8(clampByte(color.g), at + 3)
    frame.writeUInt8(clampByte(color.b), at + 4)
    frame.writeUInt8(0, at + 5)
    frame.writeUInt16BE(ticks, at + 6)
  })

  return frame
}
