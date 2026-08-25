import { hsbToRgb } from './color'
import type { Color, DeviceState, EffectPalette, NormalizedPanel } from './types'

/** Gris sourd affiché tant que l'état du device n'est pas connu. */
const NEUTRE: Color = { r: 40, g: 42, b: 52 }
const ETEINT: Color = { r: 0, g: 0, b: 0 }

const attenuer = (color: Color, facteur: number): Color => ({
  r: Math.round(color.r * facteur),
  g: Math.round(color.g * facteur),
  b: Math.round(color.b * facteur),
})

/**
 * Couleur à afficher pour chaque panneau.
 *
 * Le device ne publie pas la couleur panneau par panneau : seul le streaming
 * la connaît, et seulement pour ce qu'il envoie lui-même. Hors streaming on
 * l'approxime — la palette de l'effet courant étalée sur le mur, ou la
 * teinte réglée en mode couleur unie. C'est une maquette fidèle à l'état du
 * device, pas une lecture de ses LED.
 */
export function wallColors(
  panels: NormalizedPanel[],
  state: DeviceState | null,
  palettes: EffectPalette[],
  painted: Map<number, Color>,
): Map<number, Color> {
  const colors = new Map<number, Color>()

  const palette =
    state !== null && state.colorMode === 'effect'
      ? palettes.find((entry) => entry.name === state.effect)?.colors
      : undefined
  const facteur = state === null ? 1 : Math.max(0, Math.min(100, state.brightness)) / 100

  panels.forEach((panel, index) => {
    // Un panneau peint l'est délibérément : il garde sa couleur pleine.
    const peint = painted.get(panel.panelId)
    if (peint !== undefined) {
      colors.set(panel.panelId, peint)
      return
    }

    if (state === null) {
      colors.set(panel.panelId, NEUTRE)
      return
    }

    if (!state.on) {
      colors.set(panel.panelId, ETEINT)
      return
    }

    if (palette !== undefined && palette.length > 0) {
      colors.set(panel.panelId, attenuer(palette[index % palette.length]!, facteur))
      return
    }

    // En mode effet, `hue` et `sat` sont périmées : le device cesse de les
    // mettre à jour dès qu'une scène tourne, et elles restent souvent à
    // 0/0 — soit du blanc franc. Afficher ce blanc ferait croire à un mur
    // allumé en blanc alors qu'on ignore simplement ce qu'il montre.
    const base =
      state.colorMode === 'effect' ? NEUTRE : hsbToRgb(state.hue, state.sat, 100)

    colors.set(panel.panelId, attenuer(base, facteur))
  })

  return colors
}
