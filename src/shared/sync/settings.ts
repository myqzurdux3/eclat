export type MappingMode = 'spatial' | 'dominant' | 'palette'

export interface SyncSettings {
  mode: MappingMode
  /** Standard deviation of the Gaussian weighting, as a fraction of the wall. */
  radius: number
  saturation: number
  /** Below this threshold the device cuts out anyway, so clamp to zero. */
  blackFloor: number
  /** EMA coefficient while a value is rising. */
  attack: number
  /** EMA coefficient while a value is falling. */
  release: number
  hz: number
}

/** The spec's values, section 6.4. */
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

const RANGES: Record<Exclude<keyof SyncSettings, 'mode'>, [number, number]> = {
  radius: [0.05, 0.5],
  saturation: [0.5, 2],
  blackFloor: [0, 0.2],
  attack: [0.1, 1],
  release: [0.02, 0.5],
  hz: [10, 30],
}

const bound = (value: unknown, [min, max]: [number, number], fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/**
 * Completes and bounds a partial set of settings.
 *
 * Settings cross the IPC boundary and come back from local storage: nothing
 * guarantees they are in range, and a negative frame rate or a zero radius
 * would make the pipeline diverge.
 */
export function clampSettings(partial: Partial<SyncSettings>): SyncSettings {
  return {
    mode: MODES.includes(partial.mode as MappingMode)
      ? (partial.mode as MappingMode)
      : DEFAULT_SYNC_SETTINGS.mode,
    radius: bound(partial.radius, RANGES.radius, DEFAULT_SYNC_SETTINGS.radius),
    saturation: bound(partial.saturation, RANGES.saturation, DEFAULT_SYNC_SETTINGS.saturation),
    blackFloor: bound(partial.blackFloor, RANGES.blackFloor, DEFAULT_SYNC_SETTINGS.blackFloor),
    attack: bound(partial.attack, RANGES.attack, DEFAULT_SYNC_SETTINGS.attack),
    release: bound(partial.release, RANGES.release, DEFAULT_SYNC_SETTINGS.release),
    hz: bound(partial.hz, RANGES.hz, DEFAULT_SYNC_SETTINGS.hz),
  }
}
