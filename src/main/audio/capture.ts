import { spawn } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { EventEmitter } from 'node:events'
import { AudioAnalyser, BLOCK_SIZE, pcmToMono, type AudioFeatures } from '../../shared/audio/analyser'

const SAMPLE_RATE = 48000
const CHANNELS = 2
const BYTES_PER_FRAME = 2 * CHANNELS

/**
 * The slice of a child process this module uses. Narrower than Node's own
 * types, which vary with the `stdio` shape, and enough for a test double.
 */
export interface RecorderProcess extends EventEmitter {
  stdout: Readable
  stderr: Readable
  kill(signal?: NodeJS.Signals): boolean
}

export interface AudioCaptureOptions {
  onFeatures: (features: AudioFeatures) => void
  onError?: (message: string) => void
  /** Injected by tests; defaults to spawning `pw-record`. */
  spawnRecorder?: (sourceId: number) => RecorderProcess
}

/**
 * Spawns `pw-record` and turns its raw PCM into audio features.
 *
 * Chromium's `enumerateDevices()` exposes no monitor source on this desktop,
 * so the spec's fallback is the only path: read the sink's monitor directly
 * from PipeWire. `stream.capture.sink` is what makes the recorder tap the
 * output of a sink rather than its input.
 *
 * Note that PipeWire applies the sink volume before the monitor tap: a muted
 * output yields a silent capture, which is a system setting and not a fault
 * of this code.
 */
export class AudioCapture {
  private recorder: RecorderProcess | null = null
  private analyser = new AudioAnalyser(SAMPLE_RATE)
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0)

  constructor(private readonly options: AudioCaptureOptions) {}

  get running(): boolean {
    return this.recorder !== null
  }

  start(sourceId: number): void {
    this.stop()
    this.analyser = new AudioAnalyser(SAMPLE_RATE)
    this.pending = Buffer.alloc(0)

    const recorder = (this.options.spawnRecorder ?? defaultRecorder)(sourceId)
    this.recorder = recorder

    recorder.stdout.on('data', (chunk: Buffer) => this.consume(chunk))
    recorder.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim()
      if (message.length > 0) this.options.onError?.(message)
    })
    recorder.on('error', (cause) => this.options.onError?.(String(cause)))
    recorder.on('exit', (code) => {
      if (this.recorder === recorder) this.recorder = null
      if (code !== null && code !== 0) this.options.onError?.(`pw-record exited with ${code}`)
    })
  }

  stop(): void {
    this.recorder?.kill('SIGTERM')
    this.recorder = null
    this.analyser.reset()
    this.pending = Buffer.alloc(0)
  }

  /** Accumulates until a whole block is available, then analyses it. */
  private consume(chunk: Buffer<ArrayBufferLike>): void {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk])

    const blockBytes = BLOCK_SIZE * BYTES_PER_FRAME
    while (this.pending.length >= blockBytes) {
      const block = this.pending.subarray(0, blockBytes)
      this.pending = this.pending.subarray(blockBytes)
      this.options.onFeatures(this.analyser.push(pcmToMono(block, CHANNELS)))
    }
  }
}

function defaultRecorder(sourceId: number): RecorderProcess {
  return spawn(
    'pw-record',
    [
      '-P',
      '{ stream.capture.sink=true }',
      '--target',
      String(sourceId),
      '--rate',
      String(SAMPLE_RATE),
      '--channels',
      String(CHANNELS),
      '--format',
      's16',
      '-',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  ) as unknown as RecorderProcess
}
