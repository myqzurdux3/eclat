import type { NormalizedPanel, PanelLayout, RawPanel } from '../../shared/types'

/** Identifiant du panneau contrôleur, présent dans la layout mais non éclairable. */
const CONTROLLER_PANEL_ID = 0

/**
 * Convertit les coordonnées brutes du device en positions normalisées dans
 * [0,1]², origine en haut à gauche, rapport d'aspect préservé.
 *
 * Le device exprime ses coordonnées en millimètres avec un axe Y orienté vers
 * le haut ; l'axe est inversé ici pour correspondre aux conventions écran.
 */
export function normalizeLayout(raw: RawPanel[], sideLength: number): PanelLayout {
  const usable = raw.filter((p) => p.panelId !== CONTROLLER_PANEL_ID)

  if (usable.length === 0) {
    return { sideLength, aspect: 1, panels: [] }
  }

  const xs = usable.map((p) => p.x)
  const ys = usable.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const width = maxX - minX
  const height = maxY - minY
  const scale = Math.max(width, height)

  if (scale === 0) {
    const panels: NormalizedPanel[] = usable.map((p) => ({ ...p, nx: 0.5, ny: 0.5 }))
    return { sideLength, aspect: 1, panels }
  }

  const offsetX = (1 - width / scale) / 2
  const offsetY = (1 - height / scale) / 2

  const panels: NormalizedPanel[] = usable.map((p) => ({
    ...p,
    nx: (p.x - minX) / scale + offsetX,
    ny: 1 - ((p.y - minY) / scale + offsetY),
  }))

  const aspect = height === 0 ? Number.POSITIVE_INFINITY : width / height

  return {
    sideLength,
    aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : 1,
    panels,
  }
}
