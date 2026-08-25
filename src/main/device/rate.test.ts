import { describe, expect, it } from 'vitest'
import { RateGovernor } from './rate'

/** Horloge manuelle : le régulateur ne doit jamais lire l'heure système. */
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
  it('démarre à la cadence cible', () => {
    expect(new RateGovernor({ targetHz: 30 }).hz).toBe(30)
    expect(new RateGovernor({ targetHz: 25 }).intervalMs).toBe(40)
  })

  it('autorise le premier envoi', () => {
    expect(new RateGovernor({ now: clock().now }).shouldSend()).toBe(true)
  })

  it('refuse un envoi trop rapproché', () => {
    const time = clock()
    const governor = new RateGovernor({ targetHz: 30, now: time.now })

    governor.recordSent()
    time.advance(10)

    expect(governor.shouldSend()).toBe(false)
  })

  it('autorise l envoi une fois l intervalle écoulé', () => {
    const time = clock()
    const governor = new RateGovernor({ targetHz: 30, now: time.now })

    governor.recordSent()
    time.advance(34)

    expect(governor.shouldSend()).toBe(true)
  })

  it('baisse la cadence après des intervalles trop longs répétés', () => {
    const time = clock()
    const governor = new RateGovernor({ targetHz: 30, now: time.now, patience: 3 })

    governor.recordSent()
    for (let i = 0; i < 3; i += 1) {
      time.advance(120)
      governor.recordSent()
    }

    expect(governor.hz).toBeLessThan(30)
  })

  it('ne descend jamais sous la cadence plancher', () => {
    const time = clock()
    const governor = new RateGovernor({ targetHz: 30, minHz: 10, now: time.now, patience: 1 })

    governor.recordSent()
    for (let i = 0; i < 50; i += 1) {
      time.advance(5000)
      governor.recordSent()
    }

    expect(governor.hz).toBe(10)
  })

  it('remonte vers la cible quand la cadence redevient tenable', () => {
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

  it('ne dépasse jamais la cadence cible', () => {
    const time = clock()
    const governor = new RateGovernor({ targetHz: 25, now: time.now })

    for (let i = 0; i < 100; i += 1) {
      time.advance(40)
      governor.recordSent()
    }

    expect(governor.hz).toBe(25)
  })
})
