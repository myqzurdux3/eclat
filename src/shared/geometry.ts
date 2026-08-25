import type { NormalizedPanel, PanelLayout } from './types'

export interface Point {
  x: number
  y: number
}

/**
 * Formes connues du device, indexées par `shapeType`.
 *
 * `baseAngleDeg` est l'angle du premier sommet à orientation nulle, mesuré
 * dans le repère écran (Y vers le bas) : -90° pointe vers le haut. Les
 * triangles Shapes ont une pointe en haut, les hexagones sont à sommet plat,
 * les carrés ont leurs arêtes parallèles aux axes.
 */
export const SHAPE_GEOMETRY: Record<number, { sides: number; baseAngleDeg: number }> = {
  0: { sides: 3, baseAngleDeg: -90 }, // triangle Aurora
  1: { sides: 3, baseAngleDeg: -90 }, // Rhythm
  2: { sides: 4, baseAngleDeg: -45 }, // carré Canvas
  3: { sides: 4, baseAngleDeg: -45 }, // carré de contrôle Canvas
  4: { sides: 4, baseAngleDeg: -45 }, // carré de contrôle passif
  7: { sides: 6, baseAngleDeg: 0 }, // hexagone Shapes
  8: { sides: 3, baseAngleDeg: -90 }, // triangle Shapes
  9: { sides: 3, baseAngleDeg: -90 }, // mini triangle Shapes
  14: { sides: 6, baseAngleDeg: 0 }, // hexagone Elements
  15: { sides: 6, baseAngleDeg: 0 },
  16: { sides: 6, baseAngleDeg: 0 },
}

const FALLBACK = { sides: 4, baseAngleDeg: -45 }

/** Rayon du cercle circonscrit d'un polygone régulier. */
export function circumradius(sides: number, sideLength: number): number {
  return sideLength / (2 * Math.sin(Math.PI / sides))
}

/**
 * Sommets d'un panneau dans l'espace normalisé, prêts pour le rendu.
 *
 * Le device mesure `o` dans le sens trigonométrique avec un axe Y vers le
 * haut ; `normalizeLayout` ayant inversé cet axe, la rotation devient
 * horaire ici, d'où le signe négatif.
 */
export function panelPolygon(panel: NormalizedPanel, nSideLength: number): Point[] {
  const shape = SHAPE_GEOMETRY[panel.shapeType] ?? FALLBACK
  const radius = circumradius(shape.sides, nSideLength)
  const step = 360 / shape.sides

  return Array.from({ length: shape.sides }, (_, index) => {
    const angle = ((shape.baseAngleDeg - panel.o + index * step) * Math.PI) / 180
    return {
      x: panel.nx + radius * Math.cos(angle),
      y: panel.ny + radius * Math.sin(angle),
    }
  })
}

/** Test d'appartenance par lancer de rayon, valable pour tout polygone simple. */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false

  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!
    const b = polygon[j]!
    const crosses = a.y > point.y !== b.y > point.y
    if (!crosses) continue
    const cut = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (point.x < cut) inside = !inside
  }
  return inside
}

/**
 * Panneau situé sous un point, en espace normalisé. Le dernier panneau de la
 * liste l'emporte en cas de chevauchement : c'est celui dessiné par-dessus.
 */
export function panelAt(layout: PanelLayout, point: Point): NormalizedPanel | null {
  for (let index = layout.panels.length - 1; index >= 0; index -= 1) {
    const panel = layout.panels[index]!
    if (pointInPolygon(point, panelPolygon(panel, layout.nSideLength))) return panel
  }
  return null
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Étendue réelle des panneaux, sommets compris.
 *
 * `normalizeLayout` ne normalise que les *centres* : un panneau déborde du
 * carré unité de tout son rayon circonscrit. Cadrer sur `[0,1]²` couperait
 * donc les bords du mur.
 */
export function wallBounds(layout: PanelLayout): Bounds {
  if (layout.panels.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1 }

  const points: Point[] = layout.panels.flatMap((panel) =>
    panelPolygon(panel, layout.nSideLength),
  )
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

/**
 * Fait tourner le mur d'un angle libre, horaire, à l'écran.
 *
 * Le device ne dit pas dans quel sens les panneaux sont accrochés, et rien
 * n'oblige un mur à être posé à angle droit : seul l'utilisateur le sait.
 * Tourner la layout plutôt que le rendu garde le maillage, la désignation au
 * clic et le mapping spatial d'accord entre eux, puisque tous repartent des
 * mêmes `nx`, `ny` et `o`.
 *
 * `o` est mesuré dans le repère du device, dont l'axe Y est inversé au
 * rendu : une rotation horaire à l'écran se retranche donc de `o`.
 */
export function rotateLayout(layout: PanelLayout, degrees: number): PanelLayout {
  const angle = ((degrees % 360) + 360) % 360
  if (angle === 0) return layout

  const radians = (angle * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  const panels = layout.panels.map((panel) => {
    const dx = panel.nx - 0.5
    const dy = panel.ny - 0.5
    return {
      ...panel,
      nx: 0.5 + dx * cos - dy * sin,
      ny: 0.5 + dx * sin + dy * cos,
      o: panel.o - angle,
    }
  })

  const tourne: PanelLayout = { ...layout, panels }
  const bounds = wallBounds(tourne)
  const largeur = bounds.maxX - bounds.minX
  const hauteur = bounds.maxY - bounds.minY

  return {
    ...tourne,
    aspect: hauteur === 0 ? layout.aspect : largeur / hauteur,
  }
}
