import { describe, expect, it } from 'vitest'
import { circumradius, panelAt, panelPolygon, pointInPolygon, rotateLayout } from './geometry'
import { normalizeLayout } from '../main/device/layout'
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

describe('pointInPolygon', () => {
  const carre = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]

  it('accepte un point intérieur', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, carre)).toBe(true)
  })

  it('refuse un point extérieur', () => {
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, carre)).toBe(false)
  })

  it('refuse un polygone dégénéré', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBe(false)
  })
})

describe('panelAt', () => {
  const layout = normalizeLayout(
    [
      { panelId: 11, x: 0, y: 0, o: 0, shapeType: 8 },
      { panelId: 22, x: 300, y: 0, o: 0, shapeType: 8 },
    ],
    100,
  )

  it('désigne le panneau sous le point', () => {
    const cible = layout.panels[1]!

    expect(panelAt(layout, { x: cible.nx, y: cible.ny })?.panelId).toBe(22)
  })

  it('ne désigne rien dans le vide', () => {
    expect(panelAt(layout, { x: 0.5, y: 0.02 })).toBeNull()
  })
})

describe('rotateLayout', () => {
  const layout = normalizeLayout(
    [
      { panelId: 1, x: 0, y: 0, o: 0, shapeType: 8 },
      { panelId: 2, x: 0, y: 300, o: 0, shapeType: 8 },
    ],
    100,
  )

  it('ne touche à rien pour un angle nul', () => {
    expect(rotateLayout(layout, 0)).toEqual(layout)
  })

  it('amène le haut à droite pour un quart de tour', () => {
    const haut = layout.panels.reduce((a, b) => (a.ny < b.ny ? a : b))
    const droite = rotateLayout(layout, 90).panels.reduce((a, b) => (a.nx > b.nx ? a : b))

    expect(droite.panelId).toBe(haut.panelId)
  })

  it('retranche l angle à l orientation de chaque panneau', () => {
    expect(rotateLayout(layout, 37).panels[0]!.o).toBe(layout.panels[0]!.o - 37)
  })

  it('accepte un angle qui n est pas un multiple de 90', () => {
    const oblique = rotateLayout(layout, 37)

    for (const panel of oblique.panels) {
      expect(Number.isFinite(panel.nx)).toBe(true)
      expect(Number.isFinite(panel.ny)).toBe(true)
    }
    expect(oblique.panels[0]!.nx).not.toBeCloseTo(layout.panels[0]!.nx, 3)
  })

  it('conserve les distances entre panneaux', () => {
    const ecart = (l: typeof layout) =>
      Math.hypot(
        l.panels[0]!.nx - l.panels[1]!.nx,
        l.panels[0]!.ny - l.panels[1]!.ny,
      )

    expect(ecart(rotateLayout(layout, 37))).toBeCloseTo(ecart(layout), 6)
  })

  it('fait revenir un tour complet au point de départ', () => {
    const retour = rotateLayout(layout, 360)

    retour.panels.forEach((panel, index) => {
      expect(panel.nx).toBeCloseTo(layout.panels[index]!.nx, 6)
      expect(panel.ny).toBeCloseTo(layout.panels[index]!.ny, 6)
    })
  })

  it('tourne aussi les polygones, pas seulement les centres', () => {
    const avant = panelPolygon(layout.panels[0]!, layout.nSideLength)
    const tourne = rotateLayout(layout, 90)
    const apres = panelPolygon(tourne.panels[0]!, tourne.nSideLength)

    // Un sommet pointé vers le haut se retrouve pointé vers la droite.
    expect(avant[0]!.y).toBeLessThan(layout.panels[0]!.ny)
    expect(apres[0]!.x).toBeGreaterThan(tourne.panels[0]!.nx)
  })

  it('accepte un angle négatif', () => {
    expect(rotateLayout(layout, -90).panels[0]!.nx).toBeCloseTo(
      rotateLayout(layout, 270).panels[0]!.nx,
      6,
    )
  })

  it('recalcule le rapport d aspect depuis la géométrie tournée', () => {
    const tourne = rotateLayout(layout, 90)

    // Un quart de tour inverse le rapport, à ceci près que la valeur tournée
    // mesure l'étendue réelle des sommets là où `normalizeLayout` approxime
    // depuis les seuls centres : les deux ne coïncident pas exactement.
    expect(tourne.aspect).toBeGreaterThan(1)
    expect(Math.abs(tourne.aspect * layout.aspect - 1)).toBeLessThan(0.1)
  })
})
