import { luminance, toLinear, type Frame, type Rect } from './srgb'

/**
 * Linear luminance above which a band no longer counts as black. The bars in
 * a compressed film are never exactly zero; this threshold sits at roughly
 * sRGB 20.
 */
export const DEFAULT_THRESHOLD = 0.006

/** Beyond this, it is not letterboxing but a dark scene. */
const MAX_CROP = 0.45

/** Mean luminance of a run of pixels, one every `step` in the data. */
function meanLuminance(frame: Frame, start: number, count: number, step: number): number {
  let total = 0
  for (let i = 0; i < count; i += 1) {
    const at = (start + i * step) * 4
    total += luminance({
      r: toLinear(frame.data[at]!),
      g: toLinear(frame.data[at + 1]!),
      b: toLinear(frame.data[at + 2]!),
    })
  }
  return count === 0 ? 0 : total / count
}

const rowIsBlack = (frame: Frame, y: number, threshold: number): boolean =>
  meanLuminance(frame, y * frame.width, frame.width, 1) <= threshold

/**
 * Whether a column is black between two rows.
 *
 * The bounds matter: averaged over the whole height, the bars the row scan
 * has just found drag a dark picture edge under the threshold, and the sides
 * of the image get thrown away as pillarboxing.
 */
const columnIsBlack = (
  frame: Frame,
  x: number,
  top: number,
  bottom: number,
  threshold: number,
): boolean =>
  meanLuminance(frame, top * frame.width + x, bottom - top + 1, frame.width) <= threshold

/**
 * The useful rectangle of the image, black bars removed.
 *
 * Without this step a 2.35:1 film switches off the top and bottom panels:
 * they would sample the bar, not the picture.
 *
 * Scanning stops at the first row above the threshold, and the result is
 * abandoned if the crop would eat more than 45 % of an axis — at that point
 * it is a dark scene, and cropping would make it disappear.
 */
export function detectLetterbox(frame: Frame, threshold = DEFAULT_THRESHOLD): Rect {
  const whole: Rect = { x: 0, y: 0, width: frame.width, height: frame.height }
  if (frame.width === 0 || frame.height === 0) return whole

  let top = 0
  while (top < frame.height && rowIsBlack(frame, top, threshold)) top += 1

  // The entire image sits below the threshold: nothing to crop.
  if (top === frame.height) return whole

  let bottom = frame.height - 1
  while (bottom > top && rowIsBlack(frame, bottom, threshold)) bottom -= 1

  let left = 0
  while (left < frame.width && columnIsBlack(frame, left, top, bottom, threshold)) left += 1

  let right = frame.width - 1
  while (right > left && columnIsBlack(frame, right, top, bottom, threshold)) right -= 1

  const height = bottom - top + 1
  const width = right - left + 1

  const tooTall = height < frame.height * (1 - MAX_CROP)
  const tooWide = width < frame.width * (1 - MAX_CROP)

  return {
    x: tooWide ? 0 : left,
    y: tooTall ? 0 : top,
    width: tooWide ? frame.width : width,
    height: tooTall ? frame.height : height,
  }
}
