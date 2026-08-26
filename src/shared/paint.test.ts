import { describe, expect, it } from 'vitest'
import { nextPaint, toFrameColor, UNLIT } from './paint'

const brush = { r: 255, g: 120, b: 0 }

describe('nextPaint', () => {
  it('paints a panel the user has not chosen', () => {
    expect(nextPaint(false, brush)).toEqual(brush)
  })

  it('switches off a panel the user had chosen', () => {
    expect(nextPaint(true, brush)).toEqual(UNLIT)
  })
})

describe('toFrameColor', () => {
  const tint = { r: 34, g: 36, b: 46 }

  it('sends real black for a panel drawn with the unlit tint', () => {
    expect(toFrameColor(tint, tint)).toEqual(UNLIT)
  })

  it('sends real black rather than invent light the app cannot name', () => {
    const neutral = { r: 40, g: 42, b: 52 }

    expect(toFrameColor(neutral, tint, neutral)).toEqual(UNLIT)
  })

  it('sends real black for a panel the mock-up knows nothing about', () => {
    expect(toFrameColor(undefined, tint)).toEqual(UNLIT)
  })

  it('sends a lit colour through untouched', () => {
    expect(toFrameColor({ r: 200, g: 40, b: 0 }, tint)).toEqual({ r: 200, g: 40, b: 0 })
  })
})
