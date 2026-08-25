import { describe, expect, it } from 'vitest'
import { SyncPipeline } from './pipeline'
import { DEFAULT_SYNC_SETTINGS } from './settings'
import { normalizeLayout } from '../../main/device/layout'
import type { Frame } from './srgb'

/** Trois panneaux en colonne : haut, milieu, bas. */
const colonne = normalizeLayout(
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

function remplir(
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

const rougeUni = (): Frame => {
  const f = frame()
  remplir(f, 0, f.height, [255, 0, 0])
  return f
}

/** Pousse la même frame jusqu'à ce que le lissage ait convergé. */
function stabiliser(pipeline: SyncPipeline, f: Frame, tours = 80) {
  let dernier = pipeline.process(f)
  for (let i = 0; i < tours; i += 1) dernier = pipeline.process(f)
  return dernier
}

describe('SyncPipeline', () => {
  it('rend exactement une couleur par panneau', () => {
    const pipeline = new SyncPipeline(colonne, DEFAULT_SYNC_SETTINGS)

    expect(pipeline.process(rougeUni())).toHaveLength(3)
  })

  it('rend du rouge sur une image rouge, dans les trois modes', () => {
    for (const mode of ['spatial', 'dominant', 'palette'] as const) {
      const pipeline = new SyncPipeline(colonne, { ...DEFAULT_SYNC_SETTINGS, mode })

      for (const color of stabiliser(pipeline, rougeUni())) {
        expect(color.r).toBeGreaterThan(200)
        expect(color.g).toBeLessThan(60)
        expect(color.b).toBeLessThan(60)
      }
    }
  })

  it('n éteint pas les panneaux hauts et bas sur une image en letterbox', () => {
    const f = frame()
    remplir(f, 0, 8, [0, 0, 0])
    remplir(f, 8, 28, [0, 200, 0])
    remplir(f, 28, 36, [0, 0, 0])

    const pipeline = new SyncPipeline(colonne, DEFAULT_SYNC_SETTINGS)

    for (const color of stabiliser(pipeline, f)) {
      expect(color.g).toBeGreaterThan(120)
    }
  })

  it('suit la position des panneaux en mode spatial', () => {
    const f = frame()
    remplir(f, 0, 18, [255, 0, 0])
    remplir(f, 18, 36, [0, 0, 255])

    const pipeline = new SyncPipeline(colonne, {
      ...DEFAULT_SYNC_SETTINGS,
      radius: 0.08,
      saturation: 1,
    })
    const couleurs = stabiliser(pipeline, f)

    // `normalizeLayout` inverse l'axe Y : le panneau le plus haut côté
    // device (y = 400) se retrouve en haut de l'écran, donc en tête.
    const haut = couleurs[0]!
    const bas = couleurs[2]!
    expect(haut.r).toBeGreaterThan(haut.b)
    expect(bas.b).toBeGreaterThan(bas.r)
  })

  it('donne la même couleur à tous les panneaux en mode dominant', () => {
    const f = frame()
    remplir(f, 0, 18, [255, 0, 0])
    remplir(f, 18, 36, [0, 0, 255])

    const pipeline = new SyncPipeline(colonne, { ...DEFAULT_SYNC_SETTINGS, mode: 'dominant' })
    const [a, b, c] = stabiliser(pipeline, f)

    expect(a).toEqual(b)
    expect(b).toEqual(c)
  })

  it('rend du noir sur une image noire, sans NaN', () => {
    const pipeline = new SyncPipeline(colonne, DEFAULT_SYNC_SETTINGS)

    for (const color of stabiliser(pipeline, frame())) {
      expect(color).toEqual({ r: 0, g: 0, b: 0 })
    }
  })

  it('encaisse un changement de mode en cours de route', () => {
    const pipeline = new SyncPipeline(colonne, DEFAULT_SYNC_SETTINGS)
    pipeline.process(rougeUni())

    pipeline.update({ ...DEFAULT_SYNC_SETTINGS, mode: 'dominant' })
    const couleurs = pipeline.process(rougeUni())

    expect(couleurs).toHaveLength(3)
    expect(Number.isFinite(couleurs[0]!.r)).toBe(true)
  })

  it('remonte progressivement, sans sauter à la valeur cible', () => {
    const pipeline = new SyncPipeline(colonne, { ...DEFAULT_SYNC_SETTINGS, saturation: 1 })
    pipeline.process(frame())

    const apresUnPas = pipeline.process(rougeUni())[0]!.r
    const stabilise = stabiliser(pipeline, rougeUni())[0]!.r

    expect(apresUnPas).toBeLessThan(stabilise)
  })

  it('repart de zéro après un reset', () => {
    const pipeline = new SyncPipeline(colonne, DEFAULT_SYNC_SETTINGS)
    stabiliser(pipeline, rougeUni())

    pipeline.reset()

    expect(pipeline.process(frame())).toEqual([
      { r: 0, g: 0, b: 0 },
      { r: 0, g: 0, b: 0 },
      { r: 0, g: 0, b: 0 },
    ])
  })

  it('rend un tableau vide pour un mur sans panneau', () => {
    const pipeline = new SyncPipeline(normalizeLayout([], 100), DEFAULT_SYNC_SETTINGS)

    expect(pipeline.process(rougeUni())).toEqual([])
  })
})
