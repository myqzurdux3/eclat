import { toLinear, type Frame, type LinearColor, type Rect } from './srgb'
import type { PanelLayout } from '../types'

/**
 * The colour of each panel, sampled around its own position.
 *
 * Weighting is Gaussian with standard deviation `radius`, expressed as a
 * fraction of the wall. The sampling areas deliberately overlap: two
 * neighbouring panels share part of their neighbourhood, which softens the
 * transition between them instead of cutting it.
 *
 * Everything happens in linear space; the caller converts back to sRGB.
 */
export function mapSpatial(
  frame: Frame,
  rect: Rect,
  layout: PanelLayout,
  radius: number,
): LinearColor[] {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(frame.width, Math.floor(rect.x + rect.width))
  const y1 = Math.min(frame.height, Math.floor(rect.y + rect.height))

  const width = x1 - x0
  const height = y1 - y0
  if (width <= 0 || height <= 0) {
    return layout.panels.map(() => ({ r: 0, g: 0, b: 0 }))
  }

  // A zero radius would drive every weight towards zero: keep enough spread
  // to cover at least one pixel.
  const sigma = Math.max(radius, 0.5 / Math.max(width, height))
  const twoSigmaSquared = 2 * sigma * sigma

  return layout.panels.map((panel) => {
    let r = 0
    let g = 0
    let b = 0
    let totalWeight = 0

    for (let y = y0; y < y1; y += 1) {
      // Pixel centre, mapped into [0,1] over the useful rectangle.
      const ny = (y - y0 + 0.5) / height
      const dy = ny - panel.ny

      for (let x = x0; x < x1; x += 1) {
        const nx = (x - x0 + 0.5) / width
        const dx = nx - panel.nx
        const weight = Math.exp(-(dx * dx + dy * dy) / twoSigmaSquared)
        if (weight < 1e-6) continue

        const at = (y * frame.width + x) * 4
        r += weight * toLinear(frame.data[at]!)
        g += weight * toLinear(frame.data[at + 1]!)
        b += weight * toLinear(frame.data[at + 2]!)
        totalWeight += weight
      }
    }

    // The panel sits too far from the image for any weight to survive: take
    // the nearest pixel rather than returning black.
    if (totalWeight === 0) {
      const px = Math.min(x1 - 1, Math.max(x0, x0 + Math.round(panel.nx * (width - 1))))
      const py = Math.min(y1 - 1, Math.max(y0, y0 + Math.round(panel.ny * (height - 1))))
      const at = (py * frame.width + px) * 4
      return {
        r: toLinear(frame.data[at]!),
        g: toLinear(frame.data[at + 1]!),
        b: toLinear(frame.data[at + 2]!),
      }
    }

    return { r: r / totalWeight, g: g / totalWeight, b: b / totalWeight }
  })
}
