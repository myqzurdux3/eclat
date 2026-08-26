import { describe, expect, it } from 'vitest'
import {
  asBoolean,
  asColor,
  asColors,
  asDeviceId,
  asNumber,
  asPaintEntries,
  asSource,
  asText,
} from './ipc-guards'

describe('the IPC boundary', () => {
  it('refuses a device id that is not a string', () => {
    expect(() => asDeviceId(undefined)).toThrow()
    expect(() => asDeviceId('')).toThrow()
    expect(() => asDeviceId({})).toThrow()
    expect(asDeviceId('Shapes')).toBe('Shapes')
  })

  it('refuses a source it does not know', () => {
    expect(() => asSource('rumour')).toThrow()
    expect(asSource('audio')).toBe('audio')
  })

  it('refuses what is not a number, and clamps what is', () => {
    expect(() => asNumber('60', 'brightness', 0, 100)).toThrow()
    expect(() => asNumber(Number.NaN, 'brightness', 0, 100)).toThrow()
    expect(asNumber(500, 'brightness', 0, 100)).toBe(100)
    expect(asNumber(-5, 'brightness', 0, 100)).toBe(0)
  })

  it('refuses a boolean that is not one', () => {
    expect(() => asBoolean('true', 'on')).toThrow()
    expect(asBoolean(false, 'on')).toBe(false)
  })

  it('refuses a text longer than any name could be', () => {
    expect(() => asText('x'.repeat(1001), 'effect')).toThrow()
    expect(asText('Northern Lights', 'effect')).toBe('Northern Lights')
  })

  /** A missing channel is black, not `undefined` reaching the frame encoder. */
  it('makes a whole colour out of a partial one', () => {
    expect(asColor({ r: 300, g: -4 })).toEqual({ r: 255, g: 0, b: 0 })
    expect(() => asColor(null)).toThrow()
  })

  it('refuses a frame too large to be a wall', () => {
    expect(() => asColors(new Array(2000).fill({ r: 0, g: 0, b: 0 }))).toThrow()
    expect(() => asColors('red')).toThrow()
    expect(asColors([{ r: 1, g: 2, b: 3 }])).toEqual([{ r: 1, g: 2, b: 3 }])
  })

  it('refuses a stroke that is not a list of panels', () => {
    expect(() => asPaintEntries([{ panelId: 'one', color: {} }])).toThrow()
    expect(asPaintEntries([{ panelId: 4, color: { r: 1, g: 2, b: 3 } }])).toEqual([
      { panelId: 4, color: { r: 1, g: 2, b: 3 } },
    ])
  })
})
