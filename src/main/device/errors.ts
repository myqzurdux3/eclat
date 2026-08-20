/** Erreur renvoyée par le contrôleur Nanoleaf, porteuse du code HTTP. */
export class NanoleafError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'NanoleafError'
  }
}
