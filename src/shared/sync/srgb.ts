/**
 * An image as the pipeline sees it.
 *
 * Structurally compatible with `ImageData`, but declared here so the analysis
 * can be tested under Node, without a DOM.
 */
export interface Frame {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A colour in linear space, each channel within [0,1]. */
export interface LinearColor {
  r: number
  g: number
  b: number
}

const BLACK: LinearColor = { r: 0, g: 0, b: 0 }

/** Conversion table: 256 entries, computed once. */
const TO_LINEAR = new Float64Array(256)
for (let value = 0; value < 256; value += 1) {
  const channel = value / 255
  TO_LINEAR[value] = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

/** sRGB 0-255 to linear 0-1. */
export function toLinear(channel: number): number {
  return TO_LINEAR[Math.min(255, Math.max(0, Math.round(channel)))]!
}

/** Linear 0-1 back to sRGB 0-255. */
export function toSrgb(linear: number): number {
  const bounded = Math.min(1, Math.max(0, linear))
  const channel =
    bounded <= 0.0031308 ? bounded * 12.92 : 1.055 * bounded ** (1 / 2.4) - 0.055
  return Math.round(channel * 255)
}

/**
 * Average of a rectangle, in linear space.
 *
 * Averaging sRGB values directly yields washed-out grey: the gamma encoding
 * is not linear, so the mean of two vivid colours lands far too low. This is
 * the single most visible source of error in the whole pipeline.
 */
export function averageLinear(frame: Frame, rect: Rect): LinearColor {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(frame.width, Math.floor(rect.x + rect.width))
  const y1 = Math.min(frame.height, Math.floor(rect.y + rect.height))

  if (x1 <= x0 || y1 <= y0) return { ...BLACK }

  let r = 0
  let g = 0
  let b = 0

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * frame.width + x) * 4
      r += TO_LINEAR[frame.data[at]!]!
      g += TO_LINEAR[frame.data[at + 1]!]!
      b += TO_LINEAR[frame.data[at + 2]!]!
    }
  }

  const total = (x1 - x0) * (y1 - y0)
  return { r: r / total, g: g / total, b: b / total }
}

/** Linear luminance, Rec. 709 weights. */
export function luminance(color: LinearColor): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b
}
