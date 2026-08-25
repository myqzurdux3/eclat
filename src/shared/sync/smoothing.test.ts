import { describe, expect, it } from 'vitest'
import { Smoother } from './smoothing'

const black = { r: 0, g: 0, b: 0 }
const white = { r: 1, g: 1, b: 1 }

describe('Smoother', () => {
  it('returns the first frame unchanged, with no warm-up', () => {
    const smoother = new Smoother(0.6, 0.15)

    expect(smoother.push([white])).toEqual([white])
  })

  it('rises at the attack rate', () => {
    const smoother = new Smoother(0.5, 0.1)
    smoother.push([black])

    // 0 + 0.5 x (1 - 0) = 0.5, then 0.5 + 0.5 x 0.5 = 0.75.
    expect(smoother.push([white])[0]!.r).toBeCloseTo(0.5, 6)
    expect(smoother.push([white])[0]!.r).toBeCloseTo(0.75, 6)
  })

  it('falls at the release rate', () => {
    const smoother = new Smoother(0.5, 0.1)
    smoother.push([white])

    // 1 - 0.1 x 1 = 0.9, then 0.9 - 0.1 x 0.9 = 0.81.
    expect(smoother.push([black])[0]!.r).toBeCloseTo(0.9, 6)
    expect(smoother.push([black])[0]!.r).toBeCloseTo(0.81, 6)
  })

  it('rises faster than it falls', () => {
    const rising = new Smoother(0.6, 0.15)
    rising.push([black])
    const afterRise = rising.push([white])[0]!.r

    const falling = new Smoother(0.6, 0.15)
    falling.push([white])
    const afterFall = 1 - falling.push([black])[0]!.r

    expect(afterRise).toBeGreaterThan(afterFall)
  })

  it('handles each channel separately', () => {
    const smoother = new Smoother(0.5, 0.1)
    smoother.push([{ r: 1, g: 0, b: 0.5 }])

    const next = smoother.push([{ r: 0, g: 1, b: 0.5 }])[0]!

    expect(next.r).toBeCloseTo(0.9, 6)
    expect(next.g).toBeCloseTo(0.5, 6)
    expect(next.b).toBeCloseTo(0.5, 6)
  })

  it('handles each panel separately', () => {
    const smoother = new Smoother(0.5, 0.1)
    smoother.push([black, white])

    const next = smoother.push([white, black])

    expect(next[0]!.r).toBeCloseTo(0.5, 6)
    expect(next[1]!.r).toBeCloseTo(0.9, 6)
  })

  it('starts over after a reset', () => {
    const smoother = new Smoother(0.5, 0.1)
    smoother.push([white])

    smoother.reset()

    expect(smoother.push([black])).toEqual([black])
  })

  it('survives a change in the panel count', () => {
    const smoother = new Smoother(0.5, 0.1)
    smoother.push([white, white, white])

    const next = smoother.push([black])

    expect(next).toHaveLength(1)
    expect(Number.isFinite(next[0]!.r)).toBe(true)
  })

  it('converges on the target once it stops moving', () => {
    const smoother = new Smoother(0.6, 0.15)
    smoother.push([black])
    let last = 0
    for (let i = 0; i < 60; i += 1) last = smoother.push([white])[0]!.r

    expect(last).toBeCloseTo(1, 4)
  })
})
