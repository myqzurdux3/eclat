import type { NormalizedPanel, PanelLayout, RawPanel } from '../../shared/types'

/** The controller panel's id: present in the layout but not lightable. */
const CONTROLLER_PANEL_ID = 0

/**
 * Converts the device's raw coordinates into normalised positions in [0,1]²,
 * origin top-left, aspect ratio preserved.
 *
 * The device expresses its coordinates in millimetres with Y pointing up;
 * the axis is flipped here to match screen conventions.
 *
 * `width`/`height` measure the envelope of the panel *centres*, so a
 * horizontal row has zero height while the physical wall does not. `aspect`
 * adds `sideLength` on both axes to approximate the real extent the panels
 * occupy (their own size); the result is always finite and strictly
 * positive, including for collinear arrangements (a row or a column).
 */
export function normalizeLayout(raw: RawPanel[], sideLength: number): PanelLayout {
  const usable = raw.filter((p) => p.panelId !== CONTROLLER_PANEL_ID)

  if (usable.length === 0) {
    return { sideLength, nSideLength: 0, aspect: 1, panels: [] }
  }

  const xs = usable.map((p) => p.x)
  const ys = usable.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const width = maxX - minX
  const height = maxY - minY
  const scale = Math.max(width, height)

  // A device reporting no side length would make this 0/0 on a single panel,
  // and a NaN aspect propagates through the rotation into every coordinate:
  // a wall that renders nothing and swallows every click.
  const span = width + height + sideLength === 0 ? 1 : sideLength
  const aspect = (width + span) / (height + span)

  if (scale === 0) {
    const panels: NormalizedPanel[] = usable.map((p) => ({ ...p, nx: 0.5, ny: 0.5 }))
    return { sideLength, nSideLength: 1, aspect, panels }
  }

  const offsetX = (1 - width / scale) / 2
  const offsetY = (1 - height / scale) / 2

  const panels: NormalizedPanel[] = usable.map((p) => ({
    ...p,
    nx: (p.x - minX) / scale + offsetX,
    ny: 1 - ((p.y - minY) / scale + offsetY),
  }))

  return {
    sideLength,
    nSideLength: sideLength / scale,
    aspect,
    panels,
  }
}
