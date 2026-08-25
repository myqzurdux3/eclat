import { describe, expect, it } from 'vitest'
import { fitTransform, unproject, wallBounds } from './view'
import { normalizeLayout } from '../main/device/layout'
import { panelPolygon } from './geometry'

const rangee = normalizeLayout(
  [
    { panelId: 1, x: 0, y: 0, o: 0, shapeType: 8 },
    { panelId: 2, x: 200, y: 0, o: 0, shapeType: 8 },
  ],
  100,
)

describe('wallBounds', () => {
  it('englobe les sommets, pas seulement les centres', () => {
    const bounds = wallBounds(rangee)
    const sommets = rangee.panels.flatMap((panel) => panelPolygon(panel, rangee.nSideLength))

    expect(bounds.minX).toBeCloseTo(Math.min(...sommets.map((p) => p.x)), 6)
    expect(bounds.maxY).toBeCloseTo(Math.max(...sommets.map((p) => p.y)), 6)
  })

  it('déborde du carré des centres', () => {
    expect(wallBounds(rangee).minX).toBeLessThan(0)
  })

  it('rend une boîte unitaire sans panneau', () => {
    expect(wallBounds(normalizeLayout([], 100))).toEqual({
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
    })
  })
})

describe('fitTransform', () => {
  const carre = { minX: 0, minY: 0, maxX: 1, maxY: 1 }

  it('garde les carrés carrés dans un canvas carré', () => {
    const { scale } = fitTransform(carre, 1)

    expect(scale[0]).toBeCloseTo(scale[1], 6)
  })

  it('compense un canvas large en resserrant l axe X', () => {
    const { scale } = fitTransform(carre, 2)

    expect(scale[0]).toBeCloseTo(scale[1] / 2, 6)
  })

  it('vise le centre de la boîte', () => {
    const { centre } = fitTransform({ minX: 2, minY: 4, maxX: 6, maxY: 10 }, 1)

    expect(centre).toEqual([4, 7])
  })

  it('tient dans le repère de clip, marge comprise', () => {
    const { scale } = fitTransform(carre, 1, 0.9)

    // Demi-largeur du contenu, mise à l'échelle, sous la marge.
    expect(0.5 * scale[0]).toBeLessThanOrEqual(0.9 + 1e-9)
    expect(0.5 * scale[1]).toBeCloseTo(0.9, 6)
  })

  it('remplit l axe contraint, sans laisser de vide', () => {
    // Contenu deux fois plus large que haut dans un canvas carré : c'est X
    // qui contraint, et il doit toucher la marge.
    const { scale } = fitTransform({ minX: 0, minY: 0, maxX: 2, maxY: 1 }, 1, 0.9)

    expect(1 * scale[0]).toBeCloseTo(0.9, 6)
    expect(0.5 * scale[1]).toBeLessThanOrEqual(0.9 + 1e-9)
  })

  it('survit à une boîte dégénérée', () => {
    const { scale } = fitTransform({ minX: 3, minY: 3, maxX: 3, maxY: 3 }, 1)

    expect(Number.isFinite(scale[0])).toBe(true)
    expect(Number.isFinite(scale[1])).toBe(true)
  })
})

describe('unproject', () => {
  it('renvoie le centre de la boîte au centre du canvas', () => {
    const bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 }
    const transform = fitTransform(bounds, 1)

    const point = unproject(transform, 0.5, 0.5)

    expect(point.x).toBeCloseTo(0.5, 6)
    expect(point.y).toBeCloseTo(0.5, 6)
  })

  it('fait l aller-retour sur un point quelconque', () => {
    const transform = fitTransform({ minX: -0.2, minY: 0.1, maxX: 1.3, maxY: 0.9 }, 1.6, 0.9)
    // Projection directe, celle que fait le shader.
    const cible = { x: 0.42, y: 0.61 }
    const ndcX = (cible.x - transform.centre[0]) * transform.scale[0]
    const ndcY = -(cible.y - transform.centre[1]) * transform.scale[1]

    const retour = unproject(transform, (ndcX + 1) / 2, (1 - ndcY) / 2)

    expect(retour.x).toBeCloseTo(cible.x, 6)
    expect(retour.y).toBeCloseTo(cible.y, 6)
  })
})
