import { toLinear, type Frame, type LinearColor, type Rect } from './srgb'
import type { PanelLayout } from '../types'

/**
 * Couleur de chaque panneau, échantillonnée autour de sa position.
 *
 * La pondération est gaussienne d'écart-type `radius`, exprimé en fraction
 * du mur. Les zones se recouvrent volontairement : deux panneaux voisins
 * partagent une part de leur voisinage, ce qui adoucit la transition entre
 * eux au lieu de la découper.
 *
 * Tout se passe en espace linéaire, avant retour en sRGB par l'appelant.
 */
export function mapSpatial(
  frame: Frame,
  rect: Rect,
  layout: PanelLayout,
  radius: number,
): LinearColor[] {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(frame.width, Math.floor(rect.x + rect.width))
  const y1 = Math.min(frame.height, Math.floor(rect.y + rect.height))

  const largeur = x1 - x0
  const hauteur = y1 - y0
  if (largeur <= 0 || hauteur <= 0) {
    return layout.panels.map(() => ({ r: 0, g: 0, b: 0 }))
  }

  // Un rayon nul ferait tendre tous les poids vers zéro : on garde de quoi
  // couvrir au moins un pixel.
  const sigma = Math.max(radius, 0.5 / Math.max(largeur, hauteur))
  const deuxSigmaCarre = 2 * sigma * sigma

  return layout.panels.map((panel) => {
    let r = 0
    let g = 0
    let b = 0
    let poidsTotal = 0

    for (let y = y0; y < y1; y += 1) {
      // Centre du pixel, ramené dans [0,1] sur le rectangle utile.
      const ny = (y - y0 + 0.5) / hauteur
      const dy = ny - panel.ny

      for (let x = x0; x < x1; x += 1) {
        const nx = (x - x0 + 0.5) / largeur
        const dx = nx - panel.nx
        const poids = Math.exp(-(dx * dx + dy * dy) / deuxSigmaCarre)
        if (poids < 1e-6) continue

        const at = (y * frame.width + x) * 4
        r += poids * toLinear(frame.data[at]!)
        g += poids * toLinear(frame.data[at + 1]!)
        b += poids * toLinear(frame.data[at + 2]!)
        poidsTotal += poids
      }
    }

    // Panneau trop loin de l'image pour qu'un poids survive : on prend le
    // pixel le plus proche plutôt que de rendre du noir.
    if (poidsTotal === 0) {
      const px = Math.min(x1 - 1, Math.max(x0, x0 + Math.round(panel.nx * (largeur - 1))))
      const py = Math.min(y1 - 1, Math.max(y0, y0 + Math.round(panel.ny * (hauteur - 1))))
      const at = (py * frame.width + px) * 4
      return {
        r: toLinear(frame.data[at]!),
        g: toLinear(frame.data[at + 1]!),
        b: toLinear(frame.data[at + 2]!),
      }
    }

    return { r: r / poidsTotal, g: g / poidsTotal, b: b / poidsTotal }
  })
}
