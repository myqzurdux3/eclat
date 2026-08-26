import { describe, expect, it } from 'vitest'
import { normalizeLayout } from './layout'
import type { RawPanel } from '../../shared/types'

const panel = (panelId: number, x: number, y: number, shapeType = 7): RawPanel => ({
  panelId,
  x,
  y,
  o: 0,
  shapeType,
})

describe('normalizeLayout', () => {
  it('centres a single panel', () => {
    const layout = normalizeLayout([panel(1, 120, 340)], 67)
    expect(layout.panels).toHaveLength(1)
    expect(layout.panels[0]!.nx).toBeCloseTo(0.5)
    expect(layout.panels[0]!.ny).toBeCloseTo(0.5)
    expect(layout.aspect).toBe(1)
    expect(layout.sideLength).toBe(67)
  })

  it('spreads two horizontal panels across the full width and centres them vertically', () => {
    const layout = normalizeLayout([panel(1, 0, 50), panel(2, 100, 50)], 67)
    expect(layout.panels[0]!.nx).toBeCloseTo(0)
    expect(layout.panels[1]!.nx).toBeCloseTo(1)
    expect(layout.panels[0]!.ny).toBeCloseTo(0.5)
    expect(layout.panels[1]!.ny).toBeCloseTo(0.5)
  })

  it('flips the vertical axis: a high device y yields a low ny', () => {
    const layout = normalizeLayout([panel(1, 0, 0), panel(2, 0, 100)], 67)
    expect(layout.panels[0]!.ny).toBeCloseTo(1)
    expect(layout.panels[1]!.ny).toBeCloseTo(0)
  })

  it('preserves the aspect ratio: a wide arrangement does not fill the height', () => {
    const layout = normalizeLayout(
      [panel(1, 0, 0), panel(2, 200, 0), panel(3, 100, 50)],
      67,
    )
    // aspect = (width + sideLength) / (height + sideLength) = (200+67)/(50+67) = 267/117
    expect(layout.aspect).toBeCloseTo(267 / 117)
    // Total height 50 on a scale of 200: the occupied band is 0.25, hence
    // centred between 0.375 and 0.625.
    expect(layout.panels[0]!.ny).toBeCloseTo(0.625)
    expect(layout.panels[2]!.ny).toBeCloseTo(0.375)
  })

  it('computes a finite aspect for a collinear horizontal row (zero height)', () => {
    const layout = normalizeLayout([panel(1, 0, 0), panel(2, 100, 0)], 67)
    expect(Number.isFinite(layout.aspect)).toBe(true)
    expect(layout.aspect).toBeCloseTo(167 / 67)
  })

  it('computes a finite aspect for a collinear vertical column (zero width)', () => {
    const layout = normalizeLayout([panel(1, 0, 0), panel(2, 0, 100)], 67)
    expect(Number.isFinite(layout.aspect)).toBe(true)
    expect(layout.aspect).toBeGreaterThan(0)
    expect(layout.aspect).toBeCloseTo(67 / 167)
  })

  it('discards the controller panel (panelId 0) found on Lines and Elements', () => {
    const layout = normalizeLayout([panel(0, 999, 999, 12), panel(1, 0, 0), panel(2, 100, 0)], 67)
    expect(layout.panels.map((p) => p.panelId)).toEqual([1, 2])
    expect(layout.panels[1]!.nx).toBeCloseTo(1)
  })

  it('returns an empty layout without crashing', () => {
    const layout = normalizeLayout([], 67)
    expect(layout.panels).toEqual([])
    expect(layout.aspect).toBe(1)
  })
})

describe('normalizeLayout — normalised side length', () => {
  it('expresses the side in the same scale as nx and ny', () => {
    const layout = normalizeLayout(
      [
        { panelId: 1, x: 0, y: 0, o: 0, shapeType: 8 },
        { panelId: 2, x: 200, y: 0, o: 0, shapeType: 8 },
      ],
      100,
    )

    expect(layout.nSideLength).toBeCloseTo(0.5, 6)
  })

  it('fills the square when a single panel is present', () => {
    const layout = normalizeLayout([{ panelId: 1, x: 5, y: 5, o: 0, shapeType: 8 }], 100)

    expect(layout.nSideLength).toBe(1)
  })

  it('returns a zero side when no panel is lightable', () => {
    expect(normalizeLayout([{ panelId: 0, x: 0, y: 0, o: 0, shapeType: 12 }], 100).nSideLength)
      .toBe(0)
  })
})

describe('normalizeLayout — degenerate walls', () => {
  /**
   * The aspect is claimed to be finite and strictly positive whatever the
   * device reports. A single panel of zero side length made it 0/0, and a
   * NaN aspect propagates through `rotateLayout` into every coordinate: the
   * wall renders nothing and no click ever lands.
   */
  it('keeps the aspect finite when the device reports no side length', () => {
    const layout = normalizeLayout([{ panelId: 1, x: 0, y: 0, o: 0, shapeType: 8 }], 0)

    expect(Number.isFinite(layout.aspect)).toBe(true)
    expect(layout.aspect).toBeGreaterThan(0)
  })
})
