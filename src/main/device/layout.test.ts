import { describe, expect, it } from 'vitest'
import { normalizeLayout } from './layout'
import type { RawPanel } from '../../shared/types'

const panel = (panelId: number, x: number, y: number, shapeType = 7): RawPanel => ({
  panelId,
  x,
  y,
  o: 0,
  shapeType,
})

describe('normalizeLayout', () => {
  it('centre un panneau unique', () => {
    const layout = normalizeLayout([panel(1, 120, 340)], 67)
    expect(layout.panels).toHaveLength(1)
    expect(layout.panels[0]!.nx).toBeCloseTo(0.5)
    expect(layout.panels[0]!.ny).toBeCloseTo(0.5)
    expect(layout.aspect).toBe(1)
    expect(layout.sideLength).toBe(67)
  })

  it('étale deux panneaux horizontaux sur toute la largeur et les centre verticalement', () => {
    const layout = normalizeLayout([panel(1, 0, 50), panel(2, 100, 50)], 67)
    expect(layout.panels[0]!.nx).toBeCloseTo(0)
    expect(layout.panels[1]!.nx).toBeCloseTo(1)
    expect(layout.panels[0]!.ny).toBeCloseTo(0.5)
    expect(layout.panels[1]!.ny).toBeCloseTo(0.5)
  })

  it('inverse l axe vertical : un y device élevé donne un ny faible', () => {
    const layout = normalizeLayout([panel(1, 0, 0), panel(2, 0, 100)], 67)
    expect(layout.panels[0]!.ny).toBeCloseTo(1)
    expect(layout.panels[1]!.ny).toBeCloseTo(0)
  })

  it('préserve le rapport d aspect : une disposition large ne remplit pas la hauteur', () => {
    const layout = normalizeLayout(
      [panel(1, 0, 0), panel(2, 200, 0), panel(3, 100, 50)],
      67,
    )
    // aspect = (width + sideLength) / (height + sideLength) = (200+67)/(50+67) = 267/117
    expect(layout.aspect).toBeCloseTo(267 / 117)
    // hauteur totale 50 sur une échelle de 200 : la bande occupée fait 0.25,
    // donc centrée entre 0.375 et 0.625
    expect(layout.panels[0]!.ny).toBeCloseTo(0.625)
    expect(layout.panels[2]!.ny).toBeCloseTo(0.375)
  })

  it('calcule un aspect fini pour une rangée horizontale colinéaire (hauteur nulle)', () => {
    const layout = normalizeLayout([panel(1, 0, 0), panel(2, 100, 0)], 67)
    expect(Number.isFinite(layout.aspect)).toBe(true)
    expect(layout.aspect).toBeCloseTo(167 / 67)
  })

  it('calcule un aspect fini pour une colonne verticale colinéaire (largeur nulle)', () => {
    const layout = normalizeLayout([panel(1, 0, 0), panel(2, 0, 100)], 67)
    expect(Number.isFinite(layout.aspect)).toBe(true)
    expect(layout.aspect).toBeGreaterThan(0)
    expect(layout.aspect).toBeCloseTo(67 / 167)
  })

  it('écarte le panneau contrôleur (panelId 0) présent sur Lines et Elements', () => {
    const layout = normalizeLayout([panel(0, 999, 999, 12), panel(1, 0, 0), panel(2, 100, 0)], 67)
    expect(layout.panels.map((p) => p.panelId)).toEqual([1, 2])
    expect(layout.panels[1]!.nx).toBeCloseTo(1)
  })

  it('renvoie une disposition vide sans planter', () => {
    const layout = normalizeLayout([], 67)
    expect(layout.panels).toEqual([])
    expect(layout.aspect).toBe(1)
  })
})

describe('normalizeLayout — côté normalisé', () => {
  it('exprime le côté dans la même échelle que nx et ny', () => {
    const layout = normalizeLayout(
      [
        { panelId: 1, x: 0, y: 0, o: 0, shapeType: 8 },
        { panelId: 2, x: 200, y: 0, o: 0, shapeType: 8 },
      ],
      100,
    )

    expect(layout.nSideLength).toBeCloseTo(0.5, 6)
  })

  it('remplit le carré quand un seul panneau est présent', () => {
    const layout = normalizeLayout([{ panelId: 1, x: 5, y: 5, o: 0, shapeType: 8 }], 100)

    expect(layout.nSideLength).toBe(1)
  })

  it('renvoie un côté nul quand aucun panneau n est éclairable', () => {
    expect(normalizeLayout([{ panelId: 0, x: 0, y: 0, o: 0, shapeType: 12 }], 100).nSideLength)
      .toBe(0)
  })
})
