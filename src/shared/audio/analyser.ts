import { bandEnergies } from './bands'
import { BeatDetector } from './beat'
import { magnitudeSpectrum } from './fft'

/** Samples per analysis block, as the spec requires. */
export const BLOCK_SIZE = 1024

export interface AudioFeatures {
  bass: number
  mid: number
  treble: number
  beat: boolean
  /** RMS of the block, useful for switching the wall off when nothing plays. */
  level: number
}

const SILENT: AudioFeatures = { bass: 0, mid: 0, treble: 0, beat: false, level: 0 }

/**
 * Interleaved signed 16-bit PCM to mono floats in [-1, 1].
 *
 * This is the format `pw-record --format s16` writes. A trailing partial
 * frame is dropped: half a sample is not a sample.
 */
export function pcmToMono(buffer: Buffer, channels: number): Float32Array {
  const bytesPerFrame = 2 * channels
  const frames = Math.floor(buffer.length / bytesPerFrame)
  const mono = new Float32Array(frames)

  for (let frame = 0; frame < frames; frame += 1) {
    let total = 0
    for (let channel = 0; channel < channels; channel += 1) {
      total += buffer.readInt16LE(frame * bytesPerFrame + channel * 2)
    }
    // 32768 rather than 32767: the negative extreme is the wider one, and
    // dividing by 32767 would let a full-scale trough fall below -1.
    mono[frame] = total / channels / 32768
  }

  return mono
}

/** Smoothing applied to the three bands so the colours do not shiver. */
const SMOOTHING = 0.35
/** Divisor turning raw band energy into something close to [0, 1]. */
const REFERENCE = 0.05

/**
 * Turns blocks of audio into normalised features.
 *
 * Only the beat detector and the band smoothing carry state; the spectral
 * work is a pure function of the block.
 */
export class AudioAnalyser {
  private readonly detector = new BeatDetector()
  private smoothed = { bass: 0, mid: 0, treble: 0 }

  constructor(private readonly sampleRate: number) {}

  push(block: Float32Array): AudioFeatures {
    if (block.length === 0) return { ...SILENT }

    // A short block is padded rather than refused: the capture stream does
    // not align its chunks on our block size. A longer one is analysed on its
    // first `BLOCK_SIZE` samples — the FFT needs a power of two.
    const heard = Math.min(block.length, BLOCK_SIZE)
    let samples = block
    if (block.length !== BLOCK_SIZE) {
      samples = new Float32Array(BLOCK_SIZE)
      samples.set(block.subarray(0, heard))
    }

    // Divided by what was actually heard, not by the padding. Dividing by
    // the full block would report a short one as quieter than it is, and the
    // level drives the gate and the meter.
    let sumOfSquares = 0
    for (let i = 0; i < heard; i += 1) sumOfSquares += samples[i]! * samples[i]!
    const level = Math.min(1, Math.sqrt(sumOfSquares / heard))

    if (level === 0) {
      this.smoothed = { bass: 0, mid: 0, treble: 0 }
      this.detector.push(0)
      return { ...SILENT }
    }

    const raw = bandEnergies(magnitudeSpectrum(samples), this.sampleRate)
    const beat = this.detector.push(raw.bass)

    const blend = (before: number, next: number): number =>
      Math.min(1, before + SMOOTHING * (Math.min(1, next / REFERENCE) - before))

    this.smoothed = {
      bass: blend(this.smoothed.bass, raw.bass),
      mid: blend(this.smoothed.mid, raw.mid),
      treble: blend(this.smoothed.treble, raw.treble),
    }

    return { ...this.smoothed, beat, level }
  }

  reset(): void {
    this.detector.reset()
    this.smoothed = { bass: 0, mid: 0, treble: 0 }
  }
}
