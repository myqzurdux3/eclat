import { NanoleafError } from './errors'

export interface PairOptions {
  ip: string
  port?: number
  /** Nombre de tentatives ; 15 tentatives à 2 s couvrent la fenêtre de 30 s. */
  attempts?: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Sollicite le device jusqu'à obtention d'un token.
 *
 * Le contrôleur n'accepte `POST /api/v1/new` que pendant les quelques
 * secondes qui suivent un appui long sur le bouton power ; il répond 403 le
 * reste du temps. La boucle est donc inoffensive hors fenêtre d'appairage.
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
      throw new NanoleafError('Appairage annulé', 0, 'error.pairingCancelled')
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
        throw new NanoleafError('Réponse d appairage sans auth_token', response.status)
      }
    } catch (error) {
      if (error instanceof NanoleafError) throw error
      // Device injoignable sur cette tentative : on retente.
    }

    if (attempt < attempts - 1) {
      await sleep(intervalMs)
    }
  }

  throw new NanoleafError(
    'Appairage échoué : maintiens le bouton power 5-7 s jusqu au clignotement, puis réessaie',
    lastStatus,
    'error.pairingRefused',
  )
}
