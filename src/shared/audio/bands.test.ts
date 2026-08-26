import { describe, expect, it } from 'vitest'
import { bandEnergies, BAND_EDGES_HZ } from './bands'
import { magnitudeSpectrum } from './fft'

const SIZE = 1024
const SAMPLE_RATE = 48000

/** A sine at a given frequency, analysed at `SAMPLE_RATE`. */
function spectrumOf(frequencyHz: number, amplitude = 1): Float32Array {
  const samples = new Float32Array(SIZE)
  for (let i = 0; i < SIZE; i += 1) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * frequencyHz * i) / SAMPLE_RATE)
  }
  return magnitudeSpectrum(samples)
}

function noiseSpectrum(): Float32Array {
  const samples = new Float32Array(SIZE)
  // A deterministic pseudo-random sequence: tests must not flake.
  let seed = 12345
  for (let i = 0; i < SIZE; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    samples[i] = (seed / 2147483648) * 2 - 1
  }
  return magnitudeSpectrum(samples)
}

describe('BAND_EDGES_HZ', () => {
  it('rises from bass to treble', () => {
    expect(BAND_EDGES_HZ).toEqual([20, 250, 2000, 16000])
  })
})

describe('bandEnergies', () => {
  it('puts a 100 Hz tone in the bass', () => {
    const { bass, mid, treble } = bandEnergies(spectrumOf(100), SAMPLE_RATE)

    expect(bass).toBeGreaterThan(mid * 10)
    expect(bass).toBeGreaterThan(treble * 10)
  })

  it('puts a 1 kHz tone in the mids', () => {
    const { bass, mid, treble } = bandEnergies(spectrumOf(1000), SAMPLE_RATE)

    expect(mid).toBeGreaterThan(bass * 10)
    expect(mid).toBeGreaterThan(treble * 10)
  })

  it('puts an 8 kHz tone in the treble', () => {
    const { bass, mid, treble } = bandEnergies(spectrumOf(8000), SAMPLE_RATE)

    expect(treble).toBeGreaterThan(bass * 10)
    expect(treble).toBeGreaterThan(mid * 10)
  })

  it('returns three zeros for silence', () => {
    expect(bandEnergies(magnitudeSpectrum(new Float32Array(SIZE)), SAMPLE_RATE)).toEqual({
      bass: 0,
      mid: 0,
      treble: 0,
    })
  })

  it('fills all three comparably on white noise', () => {
    // This is the check that the per-band bin count is divided out: an
    // octave up covers far more bins than an octave down, so without it the
    // treble would always win.
    const { bass, mid, treble } = bandEnergies(noiseSpectrum(), SAMPLE_RATE)
    const values = [bass, mid, treble]

    expect(Math.min(...values)).toBeGreaterThan(0)
    expect(Math.max(...values) / Math.min(...values)).toBeLessThan(3)
  })

  it('grows with the amplitude of the signal', () => {
    const quiet = bandEnergies(spectrumOf(100, 0.25), SAMPLE_RATE).bass
    const loud = bandEnergies(spectrumOf(100, 1), SAMPLE_RATE).bass

    expect(loud).toBeGreaterThan(quiet * 3)
  })

  it('never returns a negative energy', () => {
    for (const value of Object.values(bandEnergies(noiseSpectrum(), SAMPLE_RATE))) {
      expect(value).toBeGreaterThanOrEqual(0)
    }
  })

  it('survives a sample rate too low to reach the treble band', () => {
    const energies = bandEnergies(spectrumOf(100), 8000)

    for (const value of Object.values(energies)) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })
})

describe('band edges', () => {
  /**
   * `floor` below and `ceil` above made neighbouring bands share their edge
   * bins: at 48 kHz the bass ran to bin 6 while the mid started at bin 5, so
   * a pure 234 Hz tone lit the mid band as well — and fed the beat detector
   * twice over.
   */
  it('gives no bin to two bands at once', () => {
    const spectrum = new Float32Array(512)
    const sampleRate = 48000

    const claimed = new Map<number, string[]>()
    for (const [name, index] of [
      ['bass', 0],
      ['mid', 1],
      ['treble', 2],
    ] as const) {
      for (let bin = 0; bin < spectrum.length; bin += 1) {
        spectrum.fill(0)
        spectrum[bin] = 1
        const energies = bandEnergies(spectrum, sampleRate)
        if (energies[name] > 0) claimed.set(bin, [...(claimed.get(bin) ?? []), name])
      }
      void index
    }

    const shared = [...claimed].filter(([, names]) => names.length > 1)
    expect(shared).toEqual([])
  })
})
