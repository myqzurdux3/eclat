import type { LinearColor } from './srgb'

/**
 * Asymmetric temporal smoothing.
 *
 * A symmetric EMA forces a choice between two faults: fast, it makes the
 * panels strobe on every cut; slow, it makes the sync feel sluggish. Rising
 * quickly and falling slowly gives responsiveness without the strobe — the
 * eye forgives a lingering fade, not a late flash.
 *
 * Smoothing works on linear values, before the return to sRGB: smoothing
 * gamma-encoded numbers makes the low end breathe wrong.
 */
export class Smoother {
  private previous: LinearColor[] | null = null

  constructor(
    private readonly attack: number,
    private readonly release: number,
  ) {}

  /** Smooths one frame and returns the result. */
  push(colors: LinearColor[]): LinearColor[] {
    const previous = this.previous

    // First frame, or a wall whose panel count changed: take the value as it
    // is rather than fading up from black.
    if (previous === null || previous.length !== colors.length) {
      this.previous = colors.map((color) => ({ ...color }))
      return this.previous.map((color) => ({ ...color }))
    }

    const smoothed = colors.map((target, index) => {
      const before = previous[index]!
      return {
        r: this.channel(before.r, target.r),
        g: this.channel(before.g, target.g),
        b: this.channel(before.b, target.b),
      }
    })

    this.previous = smoothed
    return smoothed.map((color) => ({ ...color }))
  }

  reset(): void {
    this.previous = null
  }

  private channel(before: number, target: number): number {
    const coefficient = target > before ? this.attack : this.release
    return before + coefficient * (target - before)
  }
}
