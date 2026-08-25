/// <reference lib="webworker" />
import { SyncPipeline } from '../../shared/sync/pipeline'
import { clampSettings, type SyncSettings } from '../../shared/sync/settings'
import type { Color, PanelLayout } from '../../shared/types'

/** Taille d'analyse imposée par la spec : 2304 pixels, redimensionnés par le GPU. */
const LARGEUR = 64
const HAUTEUR = 36
/** Une frame d'aperçu sur quatre suffit à l'œil et allège le canal. */
const PERIODE_APERCU = 4

export interface DemarrerMessage {
  type: 'start'
  /**
   * Flux de `VideoFrame`, produit sur le thread principal par
   * `MediaStreamTrackProcessor` et transféré ici.
   *
   * La piste elle-même n'est pas transférable dans cette version de
   * Chromium — `postMessage` refusait « Value at index 0 does not have a
   * transferable type ». Les flux, eux, le sont depuis longtemps.
   */
  readable: ReadableStream<VideoFrame>
  layout: PanelLayout
  settings: SyncSettings
}

export type VersWorker =
  | DemarrerMessage
  | { type: 'settings'; settings: SyncSettings }
  | { type: 'stop' }

export type DepuisWorker =
  | { type: 'colors'; colors: Color[] }
  | { type: 'preview'; width: number; height: number; data: ArrayBuffer }
  | { type: 'error'; message: string }
  | { type: 'ended' }

const canvas = new OffscreenCanvas(LARGEUR, HAUTEUR)
const context = canvas.getContext('2d', { willReadFrequently: true })

let pipeline: SyncPipeline | null = null
let reglages: SyncSettings | null = null
let arret = false

/**
 * Consomme la piste vidéo image par image.
 *
 * Chaque `VideoFrame` est dessinée réduite : le redimensionnement est fait
 * par le GPU, et l'analyse ne porte que sur 2304 pixels. La frame est
 * refermée aussitôt — en garder plusieurs ouvertes bloque le décodeur.
 */
async function boucle(readable: ReadableStream<VideoFrame>): Promise<void> {
  if (context === null) {
    envoyer({ type: 'error', message: 'Contexte 2D indisponible dans le Worker' })
    return
  }

  const reader = readable.getReader()

  let compteur = 0
  let dernierEnvoi = 0

  while (!arret) {
    const { done, value: frame } = await reader.read()
    if (done || frame === undefined) break

    try {
      // Cadence plafonnée par les réglages : inutile d'analyser plus vite
      // que ce que les panneaux peuvent afficher.
      const intervalle = 1000 / (reglages?.hz ?? 25)
      const maintenant = performance.now()
      if (maintenant - dernierEnvoi < intervalle) continue
      dernierEnvoi = maintenant

      context.drawImage(frame as unknown as CanvasImageSource, 0, 0, LARGEUR, HAUTEUR)
      const image = context.getImageData(0, 0, LARGEUR, HAUTEUR)

      const colors = pipeline?.process(image) ?? []
      if (colors.length > 0) envoyer({ type: 'colors', colors })

      compteur += 1
      if (compteur % PERIODE_APERCU === 0) {
        const copie = image.data.slice().buffer
        envoyer({ type: 'preview', width: LARGEUR, height: HAUTEUR, data: copie }, [copie])
      }
    } finally {
      frame.close()
    }
  }

  reader.cancel().catch(() => undefined)
  envoyer({ type: 'ended' })
}

function envoyer(message: DepuisWorker, transfer: Transferable[] = []): void {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(message, transfer)
}

self.onmessage = (event: MessageEvent<VersWorker>) => {
  const message = event.data

  if (message.type === 'start') {
    reglages = clampSettings(message.settings)
    pipeline = new SyncPipeline(message.layout, reglages)
    arret = false
    boucle(message.readable).catch((cause: unknown) => {
      envoyer({
        type: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
      })
    })
    return
  }

  if (message.type === 'settings') {
    reglages = clampSettings(message.settings)
    pipeline?.update(reglages)
    return
  }

  if (message.type === 'stop') {
    arret = true
    pipeline?.reset()
  }
}
