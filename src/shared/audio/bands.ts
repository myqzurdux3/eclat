export interface BandEnergies {
  bass: number
  mid: number
  treble: number
}

/** Band boundaries in hertz: bass, mid, treble. */
export const BAND_EDGES_HZ = [20, 250, 2000, 16000] as const

/**
 * The energy of each band, averaged over the bins it covers.
 *
 * Dividing by the bin count is what makes the three comparable: bands are
 * spaced logarithmically, so the treble spans far more bins than the bass
 * and would win every time on a plain sum. On white noise the three should
 * come out roughly level, and there is a test that says so.
 */
export function bandEnergies(spectrum: Float32Array, sampleRate: number): BandEnergies {
  const binHz = sampleRate / 2 / spectrum.length

  const average = (fromHz: number, toHz: number): number => {
    const first = Math.max(1, Math.floor(fromHz / binHz))
    const last = Math.min(spectrum.length - 1, Math.ceil(toHz / binHz))
    if (last < first) return 0

    let total = 0
    for (let bin = first; bin <= last; bin += 1) total += spectrum[bin]!
    return total / (last - first + 1)
  }

  return {
    bass: average(BAND_EDGES_HZ[0], BAND_EDGES_HZ[1]),
    mid: average(BAND_EDGES_HZ[1], BAND_EDGES_HZ[2]),
    treble: average(BAND_EDGES_HZ[2], BAND_EDGES_HZ[3]),
  }
}
