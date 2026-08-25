import type { MessageKey } from '../../shared/i18n'

/**
 * Clés d'erreur destinées à l'utilisateur, par opposition aux messages
 * purement diagnostiques.
 */
export type ErrorKey = Extract<MessageKey, `error.${string}`>

/**
 * Erreur renvoyée par le contrôleur Nanoleaf, porteuse du code HTTP.
 *
 * Quand l'erreur a de quoi être montrée à l'utilisateur, sa clé de
 * traduction est encodée entre crochets en tête du message. Electron aplatit
 * les objets `Error` qui traversent l'IPC — seul le message survit — donc y
 * glisser la clé est le seul moyen de la faire arriver jusqu'au renderer.
 */
export class NanoleafError extends Error {
  readonly key: ErrorKey | undefined

  constructor(message: string, readonly status: number, key?: ErrorKey) {
    super(key === undefined ? message : `[${key}] ${message}`)
    this.name = 'NanoleafError'
    this.key = key
  }
}
