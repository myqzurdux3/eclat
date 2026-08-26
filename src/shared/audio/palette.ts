import type { Mode } from './modes'
import { ambient, meter, pulse, spectrum } from './modes'

/** The ways the wall can answer the music. */
export type AudioMode = 'ambient' | 'meter' | 'spectrum' | 'pulse'

export const AUDIO_MODES: AudioMode[] = ['ambient', 'meter', 'spectrum', 'pulse']

export const MODES: Record<AudioMode, Mode> = { ambient, meter, spectrum, pulse }

export interface AudioSettings {
  /** How the wall answers: a colour field, a meter, a spectrum, a pulse. */
  mode: AudioMode
  /** Multiplies the response; 1 is neutral. */
  sensitivity: number
  /** Extra brightness on a beat, as a fraction. */
  beatFlash: number
  /** Below this level the wall goes dark rather than showing noise. */
  gate: number
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  mode: 'ambient',
  sensitivity: 1,
  beatFlash: 0.35,
  gate: 0.01,
}

/** The mode named, or the default when the name means nothing. */
export function toMode(name: unknown): AudioMode {
  return AUDIO_MODES.includes(name as AudioMode)
    ? (name as AudioMode)
    : DEFAULT_AUDIO_SETTINGS.mode
}
