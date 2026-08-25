import { fr } from './fr'
import type { MessageKey, Translate } from './index'

/** `[error.deviceUnpaired] Device not paired: Shapes` yields the key. */
const CLE = /\[(error\.[A-Za-z]+)\]/

const EXISTE = (cle: string): cle is MessageKey => cle in fr

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
  const trouve = CLE.exec(raw)
  if (trouve === null) return raw

  const cle = trouve[1]!
  return EXISTE(cle) ? t(cle) : raw
}
