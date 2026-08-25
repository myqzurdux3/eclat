import { NanoleafError } from './errors'

export interface PairOptions {
  ip: string
  port?: number
  /** Attempt count; 15 attempts at 2 s cover the 30 s window. */
  attempts?: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Polls the device until it hands over a token.
 *
 * The controller only accepts `POST /api/v1/new` during the few seconds that
 * follow a long press on the power button; it answers 403 the rest of the
 * time. The loop is therefore harmless outside the pairing window.
 */
export async function pairDevice(options: PairOptions): Promise<string> {
  const port = options.port ?? 16021
  const attempts = options.attempts ?? 15
  const intervalMs = options.intervalMs ?? 2000
  const sleep = options.sleep ?? defaultSleep
  const url = `http://${options.ip}:${port}/api/v1/new`
  let lastStatus = 0

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new NanoleafError('Pairing cancelled', 0, 'error.pairingCancelled')
    }

    try {
      const signals = [AbortSignal.timeout(4000)]
      if (options.signal) signals.push(options.signal)
      const signal = AbortSignal.any(signals)

      const response = await fetch(url, {
        method: 'POST',
        signal,
      })

      lastStatus = response.status
      if (response.ok) {
        const body = (await response.json()) as { auth_token?: string }
        if (typeof body.auth_token === 'string' && body.auth_token.length > 0) {
          return body.auth_token
        }
        throw new NanoleafError('Pairing response without auth_token', response.status)
      }
    } catch (error) {
      if (error instanceof NanoleafError) throw error
      // Device unreachable on this attempt: try again.
    }

    if (attempt < attempts - 1) {
      await sleep(intervalMs)
    }
  }

  throw new NanoleafError(
    'Pairing failed: hold the power button for 5-7 s until it blinks, then try again',
    lastStatus,
    'error.pairingRefused',
  )
}
