import { describe, expect, it } from 'vitest'
import { applyCorrection } from './correction'
import { luminance } from './srgb'
import { DEFAULT_SYNC_SETTINGS } from './settings'

const settingsWith = (over: Partial<typeof DEFAULT_SYNC_SETTINGS> = {}) => ({
  ...DEFAULT_SYNC_SETTINGS,
  ...over,
})

describe('applyCorrection', () => {
  it('changes nothing at neutral saturation with no floor', () => {
    const colour = { r: 0.4, g: 0.2, b: 0.1 }

    const corrected = applyCorrection(colour, settingsWith({ saturation: 1, blackFloor: 0 }))

    expect(corrected.r).toBeCloseTo(0.4, 6)
    expect(corrected.g).toBeCloseTo(0.2, 6)
    expect(corrected.b).toBeCloseTo(0.1, 6)
  })

  it('spreads the channels apart as saturation rises', () => {
    const colour = { r: 0.5, g: 0.3, b: 0.3 }
    const settings = settingsWith({ saturation: 2, blackFloor: 0 })

    const corrected = applyCorrection(colour, settings)

    expect(corrected.r - corrected.g).toBeGreaterThan(colour.r - colour.g)
  })

  it('keeps luminance while pushing saturation', () => {
    const colour = { r: 0.5, g: 0.3, b: 0.2 }

    const corrected = applyCorrection(colour, settingsWith({ saturation: 1.8, blackFloor: 0 }))

    expect(luminance(corrected)).toBeCloseTo(luminance(colour), 6)
  })

  it('leaves a grey grey, whatever the saturation', () => {
    const grey = { r: 0.3, g: 0.3, b: 0.3 }

    const corrected = applyCorrection(grey, settingsWith({ saturation: 2, blackFloor: 0 }))

    expect(corrected.r).toBeCloseTo(corrected.g, 6)
    expect(corrected.g).toBeCloseTo(corrected.b, 6)
  })

  it('clamps to zero anything below the black floor', () => {
    const dark = { r: 0.02, g: 0.02, b: 0.02 }

    expect(applyCorrection(dark, settingsWith({ blackFloor: 0.05 }))).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('lets through anything just above the floor', () => {
    const colour = { r: 0.2, g: 0.2, b: 0.2 }

    const corrected = applyCorrection(colour, settingsWith({ blackFloor: 0.05 }))

    expect(corrected.r).toBeGreaterThan(0)
  })

  it('never leaves the bounds', () => {
    const vivid = { r: 1, g: 0, b: 0 }

    const corrected = applyCorrection(vivid, settingsWith({ saturation: 2, blackFloor: 0 }))

    expect(corrected.r).toBeLessThanOrEqual(1)
    expect(corrected.g).toBeGreaterThanOrEqual(0)
  })
})
