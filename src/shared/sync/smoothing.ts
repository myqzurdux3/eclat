import type { LinearColor } from './srgb'

/**
 * Lissage temporel asymétrique.
 *
 * Un EMA symétrique oblige à choisir entre deux défauts : rapide, il fait
 * clignoter les panneaux à chaque coupe de plan ; lent, il rend la
 * synchronisation molle. Monter vite et redescendre lentement donne la
 * réactivité sans le strobe — l'œil pardonne une extinction traînante, pas
 * un allumage en retard.
 *
 * Le lissage porte sur des valeurs linéaires, avant retour en sRGB : lisser
 * du gamma fait respirer les basses lumières de travers.
 */
export class Smoother {
  private precedent: LinearColor[] | null = null

  constructor(
    private readonly attack: number,
    private readonly release: number,
  ) {}

  /** Lisse une frame et rend le résultat. */
  push(colors: LinearColor[]): LinearColor[] {
    const precedent = this.precedent

    // Première frame, ou mur dont le nombre de panneaux a changé : on prend
    // la valeur telle quelle plutôt que de la faire monter depuis le noir.
    if (precedent === null || precedent.length !== colors.length) {
      this.precedent = colors.map((color) => ({ ...color }))
      return this.precedent.map((color) => ({ ...color }))
    }

    const lisse = colors.map((cible, index) => {
      const avant = precedent[index]!
      return {
        r: this.canal(avant.r, cible.r),
        g: this.canal(avant.g, cible.g),
        b: this.canal(avant.b, cible.b),
      }
    })

    this.precedent = lisse
    return lisse.map((color) => ({ ...color }))
  }

  reset(): void {
    this.precedent = null
  }

  private canal(avant: number, cible: number): number {
    const coefficient = cible > avant ? this.attack : this.release
    return avant + coefficient * (cible - avant)
  }
}
