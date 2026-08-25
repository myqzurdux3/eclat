import { describe, expect, it } from 'vitest'
import { mapSpatial } from './mapping-spatial'
import { normalizeLayout } from '../../main/device/layout'
import type { Frame } from './srgb'

function frame(width: number, height: number): Frame {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) data[i * 4 + 3] = 255
  return { width, height, data }
}

function peindre(
  f: Frame,
  x0: number,
  x1: number,
  [r, g, b]: [number, number, number],
): void {
  for (let y = 0; y < f.height; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * f.width + x) * 4
      f.data[at] = r
      f.data[at + 1] = g
      f.data[at + 2] = b
    }
  }
}

/** Deux panneaux, l'un à gauche, l'autre à droite. */
const paire = normalizeLayout(
  [
    { panelId: 1, x: 0, y: 0, o: 0, shapeType: 8 },
    { panelId: 2, x: 300, y: 0, o: 0, shapeType: 8 },
  ],
  100,
)

const rectEntier = (f: Frame) => ({ x: 0, y: 0, width: f.width, height: f.height })

function moitieRougeBleue(): Frame {
  const f = frame(64, 36)
  peindre(f, 0, 32, [255, 0, 0])
  peindre(f, 32, 64, [0, 0, 255])
  return f
}

describe('mapSpatial', () => {
  it('rend une couleur par panneau', () => {
    expect(mapSpatial(moitieRougeBleue(), rectEntier(moitieRougeBleue()), paire, 0.18)).toHaveLength(
      2,
    )
  })

  it('donne au panneau de gauche la couleur de gauche', () => {
    const f = moitieRougeBleue()
    const [gauche, droite] = mapSpatial(f, rectEntier(f), paire, 0.12)

    expect(gauche!.r).toBeGreaterThan(gauche!.b)
    expect(droite!.b).toBeGreaterThan(droite!.r)
  })

  it('un rayon large rapproche les panneaux, un rayon étroit les sépare', () => {
    const f = moitieRougeBleue()
    const ecart = (radius: number) => {
      const [a, b] = mapSpatial(f, rectEntier(f), paire, radius)
      return Math.abs(a!.r - b!.r)
    }

    expect(ecart(0.5)).toBeLessThan(ecart(0.05))
  })

  it('ne regarde que le rectangle utile', () => {
    const f = frame(64, 36)
    // Bandes noires en haut et en bas, image rouge au milieu.
    peindre(f, 0, 64, [0, 0, 0])
    for (let y = 10; y < 26; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const at = (y * 64 + x) * 4
        f.data[at] = 255
      }
    }

    const rogne = mapSpatial(f, { x: 0, y: 10, width: 64, height: 16 }, paire, 0.18)

    expect(rogne[0]!.r).toBeGreaterThan(0.9)
  })

  it('rend un tableau vide pour un mur sans panneau', () => {
    const f = moitieRougeBleue()

    expect(mapSpatial(f, rectEntier(f), normalizeLayout([], 100), 0.18)).toEqual([])
  })

  it('ne rend jamais de NaN, même sur un rayon minuscule', () => {
    const f = moitieRougeBleue()

    for (const color of mapSpatial(f, rectEntier(f), paire, 0.001)) {
      expect(Number.isFinite(color.r)).toBe(true)
      expect(Number.isFinite(color.g)).toBe(true)
      expect(Number.isFinite(color.b)).toBe(true)
    }
  })

  it('reste sur du noir quand l image est noire', () => {
    const f = frame(64, 36)

    for (const color of mapSpatial(f, rectEntier(f), paire, 0.18)) {
      expect(color.r).toBeCloseTo(0, 6)
    }
  })
})
