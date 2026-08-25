export interface RawPanel {
  panelId: number
  x: number
  y: number
  o: number
  shapeType: number
}

export interface NormalizedPanel extends RawPanel {
  /** Position horizontale normalisée dans [0,1], 0 = bord gauche du mur. */
  nx: number
  /** Position verticale normalisée dans [0,1], 0 = haut du mur. */
  ny: number
}

export interface PanelLayout {
  sideLength: number
  /** largeur / hauteur de l'enveloppe des panneaux ; 1 si un seul panneau. */
  aspect: number
  panels: NormalizedPanel[]
}

export interface DeviceInfo {
  id: string
  name: string
  ip: string
  port: number
  model?: string
  firmware?: string
}

export interface DeviceState {
  on: boolean
  brightness: number
  hue: number
  sat: number
  ct: number
  colorMode: string
  effect: string
}

export interface Color {
  r: number
  g: number
  b: number
}

/**
 * Nom d'effet rapporté par le contrôleur quand le mode External Control est
 * armé. Sert de sonde : si l'effet courant n'est plus celui-ci, une autre
 * source (app mobile, bouton physique) a repris la main.
 */
export const EXT_CONTROL_EFFECT = '*ExtControl*'

/**
 * Sources capables d'écrire sur les panneaux, par priorité décroissante.
 * Déclaré ici parce que le contrat IPC s'en sert : le renderer n'importe
 * jamais depuis le processus main.
 */
export type SourceId = 'manual' | 'screen' | 'audio'

/** Palette d'un effet du device, convertie en RGB pour l'affichage. */
export interface EffectPalette {
  name: string
  colors: Color[]
}
