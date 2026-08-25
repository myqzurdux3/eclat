import { describe, expect, it } from 'vitest'
import { circumradius, panelPolygon } from './geometry'
import type { NormalizedPanel } from './types'

const panel = (over: Partial<NormalizedPanel> = {}): NormalizedPanel => ({
  panelId: 1,
  x: 0,
  y: 0,
  o: 0,
  shapeType: 8,
  nx: 0.5,
  ny: 0.5,
  ...over,
})

const near = (value: number, expected: number) => expect(value).toBeCloseTo(expected, 6)

describe('circumradius', () => {
  it('vaut le côté divisé par racine de trois pour un triangle', () => {
    near(circumradius(3, 1), 1 / Math.sqrt(3))
  })

  it('vaut le côté pour un hexagone', () => {
    near(circumradius(6, 1), 1)
  })
})

describe('panelPolygon', () => {
  it('rend trois sommets pour un triangle Shapes', () => {
    expect(panelPolygon(panel({ shapeType: 8 }), 0.2)).toHaveLength(3)
  })

  it('rend six sommets pour un hexagone Shapes', () => {
    expect(panelPolygon(panel({ shapeType: 7 }), 0.2)).toHaveLength(6)
  })

  it('rend quatre sommets pour un carré Canvas', () => {
    expect(panelPolygon(panel({ shapeType: 2 }), 0.2)).toHaveLength(4)
  })

  it('retombe sur un carré pour une forme inconnue', () => {
    expect(panelPolygon(panel({ shapeType: 999 }), 0.2)).toHaveLength(4)
  })

  it('place chaque sommet à la distance du rayon circonscrit', () => {
    const points = panelPolygon(panel(), 0.3)

    for (const point of points) {
      near(Math.hypot(point.x - 0.5, point.y - 0.5), circumradius(3, 0.3))
    }
  })

  it('pointe un sommet vers le haut à orientation nulle', () => {
    const [first] = panelPolygon(panel({ o: 0 }), 0.3)

    near(first!.x, 0.5)
    expect(first!.y).toBeLessThan(0.5)
  })

  it('retourne le triangle à 180 degrés', () => {
    const [first] = panelPolygon(panel({ o: 180 }), 0.3)

    near(first!.x, 0.5)
    expect(first!.y).toBeGreaterThan(0.5)
  })

  it('tourne dans le sens des aiguilles, l axe Y étant inversé à l écran', () => {
    const [first] = panelPolygon(panel({ o: 90 }), 0.3)

    near(first!.y, 0.5)
    expect(first!.x).toBeLessThan(0.5)
  })

  it('centre le polygone sur la position normalisée du panneau', () => {
    const points = panelPolygon(panel({ nx: 0.25, ny: 0.75 }), 0.3)
    const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length
    const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length

    near(cx, 0.25)
    near(cy, 0.75)
  })
})
