import { fr } from './fr'
import type { MessageKey, Translate } from './index'

/** `[error.deviceUnpaired] Device non appairé : Shapes` → la clé. */
const CLE = /\[(error\.[A-Za-z]+)\]/

const EXISTE = (cle: string): cle is MessageKey => cle in fr

/**
 * Traduit une erreur remontée par le processus main.
 *
 * Electron aplatit les objets `Error` qui traversent l'IPC : le renderer ne
 * reçoit qu'un message, préfixé du nom de la méthode invoquée. La clé de
 * traduction y est encodée entre crochets ; à défaut, le message brut est
 * rendu tel quel — mieux vaut un texte non traduit qu'une erreur avalée.
 */
export function translateError(raw: string, t: Translate): string {
  const trouve = CLE.exec(raw)
  if (trouve === null) return raw

  const cle = trouve[1]!
  return EXISTE(cle) ? t(cle) : raw
}
