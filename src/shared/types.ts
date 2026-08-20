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
