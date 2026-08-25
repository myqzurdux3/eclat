export interface RawPanel {
  panelId: number
  x: number
  y: number
  o: number
  shapeType: number
}

export interface NormalizedPanel extends RawPanel {
  /** Normalised horizontal position in [0,1]; 0 is the left edge of the wall. */
  nx: number
  /** Normalised vertical position in [0,1]; 0 is the top of the wall. */
  ny: number
}

export interface PanelLayout {
  sideLength: number
  /** A panel's side length, in the same normalised scale as `nx` and `ny`. */
  nSideLength: number
  /** Width over height of the panels' envelope; 1 for a single panel. */
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
 * The effect name the controller reports while External Control is armed.
 * It doubles as a probe: if the current effect is no longer this one, some
 * other source (the mobile app, the physical button) has taken over.
 */
export const EXT_CONTROL_EFFECT = '*ExtControl*'

/**
 * Sources allowed to write to the panels, in decreasing priority. Declared
 * here because the IPC contract uses it: the renderer never imports from the
 * main process.
 */
export type SourceId = 'manual' | 'screen' | 'audio'

/** A device effect's palette, converted to RGB for display. */
export interface EffectPalette {
  name: string
  colors: Color[]
}
