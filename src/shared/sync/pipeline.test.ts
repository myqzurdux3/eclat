import { describe, expect, it } from 'vitest'
import { SyncPipeline } from './pipeline'
import { DEFAULT_SYNC_SETTINGS } from './settings'
import { normalizeLayout } from '../../main/device/layout'
import type { Frame } from './srgb'

/** Three panels stacked: top, middle, bottom. */
const column = normalizeLayout(
  [
    { panelId: 1, x: 0, y: 400, o: 0, shapeType: 8 },
    { panelId: 2, x: 0, y: 200, o: 0, shapeType: 8 },
    { panelId: 3, x: 0, y: 0, o: 0, shapeType: 8 },
  ],
  100,
)

function frame(width = 64, height = 36): Frame {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) data[i * 4 + 3] = 255
  return { width, height, data }
}

function fill(
  f: Frame,
  y0: number,
  y1: number,
  [r, g, b]: [number, number, number],
): void {
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < f.width; x += 1) {
      const at = (y * f.width + x) * 4
      f.data[at] = r
      f.data[at + 1] = g
      f.data[at + 2] = b
    }
  }
}

const flatRed = (): Frame => {
  const f = frame()
  fill(f, 0, f.height, [255, 0, 0])
  return f
}

/** Pushes the same frame until the smoothing has converged. */
function settle(pipeline: SyncPipeline, f: Frame, rounds = 80) {
  let last = pipeline.process(f)
  for (let i = 0; i < rounds; i += 1) last = pipeline.process(f)
  return last
}

describe('SyncPipeline', () => {
  it('returns exactly one colour per panel', () => {
    const pipeline = new SyncPipeline(column, DEFAULT_SYNC_SETTINGS)

    expect(pipeline.process(flatRed())).toHaveLength(3)
  })

  it('returns red on a red image, in all three modes', () => {
    for (const mode of ['spatial', 'dominant', 'palette'] as const) {
      const pipeline = new SyncPipeline(column, { ...DEFAULT_SYNC_SETTINGS, mode })

      for (const color of settle(pipeline, flatRed())) {
        expect(color.r).toBeGreaterThan(200)
        expect(color.g).toBeLessThan(60)
        expect(color.b).toBeLessThan(60)
      }
    }
  })

  it('does not switch off the top and bottom panels on a letterboxed image', () => {
    const f = frame()
    fill(f, 0, 8, [0, 0, 0])
    fill(f, 8, 28, [0, 200, 0])
    fill(f, 28, 36, [0, 0, 0])

    const pipeline = new SyncPipeline(column, DEFAULT_SYNC_SETTINGS)

    for (const color of settle(pipeline, f)) {
      expect(color.g).toBeGreaterThan(120)
    }
  })

  it('follows panel positions in spatial mode', () => {
    const f = frame()
    fill(f, 0, 18, [255, 0, 0])
    fill(f, 18, 36, [0, 0, 255])

    const pipeline = new SyncPipeline(column, {
      ...DEFAULT_SYNC_SETTINGS,
      radius: 0.08,
      saturation: 1,
    })
    const colours = settle(pipeline, f)

    // `normalizeLayout` flips the Y axis: the panel highest on the device
    // (y = 400) ends up at the top of the screen, hence first.
    const top = colours[0]!
    const bottom = colours[2]!
    expect(top.r).toBeGreaterThan(top.b)
    expect(bottom.b).toBeGreaterThan(bottom.r)
  })

  it('gives every panel the same colour in dominant mode', () => {
    const f = frame()
    fill(f, 0, 18, [255, 0, 0])
    fill(f, 18, 36, [0, 0, 255])

    const pipeline = new SyncPipeline(column, { ...DEFAULT_SYNC_SETTINGS, mode: 'dominant' })
    const [a, b, c] = settle(pipeline, f)

    expect(a).toEqual(b)
    expect(b).toEqual(c)
  })

  it('returns black on a black image, with no NaN', () => {
    const pipeline = new SyncPipeline(column, DEFAULT_SYNC_SETTINGS)

    for (const color of settle(pipeline, frame())) {
      expect(color).toEqual({ r: 0, g: 0, b: 0 })
    }
  })

  it('survives a mode change mid-flight', () => {
    const pipeline = new SyncPipeline(column, DEFAULT_SYNC_SETTINGS)
    pipeline.process(flatRed())

    pipeline.update({ ...DEFAULT_SYNC_SETTINGS, mode: 'dominant' })
    const colours = pipeline.process(flatRed())

    expect(colours).toHaveLength(3)
    expect(Number.isFinite(colours[0]!.r)).toBe(true)
  })

  it('ramps up gradually instead of jumping to the target', () => {
    const pipeline = new SyncPipeline(column, { ...DEFAULT_SYNC_SETTINGS, saturation: 1 })
    pipeline.process(frame())

    const afterOneStep = pipeline.process(flatRed())[0]!.r
    const settled = settle(pipeline, flatRed())[0]!.r

    expect(afterOneStep).toBeLessThan(settled)
  })

  it('starts over after a reset', () => {
    const pipeline = new SyncPipeline(column, DEFAULT_SYNC_SETTINGS)
    settle(pipeline, flatRed())

    pipeline.reset()

    expect(pipeline.process(frame())).toEqual([
      { r: 0, g: 0, b: 0 },
      { r: 0, g: 0, b: 0 },
      { r: 0, g: 0, b: 0 },
    ])
  })

  it('returns an empty array for a wall with no panels', () => {
    const pipeline = new SyncPipeline(normalizeLayout([], 100), DEFAULT_SYNC_SETTINGS)

    expect(pipeline.process(flatRed())).toEqual([])
  })
})
