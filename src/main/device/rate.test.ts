import { describe, expect, it } from 'vitest'
import { RateGovernor } from './rate'

/** A manual clock: the governor must never read the system time. */
function clock() {
  let value = 0
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms
    },
  }
}

describe('RateGovernor', () => {
  it('starts at the target rate', () => {
    expect(new RateGovernor({ targetHz: 30 }).hz).toBe(30)
    expect(new RateGovernor({ targetHz: 25 }).intervalMs).toBe(40)
  })

  it('allows the first send', () => {
    expect(new RateGovernor({ now: clock().now }).shouldSend()).toBe(true)
  })

  it('refuses a send that comes too soon', () => {
    const time = clock()
    const governor = new RateGovernor({ targetHz: 30, now: time.now })

    governor.recordSent()
    time.advance(10)

    expect(governor.shouldSend()).toBe(false)
  })

  it('allows the send once the interval has elapsed', () => {
    const time = clock()
    const governor = new RateGovernor({ targetHz: 30, now: time.now })

    governor.recordSent()
    time.advance(34)

    expect(governor.shouldSend()).toBe(true)
  })

  it('lowers the rate after repeated over-long intervals', () => {
    const time = clock()
    const governor = new RateGovernor({ targetHz: 30, now: time.now, patience: 3 })

    governor.recordSent()
    for (let i = 0; i < 3; i += 1) {
      time.advance(120)
      governor.recordSent()
    }

    expect(governor.hz).toBeLessThan(30)
  })

  it('never drops below the floor rate', () => {
    const time = clock()
    const governor = new RateGovernor({ targetHz: 30, minHz: 10, now: time.now, patience: 1 })

    governor.recordSent()
    for (let i = 0; i < 50; i += 1) {
      time.advance(5000)
      governor.recordSent()
    }

    expect(governor.hz).toBe(10)
  })

  it('climbs back towards the target once the rate is sustainable again', () => {
    const time = clock()
    const governor = new RateGovernor({ targetHz: 30, now: time.now, patience: 2 })

    governor.recordSent()
    for (let i = 0; i < 2; i += 1) {
      time.advance(200)
      governor.recordSent()
    }
    const degraded = governor.hz

    for (let i = 0; i < 40; i += 1) {
      time.advance(governor.intervalMs)
      governor.recordSent()
    }

    expect(governor.hz).toBeGreaterThan(degraded)
    expect(governor.hz).toBeLessThanOrEqual(30)
  })

  it('never exceeds the target rate', () => {
    const time = clock()
    const governor = new RateGovernor({ targetHz: 25, now: time.now })

    for (let i = 0; i < 100; i += 1) {
      time.advance(40)
      governor.recordSent()
    }

    expect(governor.hz).toBe(25)
  })
})
