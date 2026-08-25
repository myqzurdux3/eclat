/// <reference lib="webworker" />
import { SyncPipeline } from '../../shared/sync/pipeline'
import { clampSettings, type SyncSettings } from '../../shared/sync/settings'
import type { Color, PanelLayout } from '../../shared/types'

/** Analysis size imposed by the spec: 2304 pixels, resized by the GPU. */
const LARGEUR = 64
const HAUTEUR = 36
/** One preview frame in four is enough for the eye and lightens the channel. */
const PERIODE_APERCU = 4

export interface StartMessage {
  type: 'start'
  /**
   * A stream of `VideoFrame`s, produced on the main thread by
   * `MediaStreamTrackProcessor` and transferred here.
   *
   * The track itself is not transferable in this build of Chromium —
   * `postMessage` refused with "Value at index 0 does not have a
   * transferable type". Streams, by contrast, have been for a long time.
   */
  readable: ReadableStream<VideoFrame>
  /** One wall per device: each has its own geometry, hence its own pipeline. */
  targets: Array<{ deviceId: string; layout: PanelLayout }>
  settings: SyncSettings
}

export type ToWorker =
  | StartMessage
  | { type: 'settings'; settings: SyncSettings }
  | { type: 'stop' }

export type FromWorker =
  | { type: 'colors'; colors: Record<string, Color[]> }
  | { type: 'preview'; width: number; height: number; data: ArrayBuffer }
  | { type: 'error'; message: string }
  | { type: 'ended' }

const canvas = new OffscreenCanvas(LARGEUR, HAUTEUR)
const context = canvas.getContext('2d', { willReadFrequently: true })

const pipelines = new Map<string, SyncPipeline>()
let reglages: SyncSettings | null = null
let arret = false

/**
 * Consumes the video track frame by frame.
 *
 * Each `VideoFrame` is drawn scaled down: the GPU does the resizing, and the
 * analysis only covers 2304 pixels. The frame is closed immediately —
 * holding several open stalls the decoder.
 */
async function boucle(readable: ReadableStream<VideoFrame>): Promise<void> {
  if (context === null) {
    envoyer({ type: 'error', message: '2D context unavailable in the Worker' })
    return
  }

  const reader = readable.getReader()

  let compteur = 0
  let dernierEnvoi = 0

  while (!arret) {
    const { done, value: frame } = await reader.read()
    if (done || frame === undefined) break

    try {
      // The rate is capped by the settings: no point analysing faster than
      // the panels can display.
      const intervalle = 1000 / (reglages?.hz ?? 25)
      const maintenant = performance.now()
      if (maintenant - dernierEnvoi < intervalle) continue
      dernierEnvoi = maintenant

      context.drawImage(frame as unknown as CanvasImageSource, 0, 0, LARGEUR, HAUTEUR)
      const image = context.getImageData(0, 0, LARGEUR, HAUTEUR)

      const colors: Record<string, Color[]> = {}
      for (const [deviceId, pipeline] of pipelines) {
        const couleurs = pipeline.process(image)
        if (couleurs.length > 0) colors[deviceId] = couleurs
      }
      if (Object.keys(colors).length > 0) envoyer({ type: 'colors', colors })

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

function envoyer(message: FromWorker, transfer: Transferable[] = []): void {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(message, transfer)
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data

  if (message.type === 'start') {
    reglages = clampSettings(message.settings)
    pipelines.clear()
    for (const cible of message.targets) {
      pipelines.set(cible.deviceId, new SyncPipeline(cible.layout, reglages))
    }
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
    for (const pipeline of pipelines.values()) pipeline.update(reglages)
    return
  }

  if (message.type === 'stop') {
    arret = true
    for (const pipeline of pipelines.values()) pipeline.reset()
  }
}
