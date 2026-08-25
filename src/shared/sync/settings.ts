export type MappingMode = 'spatial' | 'dominant' | 'palette'

export interface SyncSettings {
  mode: MappingMode
  /** Écart-type de la pondération gaussienne, en fraction du mur. */
  radius: number
  saturation: number
  /** En dessous de ce seuil le device coupe : autant écraser à zéro. */
  blackFloor: number
  /** Coefficient d'EMA quand la valeur monte. */
  attack: number
  /** Coefficient d'EMA quand la valeur descend. */
  release: number
  hz: number
}

/** Valeurs de la spec, section 6.4. */
export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  mode: 'spatial',
  radius: 0.18,
  saturation: 1.25,
  blackFloor: 0.04,
  attack: 0.6,
  release: 0.15,
  hz: 25,
}

const MODES: MappingMode[] = ['spatial', 'dominant', 'palette']

const PLAGES: Record<Exclude<keyof SyncSettings, 'mode'>, [number, number]> = {
  radius: [0.05, 0.5],
  saturation: [0.5, 2],
  blackFloor: [0, 0.2],
  attack: [0.1, 1],
  release: [0.02, 0.5],
  hz: [10, 30],
}

const borner = (value: unknown, [min, max]: [number, number], defaut: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaut
  return Math.min(max, Math.max(min, value))
}

/**
 * Complète et borne des réglages partiels.
 *
 * Les réglages traversent l'IPC et le stockage local : rien ne garantit
 * qu'ils sont dans les clous, et une cadence négative ou un rayon nul
 * feraient diverger le pipeline.
 */
export function clampSettings(partial: Partial<SyncSettings>): SyncSettings {
  return {
    mode: MODES.includes(partial.mode as MappingMode)
      ? (partial.mode as MappingMode)
      : DEFAULT_SYNC_SETTINGS.mode,
    radius: borner(partial.radius, PLAGES.radius, DEFAULT_SYNC_SETTINGS.radius),
    saturation: borner(partial.saturation, PLAGES.saturation, DEFAULT_SYNC_SETTINGS.saturation),
    blackFloor: borner(partial.blackFloor, PLAGES.blackFloor, DEFAULT_SYNC_SETTINGS.blackFloor),
    attack: borner(partial.attack, PLAGES.attack, DEFAULT_SYNC_SETTINGS.attack),
    release: borner(partial.release, PLAGES.release, DEFAULT_SYNC_SETTINGS.release),
    hz: borner(partial.hz, PLAGES.hz, DEFAULT_SYNC_SETTINGS.hz),
  }
}
