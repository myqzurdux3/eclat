import { describe, expect, it } from 'vitest'
import { hannWindow, magnitudeSpectrum } from './fft'

/** A pure sine sitting exactly on bin `bin` of a `size`-point transform. */
function sine(size: number, bin: number, amplitude = 1): Float32Array {
  const samples = new Float32Array(size)
  for (let i = 0; i < size; i += 1) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * bin * i) / size)
  }
  return samples
}

/** Index of the largest magnitude. */
const peakBin = (spectrum: Float32Array): number =>
  spectrum.reduce((best, value, index) => (value > spectrum[best]! ? index : best), 0)


describe('hannWindow', () => {
  it('starts at zero and peaks in the middle', () => {
    const window = hannWindow(8)

    expect(window[0]).toBeCloseTo(0, 6)
    expect(window[4]).toBeCloseTo(1, 6)
    // Periodic Hann, the right variant for spectral analysis: the last
    // sample does not return to zero, since it would repeat sample 0 in the
    // next period. The symmetric variant belongs to filter design.
    expect(window.at(-1)).toBeCloseTo(0.1464, 3)
  })

  it('is symmetric', () => {
    const window = hannWindow(16)

    for (let i = 1; i < 8; i += 1) {
      expect(window[i]).toBeCloseTo(window[16 - i]!, 6)
    }
  })
})

describe('magnitudeSpectrum', () => {
  it('returns half as many magnitudes as samples', () => {
    expect(magnitudeSpectrum(sine(64, 8))).toHaveLength(32)
  })

  it('concentrates a pure sine on its own bin', () => {
    expect(peakBin(magnitudeSpectrum(sine(256, 20)))).toBe(20)
  })

  it('finds both tones of a two-tone signal', () => {
    const a = sine(256, 10)
    const b = sine(256, 60)
    const mixed = new Float32Array(256)
    for (let i = 0; i < 256; i += 1) mixed[i] = a[i]! + b[i]!

    const spectrum = magnitudeSpectrum(mixed)
    const around = (bin: number) =>
      Math.max(spectrum[bin - 1]!, spectrum[bin]!, spectrum[bin + 1]!)

    expect(around(10)).toBeGreaterThan(spectrum[35]! * 10)
    expect(around(60)).toBeGreaterThan(spectrum[35]! * 10)
  })

  it('returns a silent spectrum for silence', () => {
    for (const value of magnitudeSpectrum(new Float32Array(128))) {
      expect(value).toBeCloseTo(0, 6)
    }
  })

  it('scales with the amplitude of the signal', () => {
    const quiet = magnitudeSpectrum(sine(256, 20, 0.5))
    const loud = magnitudeSpectrum(sine(256, 20, 1))

    expect(loud[20]! / quiet[20]!).toBeCloseTo(2, 1)
  })

  it('refuses a size that is not a power of two', () => {
    expect(() => magnitudeSpectrum(new Float32Array(100))).toThrow(/power of two/i)
  })

  it('never returns a negative magnitude', () => {
    for (const value of magnitudeSpectrum(sine(128, 7))) {
      expect(value).toBeGreaterThanOrEqual(0)
    }
  })
})
