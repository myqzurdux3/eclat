/**
 * Serialises writes, keeping at most one in flight and letting the latest
 * value win over the ones before it.
 *
 * A slider dragged with the mouse emits around sixty events per second,
 * while a REST write to the controller takes 60 to 340 ms. Throttling at a
 * fixed rate is not enough: the backlog would still pile up. Here the
 * intermediate values are simply dropped, which costs nothing — only the
 * last position of the slider matters.
 */
export function createCoalescer<T>(send: (value: T) => Promise<unknown>): (value: T) => void {
  let inFlight = false
  let pending: { value: T } | null = null

  const drain = (): void => {
    if (pending === null) {
      inFlight = false
      return
    }

    const { value } = pending
    pending = null
    inFlight = true
    void Promise.resolve(send(value))
      // A lost write is not worth retrying: the next one corrects it.
      .catch(() => undefined)
      .then(drain)
  }

  return (value: T): void => {
    pending = { value }
    if (!inFlight) drain()
  }
}
