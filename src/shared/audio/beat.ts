export interface BeatDetectorOptions {
  /** How many blocks of history the threshold is computed from. */
  history?: number
  /** How many standard deviations above the mean counts as a beat. */
  sensitivity?: number
  /** Blocks to wait after a beat before another can fire. */
  refractoryBlocks?: number
}

const DEFAULTS = { history: 43, sensitivity: 1.8, refractoryBlocks: 4 }

/**
 * Beat detection by energy flux with an adaptive threshold.
 *
 * A fixed threshold only ever works on one track: what counts as a spike in
 * a quiet passage is the floor of a dense one. The bar here follows the
 * music — the mean of recent bass energy, plus a few standard deviations, so
 * it rises with the loudness *and* with how much the loudness varies.
 *
 * The refractory period stops a single drum hit spread across two blocks
 * from being counted twice.
 */
export class BeatDetector {
  private readonly history: number
  private readonly sensitivity: number
  private readonly refractoryBlocks: number

  private readonly recent: number[] = []
  private sinceLastBeat = Number.POSITIVE_INFINITY

  constructor(options: BeatDetectorOptions = {}) {
    // At least one block: a history of zero makes the mean a division by
    // zero, every threshold NaN, and every comparison false — beat detection
    // switched off for good, with nothing said.
    this.history = Math.max(1, Math.round(options.history ?? DEFAULTS.history))
    this.sensitivity = options.sensitivity ?? DEFAULTS.sensitivity
    this.refractoryBlocks = options.refractoryBlocks ?? DEFAULTS.refractoryBlocks
  }

  /** Feeds one block's bass energy and says whether it is a beat. */
  push(bassEnergy: number): boolean {
    this.sinceLastBeat += 1

    // Not enough history yet: any judgement would be guesswork.
    if (this.recent.length < this.history) {
      this.recent.push(bassEnergy)
      return false
    }

    const mean = this.recent.reduce((a, b) => a + b, 0) / this.recent.length
    const variance =
      this.recent.reduce((total, value) => total + (value - mean) ** 2, 0) / this.recent.length
    const deviation = Math.sqrt(variance)

    const beat =
      this.sinceLastBeat > this.refractoryBlocks &&
      bassEnergy > mean + this.sensitivity * deviation &&
      // A pure silence has zero mean and zero deviation, which every value
      // above zero would clear; require some actual energy.
      bassEnergy > 1e-4

    if (beat) this.sinceLastBeat = 0

    this.recent.push(bassEnergy)
    this.recent.shift()

    return beat
  }

  reset(): void {
    this.recent.length = 0
    this.sinceLastBeat = Number.POSITIVE_INFINITY
  }
}
