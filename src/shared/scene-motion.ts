import type { Color } from './types'

export interface SceneMotionOptions {
  /** Durée d'un passage d'une couleur de palette à la suivante. */
  dureeMs?: number
  /** Décalage entre le premier et le dernier panneau, en fraction de cycle. */
  etalement?: number
}

const NOIR: Color = { r: 0, g: 0, b: 0 }
const DUREE_PAR_DEFAUT = 4000
const ETALEMENT_PAR_DEFAUT = 0.7

const melanger = (a: Color, b: Color, t: number): Color => ({
  r: Math.round(a.r + (b.r - a.r) * t),
  g: Math.round(a.g + (b.g - a.g) * t),
  b: Math.round(a.b + (b.b - a.b) * t),
})

/**
 * Fait vivre une palette sur le mur : une vague de couleurs qui la parcourt.
 *
 * **Ce n'est pas ce que les panneaux affichent.** Le device n'expose aucune
 * couleur panneau par panneau, et les animations de ses effets sont des
 * greffons fermés : impossible de les reproduire. On sait seulement quelles
 * couleurs composent la scène. Cette fonction en tire un mouvement plausible,
 * pour que la maquette respire au lieu de rester figée — l'interface le dit à
 * l'utilisateur, et elle ne doit jamais prétendre le contraire.
 */
export function sceneMotion(
  palette: Color[],
  panelCount: number,
  timeMs: number,
  options: SceneMotionOptions = {},
): Color[] {
  if (panelCount <= 0) return []
  if (palette.length === 0) return Array.from({ length: panelCount }, () => ({ ...NOIR }))
  if (palette.length === 1) {
    return Array.from({ length: panelCount }, () => ({ ...palette[0]! }))
  }

  const duree = options.dureeMs ?? DUREE_PAR_DEFAUT
  const etalement = options.etalement ?? ETALEMENT_PAR_DEFAUT
  const avance = timeMs / duree

  return Array.from({ length: panelCount }, (_, index) => {
    // Chaque panneau est en retard sur le précédent : la vague se voit passer.
    const decalage = panelCount === 1 ? 0 : (index / panelCount) * etalement * palette.length
    const position = avance + decalage

    const depuis = Math.floor(position)
    const fraction = position - depuis
    const a = palette[((depuis % palette.length) + palette.length) % palette.length]!
    const b = palette[((depuis + 1) % palette.length + palette.length) % palette.length]!

    return melanger(a, b, fraction)
  })
}
