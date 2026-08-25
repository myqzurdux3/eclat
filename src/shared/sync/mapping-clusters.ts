import { toLinear, type Frame, type LinearColor, type Rect } from './srgb'

/** Bins per axis of the 3D histogram. */
const BINS = 16
const BLACK: LinearColor = { r: 0, g: 0, b: 0 }
/** Below this a pixel carries no weight: neither bright nor colourful enough. */
const MIN_WEIGHT = 1e-4

interface Bin {
  weight: number
  r: number
  g: number
  b: number
}

/**
 * A 3D histogram weighted by saturation.
 *
 * A grey wall filling the whole frame must not outvote a red sign: a pixel's
 * weight is the product of its brightness and its saturation, not merely its
 * number of occurrences.
 */
function histogram(frame: Frame, rect: Rect): Map<number, Bin> {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(frame.width, Math.floor(rect.x + rect.width))
  const y1 = Math.min(frame.height, Math.floor(rect.y + rect.height))

  const bins = new Map<number, Bin>()

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * frame.width + x) * 4
      const r = toLinear(frame.data[at]!)
      const g = toLinear(frame.data[at + 1]!)
      const b = toLinear(frame.data[at + 2]!)

      const max = Math.max(r, g, b)
      if (max <= 0) continue
      const min = Math.min(r, g, b)
      const saturation = (max - min) / max

      // The constant term keeps desaturated scenes alive: without it, a
      // greyscale image would have no dominant colour at all.
      const weight = max * (0.15 + saturation)
      if (weight < MIN_WEIGHT) continue

      const key =
        Math.min(BINS - 1, Math.floor(r * BINS)) * BINS * BINS +
        Math.min(BINS - 1, Math.floor(g * BINS)) * BINS +
        Math.min(BINS - 1, Math.floor(b * BINS))

      const bin = bins.get(key)
      if (bin === undefined) {
        bins.set(key, { weight, r: r * weight, g: g * weight, b: b * weight })
      } else {
        bin.weight += weight
        bin.r += r * weight
        bin.g += g * weight
        bin.b += b * weight
      }
    }
  }

  return bins
}

const centroid = (bin: Bin): LinearColor => ({
  r: bin.r / bin.weight,
  g: bin.g / bin.weight,
  b: bin.b / bin.weight,
})

/** Distance in the linear RGB cube, used to keep clusters apart. */
const distance = (a: LinearColor, b: LinearColor): number =>
  Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)

/** The colour of the heaviest cluster. Every panel receives it. */
export function dominantColor(frame: Frame, rect: Rect): LinearColor {
  const bins = [...histogram(frame, rect).values()]
  if (bins.length === 0) return { ...BLACK }

  const winner = bins.reduce((a, b) => (a.weight >= b.weight ? a : b))
  return centroid(winner)
}

/**
 * The `count` main colours, most present first.
 *
 * Clusters that sit too close together are dropped: three shades of the same
 * blue do not make a palette, and that is exactly what a plain sort by weight
 * would return.
 */
export function paletteColors(frame: Frame, rect: Rect, count: number): LinearColor[] {
  const bins = [...histogram(frame, rect).values()].sort((a, b) => b.weight - a.weight)
  if (bins.length === 0 || count <= 0) return []

  const MIN_SEPARATION = 0.12
  const kept: LinearColor[] = []

  for (const bin of bins) {
    if (kept.length >= count) break
    const colour = centroid(bin)
    if (kept.every((other) => distance(other, colour) >= MIN_SEPARATION)) {
      kept.push(colour)
    }
  }

  return kept
}
