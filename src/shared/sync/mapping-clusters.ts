import { toLinear, type Frame, type LinearColor, type Rect } from './srgb'

/** Nombre de bins par axe de l'histogramme 3D. */
const BINS = 16
const NOIR: LinearColor = { r: 0, g: 0, b: 0 }
/** En deçà, le pixel ne pèse rien : ni assez clair ni assez coloré. */
const POIDS_MINIMAL = 1e-4

interface Bin {
  poids: number
  r: number
  g: number
  b: number
}

/**
 * Histogramme 3D pondéré par la saturation.
 *
 * Un mur gris qui occupe tout le cadre ne doit pas l'emporter sur une
 * enseigne rouge : le poids d'un pixel est le produit de sa luminosité et de
 * sa saturation, pas son seul nombre d'occurrences.
 */
function histogramme(frame: Frame, rect: Rect): Map<number, Bin> {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(frame.width, Math.floor(rect.x + rect.width))
  const y1 = Math.min(frame.height, Math.floor(rect.y + rect.height))

  const bins = new Map<number, Bin>()

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * frame.width + x) * 4
      const r = toLinear(frame.data[at]!)
      const g = toLinear(frame.data[at + 1]!)
      const b = toLinear(frame.data[at + 2]!)

      const max = Math.max(r, g, b)
      if (max <= 0) continue
      const min = Math.min(r, g, b)
      const saturation = (max - min) / max

      // Le terme constant laisse survivre les scènes désaturées : sans lui,
      // une image en niveaux de gris n'aurait aucune couleur dominante.
      const poids = max * (0.15 + saturation)
      if (poids < POIDS_MINIMAL) continue

      const cle =
        Math.min(BINS - 1, Math.floor(r * BINS)) * BINS * BINS +
        Math.min(BINS - 1, Math.floor(g * BINS)) * BINS +
        Math.min(BINS - 1, Math.floor(b * BINS))

      const bin = bins.get(cle)
      if (bin === undefined) {
        bins.set(cle, { poids, r: r * poids, g: g * poids, b: b * poids })
      } else {
        bin.poids += poids
        bin.r += r * poids
        bin.g += g * poids
        bin.b += b * poids
      }
    }
  }

  return bins
}

const barycentre = (bin: Bin): LinearColor => ({
  r: bin.r / bin.poids,
  g: bin.g / bin.poids,
  b: bin.b / bin.poids,
})

/** Distance dans le cube RGB linéaire, pour écarter les clusters voisins. */
const distance = (a: LinearColor, b: LinearColor): number =>
  Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)

/** Couleur du cluster le plus lourd. Tous les panneaux la reçoivent. */
export function dominantColor(frame: Frame, rect: Rect): LinearColor {
  const bins = [...histogramme(frame, rect).values()]
  if (bins.length === 0) return { ...NOIR }

  const gagnant = bins.reduce((a, b) => (a.poids >= b.poids ? a : b))
  return barycentre(gagnant)
}

/**
 * Les `count` couleurs principales, de la plus présente à la moins.
 *
 * Les clusters trop proches sont écartés : trois nuances du même bleu ne
 * font pas une palette, et c'est ce que rendrait un simple tri par poids.
 */
export function paletteColors(frame: Frame, rect: Rect, count: number): LinearColor[] {
  const bins = [...histogramme(frame, rect).values()].sort((a, b) => b.poids - a.poids)
  if (bins.length === 0 || count <= 0) return []

  const ECART_MINIMAL = 0.12
  const retenues: LinearColor[] = []

  for (const bin of bins) {
    if (retenues.length >= count) break
    const couleur = barycentre(bin)
    if (retenues.every((autre) => distance(autre, couleur) >= ECART_MINIMAL)) {
      retenues.push(couleur)
    }
  }

  return retenues
}
