import { describe, expect, it } from 'vitest'
import { nextPaint, UNLIT } from './paint'

const brush = { r: 255, g: 120, b: 0 }

describe('nextPaint', () => {
  it('paints a panel the user has not touched', () => {
    expect(nextPaint(undefined, brush)).toEqual(brush)
  })

  it('switches off a panel that is already lit', () => {
    expect(nextPaint({ r: 12, g: 0, b: 0 }, brush)).toEqual(UNLIT)
  })

  it('paints again a panel that was switched off', () => {
    expect(nextPaint(UNLIT, brush)).toEqual(brush)
  })

  it('treats any non-black colour as lit, however dim', () => {
    expect(nextPaint({ r: 0, g: 0, b: 1 }, brush)).toEqual(UNLIT)
  })
})
