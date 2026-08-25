import { NanoleafError } from './errors'

/** Catégories du flux : 1 état, 2 layout, 3 effets, 4 tactile. */
const CATEGORIES = '1,2,3'

export interface DeviceEvent {
  deviceId: string
  /** Ce qui a changé, tel que le device le rapporte. */
  kind: 'on' | 'brightness' | 'hue' | 'sat' | 'ct' | 'colourMode' | 'effect' | 'layout'
  value: string | number | boolean
}

/** Attributs de la catégorie « état », dans l'ordre du protocole. */
const ATTRIBUTS_ETAT: Record<number, DeviceEvent['kind']> = {
  1: 'on',
  2: 'brightness',
  3: 'hue',
  4: 'sat',
  5: 'ct',
  6: 'colourMode',
}

interface Brut {
  events?: Array<{ attr?: number; value?: unknown }>
}

/**
 * Traduit un bloc du flux en événements exploitables.
 *
 * Le device envoie du Server-Sent Events : `id:` porte la catégorie et
 * `data:` un objet dont les `attr` sont numérotés par catégorie. Pure, donc
 * testable sans device.
 */
export function parseEventBlock(id: string, data: string): DeviceEvent[] {
  let brut: Brut
  try {
    brut = JSON.parse(data) as Brut
  } catch {
    return []
  }

  const categorie = Number(id)
  return (brut.events ?? []).flatMap((event): DeviceEvent[] => {
    const valeur = event.value
    if (valeur === undefined || valeur === null) return []

    if (categorie === 1) {
      const kind = ATTRIBUTS_ETAT[event.attr ?? 0]
      if (kind === undefined) return []
      return [{ deviceId: '', kind, value: valeur as string | number | boolean }]
    }

    // Catégorie 3 : seul `attr: 1` porte le nom de l'effet sélectionné.
    if (categorie === 3 && event.attr === 1) {
      return [{ deviceId: '', kind: 'effect', value: String(valeur) }]
    }

    if (categorie === 2) return [{ deviceId: '', kind: 'layout', value: String(valeur) }]

    return []
  })
}

export interface EventSubscription {
  close(): void
}

export interface SubscribeOptions {
  ip: string
  port: number
  token: string
  deviceId: string
  onEvent: (event: DeviceEvent) => void
  onError?: (cause: unknown) => void
  signal?: AbortSignal
}

/**
 * Suit en continu ce qui change sur un device.
 *
 * Sans ce flux, l'application ne verrait pas les commandes venues d'ailleurs
 * — l'app mobile, le bouton physique — et afficherait un état périmé jusqu'à
 * la prochaine relecture.
 */
export function subscribeToEvents(options: SubscribeOptions): EventSubscription {
  const controleur = new AbortController()
  const signal = options.signal
    ? AbortSignal.any([controleur.signal, options.signal])
    : controleur.signal

  const url = `http://${options.ip}:${options.port}/api/v1/${options.token}/events?id=${CATEGORIES}`

  void (async () => {
    try {
      const reponse = await fetch(url, { signal, headers: { accept: 'text/event-stream' } })
      if (!reponse.ok || reponse.body === null) {
        throw new NanoleafError(`Flux d evenements refuse (${reponse.status})`, reponse.status)
      }

      const lecteur = reponse.body.getReader()
      const decodeur = new TextDecoder()
      let tampon = ''

      while (!signal.aborted) {
        const { done, value } = await lecteur.read()
        if (done) break
        tampon += decodeur.decode(value, { stream: true })

        // Les blocs sont séparés par une ligne vide.
        let coupure = tampon.indexOf('\n\n')
        while (coupure !== -1) {
          const bloc = tampon.slice(0, coupure)
          tampon = tampon.slice(coupure + 2)
          for (const evenement of parseBlock(bloc)) {
            options.onEvent({ ...evenement, deviceId: options.deviceId })
          }
          coupure = tampon.indexOf('\n\n')
        }
      }
    } catch (cause) {
      if (!signal.aborted) options.onError?.(cause)
    }
  })()

  return { close: () => controleur.abort() }
}

/** Découpe un bloc SSE en ses champs `id:` et `data:`. */
function parseBlock(bloc: string): DeviceEvent[] {
  let id = ''
  let data = ''
  for (const ligne of bloc.split('\n')) {
    if (ligne.startsWith('id:')) id = ligne.slice(3).trim()
    else if (ligne.startsWith('data:')) data += ligne.slice(5).trim()
  }
  return id === '' || data === '' ? [] : parseEventBlock(id, data)
}
