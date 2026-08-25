import { describe, expect, it } from 'vitest'
import { sceneMotion } from './scene-motion'
import type { Color } from './types'

const palette: Color[] = [
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 },
]

describe('sceneMotion', () => {
  it('rend une couleur par panneau', () => {
    expect(sceneMotion(palette, 5, 0)).toHaveLength(5)
  })

  it('rend du noir sans palette', () => {
    expect(sceneMotion([], 2, 0)).toEqual([
      { r: 0, g: 0, b: 0 },
      { r: 0, g: 0, b: 0 },
    ])
  })

  it('rend un tableau vide sans panneau', () => {
    expect(sceneMotion(palette, 0, 0)).toEqual([])
  })

  it('tient la couleur unique d une palette à une seule entrée', () => {
    const unique = [{ r: 10, g: 20, b: 30 }]

    for (const couleur of sceneMotion(unique, 4, 1234)) {
      expect(couleur).toEqual({ r: 10, g: 20, b: 30 })
    }
  })

  it('avance dans le temps', () => {
    const debut = sceneMotion(palette, 6, 0)
    const plusTard = sceneMotion(palette, 6, 1500)

    expect(plusTard).not.toEqual(debut)
  })

  it('boucle sur la période sans saut', () => {
    const periode = 3 * 4000
    const apres = sceneMotion(palette, 6, periode)
    const debut = sceneMotion(palette, 6, 0)

    // À un niveau près : `3 + 1.05` et `1.05` n'ont pas la même mantisse.
    apres.forEach((couleur, index) => {
      expect(Math.abs(couleur.r - debut[index]!.r)).toBeLessThanOrEqual(1)
      expect(Math.abs(couleur.g - debut[index]!.g)).toBeLessThanOrEqual(1)
      expect(Math.abs(couleur.b - debut[index]!.b)).toBeLessThanOrEqual(1)
    })
  })

  it('décale les panneaux les uns par rapport aux autres', () => {
    const couleurs = sceneMotion(palette, 6, 0)

    expect(couleurs[0]).not.toEqual(couleurs[3])
  })

  it('interpole entre deux entrées de la palette', () => {
    // À mi-chemin entre le rouge et le vert, les deux canaux sont présents.
    const milieu = sceneMotion([palette[0]!, palette[1]!], 1, 2000, { dureeMs: 4000 })[0]!

    expect(milieu.r).toBeGreaterThan(0)
    expect(milieu.g).toBeGreaterThan(0)
  })

  it('reste dans les bornes RGB', () => {
    for (const t of [0, 137, 999, 5000, 123456]) {
      for (const couleur of sceneMotion(palette, 9, t)) {
        for (const canal of [couleur.r, couleur.g, couleur.b]) {
          expect(canal).toBeGreaterThanOrEqual(0)
          expect(canal).toBeLessThanOrEqual(255)
          expect(Number.isInteger(canal)).toBe(true)
        }
      }
    }
  })

  it('resserre ou étale la vague selon l étalement demandé', () => {
    const serre = sceneMotion(palette, 6, 0, { etalement: 0 })
    const etale = sceneMotion(palette, 6, 0, { etalement: 1 })

    // Sans étalement, tous les panneaux partagent la même couleur.
    expect(serre.every((couleur) => couleur === serre[0] || sameColour(couleur, serre[0]!))).toBe(
      true,
    )
    expect(sameColour(etale[0]!, etale[3]!)).toBe(false)
  })
})

function sameColour(a: Color, b: Color): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b
}
