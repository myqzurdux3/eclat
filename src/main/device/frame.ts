import type { Color } from '../../shared/types'

/** Couleur destinée à un panneau précis, identifié par son `panelId`. */
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
 * Encode une trame External Control v2, en big-endian.
 *
 * `transitionTime` est exprimé en centaines de millisecondes et vaut 1 par
 * défaut : le contrôleur interpole lui-même entre deux trames, ce qui lisse
 * le rendu et absorbe le jitter réseau. À 0, les panneaux scintillent.
 *
 * Le canal W reste à 0 : les Shapes et les Lines n'ont pas de LED blanche
 * dédiée.
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
