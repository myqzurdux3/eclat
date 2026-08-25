import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { AudioCapture, type RecorderProcess } from './capture'
import { BLOCK_SIZE } from '../../shared/audio/analyser'
import type { AudioFeatures } from '../../shared/audio/analyser'

const BYTES_PER_BLOCK = BLOCK_SIZE * 4

/** A stand-in for `pw-record`: streams whatever bytes the test pushes. */
function fakeRecorder(): RecorderProcess & { killed: boolean } {
  const recorder = Object.assign(new EventEmitter(), {
    stdout: new Readable({ read() {} }),
    stderr: new Readable({ read() {} }),
    killed: false,
    kill(): boolean {
      recorder.killed = true
      return true
    },
  })
  return recorder
}

/** A block of stereo s16 holding a sine at `frequencyHz`. */
function toneBlock(frequencyHz: number, amplitude = 0.8): Buffer {
  const buffer = Buffer.alloc(BYTES_PER_BLOCK)
  for (let i = 0; i < BLOCK_SIZE; i += 1) {
    const value = Math.round(amplitude * 32000 * Math.sin((2 * Math.PI * frequencyHz * i) / 48000))
    buffer.writeInt16LE(value, i * 4)
    buffer.writeInt16LE(value, i * 4 + 2)
  }
  return buffer
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('AudioCapture', () => {
  it('reports nothing before it is started', () => {
    const capture = new AudioCapture({ onFeatures: () => undefined })

    expect(capture.running).toBe(false)
  })

  it('emits one set of features per complete block', async () => {
    const seen: AudioFeatures[] = []
    const recorder = fakeRecorder()
    const capture = new AudioCapture({
      onFeatures: (features) => seen.push(features),
      spawnRecorder: () => recorder,
    })

    capture.start(51)
    recorder.stdout.push(toneBlock(80))
    recorder.stdout.push(toneBlock(80))
    await tick()

    expect(seen).toHaveLength(2)
    expect(seen[0]!.bass).toBeGreaterThan(seen[0]!.treble)
  })

  it('waits for a whole block before analysing', async () => {
    const seen: AudioFeatures[] = []
    const recorder = fakeRecorder()
    const capture = new AudioCapture({
      onFeatures: (features) => seen.push(features),
      spawnRecorder: () => recorder,
    })

    capture.start(51)
    recorder.stdout.push(toneBlock(80).subarray(0, BYTES_PER_BLOCK - 8))
    await tick()

    expect(seen).toHaveLength(0)
  })

  it('reassembles a block split across two chunks', async () => {
    const seen: AudioFeatures[] = []
    const recorder = fakeRecorder()
    const capture = new AudioCapture({
      onFeatures: (features) => seen.push(features),
      spawnRecorder: () => recorder,
    })
    const block = toneBlock(80)

    capture.start(51)
    recorder.stdout.push(block.subarray(0, 500))
    recorder.stdout.push(block.subarray(500))
    await tick()

    expect(seen).toHaveLength(1)
  })

  it('surfaces what the recorder writes to stderr', async () => {
    const errors: string[] = []
    const recorder = fakeRecorder()
    const capture = new AudioCapture({
      onFeatures: () => undefined,
      onError: (message) => errors.push(message),
      spawnRecorder: () => recorder,
    })

    capture.start(51)
    recorder.stderr.push(Buffer.from('cannot connect\n'))
    await tick()

    expect(errors).toEqual(['cannot connect'])
  })

  it('reports a non-zero exit', async () => {
    const errors: string[] = []
    const recorder = fakeRecorder()
    const capture = new AudioCapture({
      onFeatures: () => undefined,
      onError: (message) => errors.push(message),
      spawnRecorder: () => recorder,
    })

    capture.start(51)
    recorder.emit('exit', 1)

    expect(errors[0]).toMatch(/exited with 1/)
  })

  it('kills the recorder on stop', () => {
    const recorder = fakeRecorder()
    const capture = new AudioCapture({
      onFeatures: () => undefined,
      spawnRecorder: () => recorder,
    })

    capture.start(51)
    capture.stop()

    expect(recorder.killed).toBe(true)
    expect(capture.running).toBe(false)
  })

  it('drops the leftovers of a previous run when restarted', async () => {
    const seen: AudioFeatures[] = []
    const first = fakeRecorder()
    const second = fakeRecorder()
    let call = 0
    const capture = new AudioCapture({
      onFeatures: (features) => seen.push(features),
      spawnRecorder: () => (call++ === 0 ? first : second),
    })

    capture.start(51)
    first.stdout.push(toneBlock(80).subarray(0, 500))
    await tick()

    capture.start(51)
    // Only half a block from the new recorder: the 500 stale bytes must not
    // be counted towards it.
    second.stdout.push(toneBlock(80).subarray(0, BYTES_PER_BLOCK - 500))
    await tick()

    expect(seen).toHaveLength(0)
  })
})
