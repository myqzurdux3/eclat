import { describe, expect, it } from 'vitest'
import { audioColors, DEFAULT_AUDIO_SETTINGS } from './palette'
import { normalizeLayout } from '../../main/device/layout'
import type { AudioFeatures } from './analyser'

const layout = normalizeLayout(
  [
    { panelId: 1, x: 0, y: 0, o: 0, shapeType: 8 },
    { panelId: 2, x: 0, y: 200, o: 0, shapeType: 8 },
    { panelId: 3, x: 0, y: 400, o: 0, shapeType: 8 },
  ],
  100,
)

const features = (over: Partial<AudioFeatures> = {}): AudioFeatures => ({
  bass: 0.5,
  mid: 0.4,
  treble: 0.3,
  beat: false,
  level: 0.5,
  ...over,
})

const brightnessOf = (colors: Array<{ r: number; g: number; b: number }>): number =>
  colors.reduce((total, c) => total + c.r + c.g + c.b, 0)

describe('audioColors', () => {
  it('returns one colour per panel', () => {
    expect(audioColors(features(), layout, DEFAULT_AUDIO_SETTINGS)).toHaveLength(3)
  })

  it('returns an empty array for a wall with no panels', () => {
    expect(audioColors(features(), normalizeLayout([], 100), DEFAULT_AUDIO_SETTINGS)).toEqual([])
  })

  it('switches the wall off when nothing is playing', () => {
    const silent = audioColors(features({ level: 0, bass: 0, mid: 0, treble: 0 }), layout, DEFAULT_AUDIO_SETTINGS)

    expect(silent).toEqual([
      { r: 0, g: 0, b: 0 },
      { r: 0, g: 0, b: 0 },
      { r: 0, g: 0, b: 0 },
    ])
  })

  it('brightens the whole wall on a beat', () => {
    const without = audioColors(features(), layout, DEFAULT_AUDIO_SETTINGS)
    const withBeat = audioColors(features({ beat: true }), layout, DEFAULT_AUDIO_SETTINGS)

    expect(brightnessOf(withBeat)).toBeGreaterThan(brightnessOf(without))
  })

  it('gives neighbouring panels distinct colours', () => {
    const colors = audioColors(features(), layout, DEFAULT_AUDIO_SETTINGS)

    expect(colors[0]).not.toEqual(colors[2])
  })

  it('grows louder with sensitivity', () => {
    const soft = audioColors(features(), layout, { ...DEFAULT_AUDIO_SETTINGS, sensitivity: 0.5 })
    const hard = audioColors(features(), layout, { ...DEFAULT_AUDIO_SETTINGS, sensitivity: 2 })

    expect(brightnessOf(hard)).toBeGreaterThan(brightnessOf(soft))
  })

  it('stays within the RGB bounds at any sensitivity', () => {
    for (const sensitivity of [0.1, 1, 5]) {
      const colors = audioColors(
        features({ bass: 1, mid: 1, treble: 1, level: 1, beat: true }),
        layout,
        { ...DEFAULT_AUDIO_SETTINGS, sensitivity },
      )
      for (const colour of colors) {
        for (const channel of [colour.r, colour.g, colour.b]) {
          expect(channel).toBeGreaterThanOrEqual(0)
          expect(channel).toBeLessThanOrEqual(255)
          expect(Number.isInteger(channel)).toBe(true)
        }
      }
    }
  })

  it('turns a bass-heavy mix warmer than a treble-heavy one', () => {
    const bassy = audioColors(features({ bass: 1, mid: 0, treble: 0 }), layout, DEFAULT_AUDIO_SETTINGS)
    const bright = audioColors(features({ bass: 0, mid: 0, treble: 1 }), layout, DEFAULT_AUDIO_SETTINGS)

    const warmth = (c: { r: number; b: number }) => c.r - c.b
    expect(warmth(bassy[0]!)).toBeGreaterThan(warmth(bright[0]!))
  })
})
