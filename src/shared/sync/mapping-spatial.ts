import { clipRect, LINEAR_BLACK, TO_LINEAR, type Frame, type LinearColor, type Rect } from './srgb'
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
  const { x: x0, y: y0, width, height } = clipRect(frame, rect)
  const x1 = x0 + width
  const y1 = y0 + height
  if (width <= 0 || height <= 0) {
    return layout.panels.map(() => ({ ...LINEAR_BLACK }))
  }

  // A zero radius would drive every weight towards zero: keep enough spread
  // to cover at least one pixel.
  const sigma = Math.max(radius, 0.5 / Math.max(width, height))
  const twoSigmaSquared = 2 * sigma * sigma

  // The Gaussian factorises: exp(-(dx² + dy²)/2σ²) is exp(-dx²/2σ²) times
  // exp(-dy²/2σ²). Evaluated per pixel it costs one `exp` for each of the
  // 2304 pixels, per panel, per frame; split into a row table and a column
  // table it costs 64 + 36. The arithmetic is the same to the last bit — the
  // exponentials are simply not recomputed for every pixel of a row.
  const columnWeights = new Float64Array(width)
  const rowWeights = new Float64Array(height)

  return layout.panels.map((panel) => {
    for (let x = 0; x < width; x += 1) {
      const dx = (x + 0.5) / width - panel.nx
      columnWeights[x] = Math.exp(-(dx * dx) / twoSigmaSquared)
    }
    for (let y = 0; y < height; y += 1) {
      const dy = (y + 0.5) / height - panel.ny
      rowWeights[y] = Math.exp(-(dy * dy) / twoSigmaSquared)
    }

    let r = 0
    let g = 0
    let b = 0
    let totalWeight = 0

    for (let y = y0; y < y1; y += 1) {
      const rowWeight = rowWeights[y - y0]!

      for (let x = x0; x < x1; x += 1) {
        const weight = rowWeight * columnWeights[x - x0]!
        if (weight < 1e-6) continue

        // The table is indexed directly: the frame's channels are already
        // whole numbers in range, so `toLinear`'s clamping would be three
        // redundant calls per pixel, per panel, per frame.
        const at = (y * frame.width + x) * 4
        r += weight * TO_LINEAR[frame.data[at]!]!
        g += weight * TO_LINEAR[frame.data[at + 1]!]!
        b += weight * TO_LINEAR[frame.data[at + 2]!]!
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
        r: TO_LINEAR[frame.data[at]!]!,
        g: TO_LINEAR[frame.data[at + 1]!]!,
        b: TO_LINEAR[frame.data[at + 2]!]!,
      }
    }

    return { r: r / totalWeight, g: g / totalWeight, b: b / totalWeight }
  })
}
