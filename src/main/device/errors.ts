import type { MessageKey } from '../../shared/i18n'

/**
 * Error keys meant for the user, as opposed to purely diagnostic messages.
 */
export type ErrorKey = Extract<MessageKey, `error.${string}`>

/**
 * An error returned by the Nanoleaf controller, carrying the HTTP status.
 *
 * When the error is worth showing to the user, its translation key is
 * encoded between brackets at the head of the message. Electron flattens
 * `Error` objects crossing the IPC boundary — only the message survives — so
 * slipping the key in there is the only way to get it to the renderer.
 */
export class NanoleafError extends Error {
  readonly key: ErrorKey | undefined

  constructor(message: string, readonly status: number, key?: ErrorKey) {
    super(key === undefined ? message : `[${key}] ${message}`)
    this.name = 'NanoleafError'
    this.key = key
  }
}
