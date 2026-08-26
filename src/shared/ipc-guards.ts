import type { Color, SourceId } from './types'

/**
 * What crosses the IPC boundary, checked.
 *
 * The type annotations on the handlers are decoration: values arrive over a
 * channel, structured-cloned, with nothing to say they match. Nothing on the
 * other side is hostile today — the renderer loads no remote content — but
 * this is the only trust boundary the application has, and a wrong shape
 * should be refused at it rather than surface three layers down as a
 * `TypeError` on someone's wall.
 */
export function asDeviceId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new TypeError('deviceId must be a non-empty string')
  }
  return value
}

export function asText(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length > 1000) {
    throw new TypeError(`${what} must be a string`)
  }
  return value
}

export function asBoolean(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${what} must be a boolean`)
  return value
}

/** A finite number, clamped into range: out of range is a mistake, not an attack. */
export function asNumber(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${what} must be a finite number`)
  }
  return Math.min(max, Math.max(min, value))
}

const SOURCES: SourceId[] = ['manual', 'screen', 'audio']

export function asSource(value: unknown): SourceId {
  if (!SOURCES.includes(value as SourceId)) throw new TypeError('unknown source')
  return value as SourceId
}

const channel = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(255, Math.max(0, Math.round(value)))
    : 0

export function asColor(value: unknown): Color {
  if (typeof value !== 'object' || value === null) throw new TypeError('colour must be an object')
  const { r, g, b } = value as Record<string, unknown>
  return { r: channel(r), g: channel(g), b: channel(b) }
}

/** The most panels one frame may carry: past this it is not a wall. */
const MAX_FRAME = 1024

export function asColors(value: unknown): Color[] {
  if (!Array.isArray(value)) throw new TypeError('colours must be an array')
  if (value.length > MAX_FRAME) throw new TypeError('too many colours in one frame')
  return value.map(asColor)
}

export function asPaintEntries(value: unknown): Array<{ panelId: number; color: Color }> {
  if (!Array.isArray(value)) throw new TypeError('entries must be an array')
  if (value.length > MAX_FRAME) throw new TypeError('too many panels in one stroke')
  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new TypeError('each entry must be an object')
    }
    const { panelId, color } = entry as Record<string, unknown>
    return { panelId: asNumber(panelId, 'panelId', 0, Number.MAX_SAFE_INTEGER), color: asColor(color) }
  })
}
