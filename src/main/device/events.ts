import { NanoleafError } from './errors'

/** Stream categories: 1 state, 2 layout, 3 effects, 4 touch. */
const CATEGORIES = '1,2,3'

export interface DeviceEvent {
  deviceId: string
  /** What changed, as the device reports it. */
  kind: 'on' | 'brightness' | 'hue' | 'sat' | 'ct' | 'colourMode' | 'effect' | 'layout'
  value: string | number | boolean
}

/** Attributes of the "state" category, in protocol order. */
const STATE_ATTRIBUTES: Record<number, DeviceEvent['kind']> = {
  1: 'on',
  2: 'brightness',
  3: 'hue',
  4: 'sat',
  5: 'ct',
  6: 'colourMode',
}

interface RawBlock {
  events?: Array<{ attr?: number; value?: unknown }>
}

/**
 * Turns one block of the stream into usable events.
 *
 * The device speaks Server-Sent Events: `id:` carries the category and
 * `data:` an object whose `attr` numbers are scoped to that category. Pure,
 * hence testable without a device.
 */
export function parseEventBlock(id: string, data: string): DeviceEvent[] {
  let raw: RawBlock
  try {
    raw = JSON.parse(data) as RawBlock
  } catch {
    return []
  }

  const category = Number(id)
  return (raw.events ?? []).flatMap((event): DeviceEvent[] => {
    const value = event.value
    if (value === undefined || value === null) return []

    if (category === 1) {
      const kind = STATE_ATTRIBUTES[event.attr ?? 0]
      if (kind === undefined) return []
      return [{ deviceId: '', kind, value: value as string | number | boolean }]
    }

    // Category 3: only `attr: 1` carries the selected effect's name.
    if (category === 3 && event.attr === 1) {
      return [{ deviceId: '', kind: 'effect', value: String(value) }]
    }

    if (category === 2) return [{ deviceId: '', kind: 'layout', value: String(value) }]

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
 * Follows what changes on a device, continuously.
 *
 * Without this stream the application would not see commands issued
 * elsewhere — the mobile app, the physical button — and would show a stale
 * state until the next full re-read.
 */
export function subscribeToEvents(options: SubscribeOptions): EventSubscription {
  const controller = new AbortController()
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal

  const url = `http://${options.ip}:${options.port}/api/v1/${options.token}/events?id=${CATEGORIES}`

  void (async () => {
    try {
      const response = await fetch(url, { signal, headers: { accept: 'text/event-stream' } })
      if (!response.ok || response.body === null) {
        throw new NanoleafError(`Event stream refused (${response.status})`, response.status)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (!signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // Blocks are separated by a blank line.
        let cut = buffer.indexOf('\n\n')
        while (cut !== -1) {
          const block = buffer.slice(0, cut)
          buffer = buffer.slice(cut + 2)
          for (const event of parseBlock(block)) {
            options.onEvent({ ...event, deviceId: options.deviceId })
          }
          cut = buffer.indexOf('\n\n')
        }
      }
    } catch (cause) {
      if (!signal.aborted) options.onError?.(cause)
    }
  })()

  return { close: () => controller.abort() }
}

/** Splits one SSE block into its `id:` and `data:` fields. */
function parseBlock(block: string): DeviceEvent[] {
  let id = ''
  let data = ''
  for (const line of block.split('\n')) {
    if (line.startsWith('id:')) id = line.slice(3).trim()
    else if (line.startsWith('data:')) data += line.slice(5).trim()
  }
  return id === '' || data === '' ? [] : parseEventBlock(id, data)
}
