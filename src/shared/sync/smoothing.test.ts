import { describe, expect, it } from 'vitest'
import { Smoother } from './smoothing'

const noir = { r: 0, g: 0, b: 0 }
const blanc = { r: 1, g: 1, b: 1 }

describe('Smoother', () => {
  it('sort la première frame telle quelle, sans amorçage', () => {
    const smoother = new Smoother(0.6, 0.15)

    expect(smoother.push([blanc])).toEqual([blanc])
  })

  it('monte au rythme de l attaque', () => {
    const smoother = new Smoother(0.5, 0.1)
    smoother.push([noir])

    // 0 + 0,5 × (1 − 0) = 0,5 ; puis 0,5 + 0,5 × 0,5 = 0,75.
    expect(smoother.push([blanc])[0]!.r).toBeCloseTo(0.5, 6)
    expect(smoother.push([blanc])[0]!.r).toBeCloseTo(0.75, 6)
  })

  it('descend au rythme du relâchement', () => {
    const smoother = new Smoother(0.5, 0.1)
    smoother.push([blanc])

    // 1 − 0,1 × 1 = 0,9 ; puis 0,9 − 0,1 × 0,9 = 0,81.
    expect(smoother.push([noir])[0]!.r).toBeCloseTo(0.9, 6)
    expect(smoother.push([noir])[0]!.r).toBeCloseTo(0.81, 6)
  })

  it('monte plus vite qu il ne descend', () => {
    const montee = new Smoother(0.6, 0.15)
    montee.push([noir])
    const apresMontee = montee.push([blanc])[0]!.r

    const descente = new Smoother(0.6, 0.15)
    descente.push([blanc])
    const apresDescente = 1 - descente.push([noir])[0]!.r

    expect(apresMontee).toBeGreaterThan(apresDescente)
  })

  it('traite chaque canal séparément', () => {
    const smoother = new Smoother(0.5, 0.1)
    smoother.push([{ r: 1, g: 0, b: 0.5 }])

    const suite = smoother.push([{ r: 0, g: 1, b: 0.5 }])[0]!

    expect(suite.r).toBeCloseTo(0.9, 6)
    expect(suite.g).toBeCloseTo(0.5, 6)
    expect(suite.b).toBeCloseTo(0.5, 6)
  })

  it('traite chaque panneau séparément', () => {
    const smoother = new Smoother(0.5, 0.1)
    smoother.push([noir, blanc])

    const suite = smoother.push([blanc, noir])

    expect(suite[0]!.r).toBeCloseTo(0.5, 6)
    expect(suite[1]!.r).toBeCloseTo(0.9, 6)
  })

  it('repart de zéro après un reset', () => {
    const smoother = new Smoother(0.5, 0.1)
    smoother.push([blanc])

    smoother.reset()

    expect(smoother.push([noir])).toEqual([noir])
  })

  it('encaisse un changement du nombre de panneaux', () => {
    const smoother = new Smoother(0.5, 0.1)
    smoother.push([blanc, blanc, blanc])

    const suite = smoother.push([noir])

    expect(suite).toHaveLength(1)
    expect(Number.isFinite(suite[0]!.r)).toBe(true)
  })

  it('converge vers la valeur cible si elle ne bouge plus', () => {
    const smoother = new Smoother(0.6, 0.15)
    smoother.push([noir])
    let dernier = 0
    for (let i = 0; i < 60; i += 1) dernier = smoother.push([blanc])[0]!.r

    expect(dernier).toBeCloseTo(1, 4)
  })
})
