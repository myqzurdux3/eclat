import { describe, expect, it } from 'vitest'
import { AudioAnalyser, BLOCK_SIZE, pcmToMono } from './analyser'

const SAMPLE_RATE = 48000

function tone(frequencyHz: number, amplitude = 0.8): Float32Array {
  const block = new Float32Array(BLOCK_SIZE)
  for (let i = 0; i < BLOCK_SIZE; i += 1) {
    block[i] = amplitude * Math.sin((2 * Math.PI * frequencyHz * i) / SAMPLE_RATE)
  }
  return block
}

/** Interleaved stereo s16, little-endian, as `pw-record` writes it. */
function interleaved(left: number[], right: number[]): Buffer {
  const buffer = Buffer.alloc(left.length * 4)
  left.forEach((value, index) => {
    buffer.writeInt16LE(value, index * 4)
    buffer.writeInt16LE(right[index]!, index * 4 + 2)
  })
  return buffer
}

describe('pcmToMono', () => {
  it('averages the two channels', () => {
    const mono = pcmToMono(interleaved([32767, 0], [0, 32767]), 2)

    expect(mono).toHaveLength(2)
    expect(mono[0]).toBeCloseTo(0.5, 2)
    expect(mono[1]).toBeCloseTo(0.5, 2)
  })

  it('passes a mono stream straight through', () => {
    const buffer = Buffer.alloc(4)
    buffer.writeInt16LE(16384, 0)
    buffer.writeInt16LE(-16384, 2)

    const mono = pcmToMono(buffer, 1)

    expect(mono[0]).toBeCloseTo(0.5, 2)
    expect(mono[1]).toBeCloseTo(-0.5, 2)
  })

  it('stays within [-1, 1]', () => {
    const mono = pcmToMono(interleaved([-32768, 32767], [-32768, 32767]), 2)

    for (const value of mono) {
      expect(value).toBeGreaterThanOrEqual(-1)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('ignores a trailing partial frame', () => {
    // Five bytes: two complete stereo frames need eight.
    expect(pcmToMono(Buffer.alloc(5), 2)).toHaveLength(1)
  })

  it('returns an empty array for an empty buffer', () => {
    expect(pcmToMono(Buffer.alloc(0), 2)).toHaveLength(0)
  })
})

describe('AudioAnalyser', () => {
  it('returns silent features for silence', () => {
    const analyser = new AudioAnalyser(SAMPLE_RATE)

    const features = analyser.push(new Float32Array(BLOCK_SIZE))

    expect(features.bass).toBe(0)
    expect(features.mid).toBe(0)
    expect(features.treble).toBe(0)
    expect(features.beat).toBe(false)
    expect(features.level).toBe(0)
  })

  it('sends a low tone to the bass', () => {
    const analyser = new AudioAnalyser(SAMPLE_RATE)

    const features = analyser.push(tone(80))

    expect(features.bass).toBeGreaterThan(features.mid)
    expect(features.bass).toBeGreaterThan(features.treble)
  })

  it('sends a high tone to the treble', () => {
    const analyser = new AudioAnalyser(SAMPLE_RATE)

    const features = analyser.push(tone(9000))

    expect(features.treble).toBeGreaterThan(features.bass)
  })

  it('tracks amplitude through the level', () => {
    const analyser = new AudioAnalyser(SAMPLE_RATE)

    const quiet = analyser.push(tone(440, 0.1)).level
    const loud = analyser.push(tone(440, 0.9)).level

    expect(loud).toBeGreaterThan(quiet)
  })

  it('keeps every feature within [0, 1]', () => {
    const analyser = new AudioAnalyser(SAMPLE_RATE)

    for (const frequency of [50, 440, 3000, 12000]) {
      const features = analyser.push(tone(frequency, 1))
      for (const value of [features.bass, features.mid, features.treble, features.level]) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    }
  })

  it('pads a short block rather than refusing it', () => {
    const analyser = new AudioAnalyser(SAMPLE_RATE)

    expect(() => analyser.push(new Float32Array(100))).not.toThrow()
  })

  it('forgets its history on reset', () => {
    const analyser = new AudioAnalyser(SAMPLE_RATE)
    for (let i = 0; i < 80; i += 1) analyser.push(tone(80, 0.05))

    analyser.reset()

    expect(analyser.push(tone(80, 1)).beat).toBe(false)
  })
})
