/// <reference lib="webworker" />
import { SyncPipeline } from '../../shared/sync/pipeline'
import { clampSettings, type SyncSettings } from '../../shared/sync/settings'
import type { Color, PanelLayout } from '../../shared/types'
import { reasonFor } from '../../shared/i18n/errors'

/** Analysis size imposed by the spec: 2304 pixels, resized by the GPU. */
const WIDTH = 64
const HEIGHT = 36
/** One preview frame in four is enough for the eye and lightens the channel. */
const PREVIEW_EVERY = 4

/** One wall being driven: its geometry decides its pipeline. */
export interface SyncTarget {
  deviceId: string
  layout: PanelLayout
}

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
  targets: SyncTarget[]
  settings: SyncSettings
}

export type ToWorker =
  | StartMessage
  | { type: 'settings'; settings: SyncSettings }
  | { type: 'targets'; targets: SyncTarget[] }
  | { type: 'stop' }

export type FromWorker =
  | { type: 'colors'; colors: Record<string, Color[]> }
  | { type: 'preview'; width: number; height: number; data: ArrayBuffer }
  | { type: 'error'; message: string }
  | { type: 'ended' }

const canvas = new OffscreenCanvas(WIDTH, HEIGHT)
const context = canvas.getContext('2d', { willReadFrequently: true })

const pipelines = new Map<string, SyncPipeline>()
let settings: SyncSettings | null = null

/**
 * Which run is allowed to be reading.
 *
 * A single stop flag is not enough: a loop parked in `read()` only tests it
 * once a frame arrives, and on a static screen under Wayland that can be
 * never. A stop followed by a start would clear the flag before the old loop
 * ever woke, leaving two loops on one canvas for good. Each run carries its
 * own number and stops as soon as it is no longer the current one.
 */
let currentRun = 0

/**
 * Consumes the video track frame by frame.
 *
 * Each `VideoFrame` is drawn scaled down: the GPU does the resizing, and the
 * analysis only covers 2304 pixels. The frame is closed immediately —
 * holding several open stalls the decoder.
 */
async function loop(readable: ReadableStream<VideoFrame>, run: number): Promise<void> {
  if (context === null) {
    send({ type: 'error', message: '2D context unavailable in the Worker' })
    return
  }

  const reader = readable.getReader()

  let frames = 0
  let lastSentAt = 0

  while (run === currentRun) {
    const { done, value: frame } = await reader.read()
    if (done || frame === undefined) break
    if (run !== currentRun) {
      frame.close()
      break
    }

    try {
      // The rate is capped by the settings: no point analysing faster than
      // the panels can display.
      const interval = 1000 / (settings?.hz ?? 25)
      const now = performance.now()
      if (now - lastSentAt < interval) continue
      lastSentAt = now

      context.drawImage(frame as unknown as CanvasImageSource, 0, 0, WIDTH, HEIGHT)
      const image = context.getImageData(0, 0, WIDTH, HEIGHT)

      const colors: Record<string, Color[]> = {}
      for (const [deviceId, pipeline] of pipelines) {
        const panelColors = pipeline.process(image)
        if (panelColors.length > 0) colors[deviceId] = panelColors
      }
      if (Object.keys(colors).length > 0) send({ type: 'colors', colors })

      frames += 1
      if (frames % PREVIEW_EVERY === 0) {
        const preview = image.data.slice().buffer
        send({ type: 'preview', width: WIDTH, height: HEIGHT, data: preview }, [preview])
      }
    } finally {
      frame.close()
    }
  }

  reader.cancel().catch(() => undefined)
  send({ type: 'ended' })
}

function send(message: FromWorker, transfer: Transferable[] = []): void {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(message, transfer)
}

/**
 * Brings the pipelines in line with the walls being driven.
 *
 * A pipeline holds smoothing history, so the ones that stay are kept rather
 * than rebuilt: a wall should not flash back to a raw frame because its
 * neighbour was rotated.
 */
function rebuild(targets: SyncTarget[]): void {
  const wanted = new Set(targets.map((target) => target.deviceId))
  for (const deviceId of [...pipelines.keys()]) {
    if (!wanted.has(deviceId)) pipelines.delete(deviceId)
  }

  const current = settings ?? clampSettings({})
  for (const target of targets) {
    pipelines.set(target.deviceId, new SyncPipeline(target.layout, current))
  }
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data

  if (message.type === 'start') {
    settings = clampSettings(message.settings)
    pipelines.clear()
    rebuild(message.targets)

    currentRun += 1
    const run = currentRun
    loop(message.readable, run).catch((cause: unknown) => {
      send({
        type: 'error',
        message: reasonFor(cause),
      })
    })
    return
  }

  if (message.type === 'settings') {
    settings = clampSettings(message.settings)
    for (const pipeline of pipelines.values()) pipeline.update(settings)
    return
  }

  // The walls can change under a running sync: one is rotated, another
  // finishes pairing. Without this the analysis would keep mapping onto the
  // geometry it was handed at the start, and a wall that arrived late would
  // never receive a frame.
  if (message.type === 'targets') {
    rebuild(message.targets)
    return
  }

  if (message.type === 'stop') {
    currentRun += 1
    for (const pipeline of pipelines.values()) pipeline.reset()
  }
}
