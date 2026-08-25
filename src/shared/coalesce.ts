/**
 * Sérialise des envois en n'en gardant qu'un en vol, la dernière valeur
 * poussée gagnant sur les précédentes.
 *
 * Un curseur déplacé à la souris émet une soixantaine d'événements par
 * seconde, alors qu'une écriture REST sur le contrôleur prend 60 à 340 ms.
 * Étrangler à cadence fixe ne suffit pas : le retard s'accumulerait quand
 * même. Ici les valeurs intermédiaires sont simplement abandonnées, ce qui
 * n'enlève rien — seule la dernière position du curseur compte.
 */
export function createCoalescer<T>(send: (value: T) => Promise<unknown>): (value: T) => void {
  let enVol = false
  let enAttente: { value: T } | null = null

  const vider = (): void => {
    if (enAttente === null) {
      enVol = false
      return
    }

    const { value } = enAttente
    enAttente = null
    enVol = true
    void Promise.resolve(send(value))
      // Une écriture perdue n'est pas rattrapable : la suivante corrige.
      .catch(() => undefined)
      .then(vider)
  }

  return (value: T): void => {
    enAttente = { value }
    if (!enVol) vider()
  }
}
