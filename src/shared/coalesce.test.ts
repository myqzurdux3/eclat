import { describe, expect, it } from 'vitest'
import { createCoalescer } from './coalesce'

/** Émetteur manuel : chaque envoi reste en vol jusqu'à ce qu'on le résolve. */
function manualSender() {
  const envoyes: number[] = []
  const enAttente: Array<() => void> = []
  return {
    envoyes,
    resoudreSuivant() {
      enAttente.shift()?.()
    },
    enVol: () => enAttente.length,
    send(value: number): Promise<void> {
      envoyes.push(value)
      return new Promise<void>((resolve) => enAttente.push(resolve))
    },
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createCoalescer', () => {
  it('envoie la première valeur tout de suite', async () => {
    const sender = manualSender()
    const push = createCoalescer(sender.send)

    push(1)
    await tick()

    expect(sender.envoyes).toEqual([1])
  })

  it('ne garde qu une requête en vol', async () => {
    const sender = manualSender()
    const push = createCoalescer(sender.send)

    push(1)
    await tick()
    push(2)
    push(3)
    await tick()

    expect(sender.envoyes).toEqual([1])
    expect(sender.enVol()).toBe(1)
  })

  it('envoie la dernière valeur en attente, pas les intermédiaires', async () => {
    const sender = manualSender()
    const push = createCoalescer(sender.send)

    push(1)
    await tick()
    push(2)
    push(3)
    push(4)
    sender.resoudreSuivant()
    await tick()

    expect(sender.envoyes).toEqual([1, 4])
  })

  it('se tait quand plus rien n est en attente', async () => {
    const sender = manualSender()
    const push = createCoalescer(sender.send)

    push(1)
    await tick()
    sender.resoudreSuivant()
    await tick()

    expect(sender.envoyes).toEqual([1])
  })

  it('reprend après un envoi en échec', async () => {
    const echecs: number[] = []
    const push = createCoalescer<number>((value) => {
      echecs.push(value)
      return Promise.reject(new Error('boum'))
    })

    push(1)
    await tick()
    push(2)
    await tick()
    await tick()

    expect(echecs).toEqual([1, 2])
  })

  it('enchaîne les valeurs tant qu il en arrive', async () => {
    const sender = manualSender()
    const push = createCoalescer(sender.send)

    push(1)
    await tick()
    push(2)
    sender.resoudreSuivant()
    await tick()
    push(3)
    sender.resoudreSuivant()
    await tick()

    expect(sender.envoyes).toEqual([1, 2, 3])
  })
})
