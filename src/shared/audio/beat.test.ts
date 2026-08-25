import { describe, expect, it } from 'vitest'
import { BeatDetector } from './beat'

/** Feeds `count` blocks of the same energy and counts the beats. */
function feed(detector: BeatDetector, value: number, count: number): number {
  let beats = 0
  for (let i = 0; i < count; i += 1) if (detector.push(value)) beats += 1
  return beats
}

describe('BeatDetector', () => {
  it('never fires on a constant signal', () => {
    const detector = new BeatDetector()

    expect(feed(detector, 0.4, 120)).toBe(0)
  })

  it('does not fire before it has any history', () => {
    const detector = new BeatDetector({ history: 20 })

    expect(detector.push(10)).toBe(false)
  })

  it('fires on a spike after a quiet passage', () => {
    const detector = new BeatDetector({ refractoryBlocks: 0 })
    feed(detector, 0.1, 60)

    expect(detector.push(1)).toBe(true)
  })

  it('counts two close spikes only once, the refractory period holding', () => {
    const detector = new BeatDetector({ refractoryBlocks: 5 })
    feed(detector, 0.1, 60)

    const first = detector.push(1)
    const second = detector.push(1)

    expect(first).toBe(true)
    expect(second).toBe(false)
  })

  it('fires again once the refractory period has passed', () => {
    const detector = new BeatDetector({ refractoryBlocks: 2 })
    feed(detector, 0.1, 60)

    expect(detector.push(1)).toBe(true)
    feed(detector, 0.1, 3)

    expect(detector.push(1)).toBe(true)
  })

  it('adapts: a uniformly loud passage stops firing', () => {
    const detector = new BeatDetector({ refractoryBlocks: 0 })
    feed(detector, 0.1, 60)
    detector.push(1)

    // Everything is loud now; the threshold has to follow.
    const beats = feed(detector, 1, 200)

    expect(beats).toBeLessThan(20)
  })

  it('still hears a beat over a loud passage', () => {
    const detector = new BeatDetector({ refractoryBlocks: 0 })
    feed(detector, 0.5, 80)

    expect(detector.push(3)).toBe(true)
  })

  it('forgets its history after a reset', () => {
    const detector = new BeatDetector({ refractoryBlocks: 0 })
    feed(detector, 0.1, 60)

    detector.reset()

    expect(detector.push(1)).toBe(false)
  })

  it('tolerates zero energy without dividing by zero', () => {
    const detector = new BeatDetector({ refractoryBlocks: 0 })

    expect(() => feed(detector, 0, 100)).not.toThrow()
    expect(feed(detector, 0, 10)).toBe(0)
  })
})
