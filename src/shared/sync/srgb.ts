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

/**
 * Black, in linear space.
 *
 * Distinct from `UNLIT` in `paint.ts` on purpose: the numbers agree, the
 * spaces do not, and every other value in one means something else in the
 * other. Spread it — callers hand these around and must not share one.
 */
export const LINEAR_BLACK: LinearColor = { r: 0, g: 0, b: 0 }

/**
 * Conversion table: 256 entries, computed once.
 *
 * Exported for the hot loops, which read `Uint8ClampedArray` data: the
 * clamping and rounding `toLinear` does are provably redundant there, and it
 * runs three times per pixel per panel per frame.
 */
export const TO_LINEAR = new Float64Array(256)
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

/** Linear luminance, Rec. 709 weights. */
export function luminance(color: LinearColor): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b
}

/**
 * The part of `rect` that is actually inside the frame.
 *
 * The same four lines were written out at each place that walks a rectangle.
 * One of those copies scanned the wrong bounds for months.
 */
export function clipRect(frame: Frame, rect: Rect): Rect {
  const x = Math.max(0, Math.floor(rect.x))
  const y = Math.max(0, Math.floor(rect.y))
  return {
    x,
    y,
    width: Math.max(0, Math.min(frame.width, Math.floor(rect.x + rect.width)) - x),
    height: Math.max(0, Math.min(frame.height, Math.floor(rect.y + rect.height)) - y),
  }
}
