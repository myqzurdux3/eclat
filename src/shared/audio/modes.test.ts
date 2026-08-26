import { describe, expect, it } from 'vitest'
import { ambient, EMPTY_MEMORY, horizontalOrder, meter, pulse, spectrum } from './modes'
import { DEFAULT_AUDIO_SETTINGS } from './palette'
import { normalizeLayout } from '../../main/device/layout'
import { rotateLayout } from '../geometry'
import type { AudioFeatures } from './analyser'

/** A row of triangles, left to right, so `nx` orders them. */
const row = (count: number) =>
  normalizeLayout(
    Array.from({ length: count }, (_, index) => ({
      panelId: index + 1,
      x: index * 100,
      y: 0,
      o: 0,
      shapeType: 8,
    })),
    100,
  )

const features = (over: Partial<AudioFeatures> = {}): AudioFeatures => ({
  bass: 0.5,
  mid: 0.5,
  treble: 0.5,
  beat: false,
  level: 0.5,
  ...over,
})

const lit = (color: { r: number; g: number; b: number }): boolean =>
  color.r + color.g + color.b > 0

describe('horizontalOrder', () => {
  it('reads the wall from left to right', () => {
    const layout = row(4)

    const order = horizontalOrder(layout)

    const positions = order.map((index) => layout.panels[index]!.nx)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  /**
   * A rotation leaves panels of one column differing in the sixteenth
   * decimal, so an exact comparison never reaches the height tie-break and
   * the column comes out in rounding order.
   */
  it('still reads a rotated row from top to bottom', () => {
    // A quarter turn stands the row up: every panel is now the same distance
    // across, give or take the sixteenth decimal, so only the tie-break can
    // order them.
    const rotated = rotateLayout(row(3), 90)
    const across = rotated.panels.map((panel) => panel.nx)
    expect(Math.max(...across) - Math.min(...across)).toBeLessThan(1e-9)

    const heights = horizontalOrder(rotated).map((index) => rotated.panels[index]!.ny)

    expect([...heights].sort((a, b) => a - b)).toEqual(heights)
  })

  it('gives every panel exactly one place', () => {
    expect([...horizontalOrder(row(5))].sort()).toEqual([0, 1, 2, 3, 4])
  })
})

describe('meter', () => {
  const settings = { ...DEFAULT_AUDIO_SETTINGS, sensitivity: 1 }

  it('fills from the left', () => {
    const layout = row(4)

    const { colors } = meter(features({ level: 0.5 }), layout, settings, EMPTY_MEMORY)

    const order = horizontalOrder(layout)
    expect(lit(colors[order[0]!]!)).toBe(true)
    expect(lit(colors[order[3]!]!)).toBe(false)
  })

  it('fills further as the level rises', () => {
    const layout = row(8)
    const count = (level: number) =>
      meter(features({ level }), layout, settings, EMPTY_MEMORY).colors.filter(lit).length

    expect(count(0.9)).toBeGreaterThan(count(0.3))
  })

  it('fills the whole wall when the level saturates', () => {
    const layout = row(4)

    const { colors } = meter(features({ level: 1 }), layout, settings, EMPTY_MEMORY)

    expect(colors.every(lit)).toBe(true)
  })

  /**
   * A bare fill flickers with every block and reads as noise. The peak is
   * what the eye follows: it rises at once and comes back down slowly.
   */
  it('takes the peak up immediately', () => {
    const { memory } = meter(features({ level: 0.8 }), row(4), settings, EMPTY_MEMORY)

    expect(memory.peak).toBeCloseTo(0.8, 5)
  })

  it('lets the peak down gradually, never in one block', () => {
    const held = { ...EMPTY_MEMORY, peak: 0.8 }

    const { memory } = meter(features({ level: 0 }), row(4), settings, held)

    expect(memory.peak).toBeLessThan(0.8)
    expect(memory.peak).toBeGreaterThan(0.5)
  })
})

describe('spectrum', () => {
  const settings = DEFAULT_AUDIO_SETTINGS

  it('puts the bass on the left and the treble on the right', () => {
    const layout = row(6)
    const order = horizontalOrder(layout)

    const { colors } = spectrum(
      features({ bass: 1, mid: 0, treble: 0 }),
      layout,
      settings,
      EMPTY_MEMORY,
    )

    expect(lit(colors[order[0]!]!)).toBe(true)
    expect(lit(colors[order[5]!]!)).toBe(false)
  })

  it('moves the light to the right when the treble carries the mix', () => {
    const layout = row(6)
    const order = horizontalOrder(layout)

    const { colors } = spectrum(
      features({ bass: 0, mid: 0, treble: 1 }),
      layout,
      settings,
      EMPTY_MEMORY,
    )

    expect(lit(colors[order[5]!]!)).toBe(true)
    expect(lit(colors[order[0]!]!)).toBe(false)
  })
})

describe('pulse', () => {
  const settings = DEFAULT_AUDIO_SETTINGS

  it('lights the whole wall in one colour', () => {
    const { colors } = pulse(features({ beat: true }), row(4), settings, EMPTY_MEMORY)

    expect(new Set(colors.map((color) => `${color.r},${color.g},${color.b}`)).size).toBe(1)
  })

  it('takes a new hue on every beat', () => {
    const first = pulse(features({ beat: true }), row(3), settings, EMPTY_MEMORY)
    const second = pulse(features({ beat: true }), row(3), settings, first.memory)

    expect(second.memory.pulseHue).not.toBeCloseTo(first.memory.pulseHue, 3)
  })

  it('holds its hue between two beats', () => {
    const beat = pulse(features({ beat: true }), row(3), settings, EMPTY_MEMORY)
    const after = pulse(features({ beat: false }), row(3), settings, beat.memory)

    expect(after.memory.pulseHue).toBeCloseTo(beat.memory.pulseHue, 5)
  })

  it('fades between beats rather than staying lit', () => {
    const beat = pulse(features({ beat: true }), row(3), settings, EMPTY_MEMORY)
    const after = pulse(features({ beat: false, level: 0 }), row(3), settings, beat.memory)

    expect(after.memory.pulse).toBeLessThan(beat.memory.pulse)
  })
})

describe('ambient', () => {
  /**
   * The ear puts the low end at the bottom of a wall, and the low end is the
   * warm one. The code used to add the cool shift to the bottom row, which
   * is the opposite of what its own comment promised.
   */
  it('keeps the warm end at the bottom of the wall', () => {
    const layout = normalizeLayout(
      [
        { panelId: 1, x: 0, y: 200, o: 0, shapeType: 8 },
        { panelId: 2, x: 0, y: 0, o: 0, shapeType: 8 },
      ],
      100,
    )
    const [top, bottom] = layout.panels[0]!.ny < layout.panels[1]!.ny ? [0, 1] : [1, 0]

    const { colors } = ambient(
      features({ bass: 1, mid: 0, treble: 0 }),
      layout,
      DEFAULT_AUDIO_SETTINGS,
      EMPTY_MEMORY,
    )

    // Both hues saturate red and floor blue, so green is what separates
    // them: it climbs as the hue leaves the warm end.
    expect(colors[bottom]!.g).toBeLessThan(colors[top]!.g)
  })


  it('still answers the way it always has', () => {
    const layout = row(3)

    const { colors } = ambient(features(), layout, DEFAULT_AUDIO_SETTINGS, EMPTY_MEMORY)

    expect(colors).toHaveLength(3)
    expect(colors.every(lit)).toBe(true)
  })

  it('carries no memory of its own', () => {
    const held = { ...EMPTY_MEMORY, peak: 0.7 }

    expect(ambient(features(), row(3), DEFAULT_AUDIO_SETTINGS, held).memory).toEqual(held)
  })
})
