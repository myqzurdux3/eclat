import { fr } from './fr'
import type { MessageKey, Translate } from './index'

/**
 * What an unknown failure has to say for itself.
 *
 * Electron flattens `Error` across IPC, so what arrives is a message; and a
 * `catch` binding is `unknown`, so it may be anything at all. This was
 * written out at seven call sites, once with the wrapper left on.
 */
export function reasonFor(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** `[error.deviceUnpaired] Device not paired: Shapes` yields the key. */
const KEY = /\[(error\.[A-Za-z]+)\]/

const EXISTS = (key: string): key is MessageKey => key in fr

/**
 * Translates an error raised by the main process.
 *
 * Electron flattens `Error` objects that cross the IPC boundary: the
 * renderer only receives a message, prefixed with the name of the invoked
 * method. The translation key is encoded in it between brackets; failing
 * that, the raw message is shown as it is — an untranslated string beats a
 * swallowed error.
 */
export function translateError(raw: string, t: Translate): string {
  const found = KEY.exec(raw)
  if (found === null) return raw

  const key = found[1]!
  return EXISTS(key) ? t(key) : raw
}
