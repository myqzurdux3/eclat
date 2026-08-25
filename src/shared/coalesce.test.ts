import { describe, expect, it } from 'vitest'
import { createCoalescer } from './coalesce'

/** A manual sender: each send stays in flight until it is resolved. */
function manualSender() {
  const sent: number[] = []
  const waiting: Array<() => void> = []
  return {
    sent,
    resolveNext() {
      waiting.shift()?.()
    },
    inFlight: () => waiting.length,
    send(value: number): Promise<void> {
      sent.push(value)
      return new Promise<void>((resolve) => waiting.push(resolve))
    },
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createCoalescer', () => {
  it('sends the first value straight away', async () => {
    const sender = manualSender()
    const push = createCoalescer(sender.send)

    push(1)
    await tick()

    expect(sender.sent).toEqual([1])
  })

  it('keeps only one request in flight', async () => {
    const sender = manualSender()
    const push = createCoalescer(sender.send)

    push(1)
    await tick()
    push(2)
    push(3)
    await tick()

    expect(sender.sent).toEqual([1])
    expect(sender.inFlight()).toBe(1)
  })

  it('sends the last pending value, not the ones in between', async () => {
    const sender = manualSender()
    const push = createCoalescer(sender.send)

    push(1)
    await tick()
    push(2)
    push(3)
    push(4)
    sender.resolveNext()
    await tick()

    expect(sender.sent).toEqual([1, 4])
  })

  it('goes quiet once nothing is pending', async () => {
    const sender = manualSender()
    const push = createCoalescer(sender.send)

    push(1)
    await tick()
    sender.resolveNext()
    await tick()

    expect(sender.sent).toEqual([1])
  })

  it('carries on after a failed send', async () => {
    const failures: number[] = []
    const push = createCoalescer<number>((value) => {
      failures.push(value)
      return Promise.reject(new Error('boom'))
    })

    push(1)
    await tick()
    push(2)
    await tick()
    await tick()

    expect(failures).toEqual([1, 2])
  })

  it('chains values for as long as they keep arriving', async () => {
    const sender = manualSender()
    const push = createCoalescer(sender.send)

    push(1)
    await tick()
    push(2)
    sender.resolveNext()
    await tick()
    push(3)
    sender.resolveNext()
    await tick()

    expect(sender.sent).toEqual([1, 2, 3])
  })
})
