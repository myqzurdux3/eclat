import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clampSettings,
  DEFAULT_SYNC_SETTINGS,
  type SyncSettings,
} from '../shared/sync/settings'
import type { FromWorker, ToWorker } from './worker/capture.worker'
import type { Color, PanelLayout } from '../shared/types'
import { readJson, writeJson } from './storage'
import { reasonFor } from '../shared/i18n/errors'

export interface SyncTarget {
  deviceId: string
  layout: PanelLayout
}

const SETTINGS_KEY = 'nanoleaf.sync'

/**
 * `MediaStreamTrackProcessor` is missing from TypeScript's DOM lib: it is a
 * Chromium API (WebCodecs). Only the strict minimum is declared here.
 */
declare class MediaStreamTrackProcessor<T> {
  constructor(init: { track: MediaStreamTrack })
  readonly readable: ReadableStream<T>
}

/**
 * Opens the frame stream of a video track.
 *
 * The processor is built here, on the main thread, and it is its
 * `ReadableStream` that goes to the Worker: a `MediaStreamTrack` is not
 * transferable in this build of Chromium, whereas a stream is.
 */
function openFrameStream(track: MediaStreamTrack): ReadableStream<VideoFrame> {
  if (typeof MediaStreamTrackProcessor === 'undefined') {
    // The key travels inside the message: the renderer translates it the
    // same way it translates errors coming back from the main process.
    throw new Error('[error.processorMissing] MediaStreamTrackProcessor is unavailable.')
  }
  return new MediaStreamTrackProcessor<VideoFrame>({ track }).readable
}

export interface Preview {
  width: number
  height: number
  data: Uint8ClampedArray<ArrayBuffer>
}

export interface ScreenSync {
  active: boolean
  starting: boolean
  settings: SyncSettings
  /** The last colours sent, per device. */
  colors: Map<string, Map<number, Color>> | null
  preview: Preview | null
  error: string | null
  setSettings: (partial: Partial<SyncSettings>) => void
  start: () => void
  stop: () => void
}

function readSettings(): SyncSettings {
  const stored = readJson(SETTINGS_KEY, DEFAULT_SYNC_SETTINGS)
  return clampSettings(stored as Partial<SyncSettings>)
}

/**
 * Drives screen capture and the analysis Worker.
 *
 * The stream is kept alive for as long as the application runs: since
 * Electron does not expose xdg-desktop-portal's restore token, asking for
 * the source again would reopen the GNOME picker on every toggle. Stopping
 * the sync therefore cuts the analysis, not the capture.
 */
export function useScreenSync(
  targets: SyncTarget[],
  onColors: (byDevice: Record<string, Color[]>) => void,
): ScreenSync {
  const [active, setActive] = useState(false)
  const [starting, setStarting] = useState(false)
  const [settings, setSettingsState] = useState<SyncSettings>(readSettings)
  const [colors, setColors] = useState<Map<string, Map<number, Color>> | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const workerRef = useRef<Worker | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const targetsRef = useRef(targets)
  targetsRef.current = targets
  const onColorsRef = useRef(onColors)
  onColorsRef.current = onColors

  const post = (message: ToWorker, transfer: Transferable[] = []): void => {
    workerRef.current?.postMessage(message, transfer)
  }

  const stop = useCallback(() => {
    post({ type: 'stop' })
    setActive(false)
    setColors(null)
  }, [])

  const start = useCallback(() => {
    const walls = targetsRef.current
    if (walls.length === 0 || streamRef.current !== null) {
      if (streamRef.current !== null && walls.length > 0) {
        // Capture is already open: only the analysis is restarted.
        const track = streamRef.current.getVideoTracks()[0]
        if (track !== undefined) {
          try {
            const readable = openFrameStream(track)
            post({ type: 'start', readable, targets: walls, settings }, [readable])
            setActive(true)
          } catch (cause) {
            setError(reasonFor(cause))
          }
        }
      }
      return
    }

    setStarting(true)
    setError(null)

    void navigator.mediaDevices
      .getDisplayMedia({ video: true, audio: false })
      .then((stream) => {
        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        if (track === undefined) throw new Error('No video track in the stream')

        // The user can stop sharing from the GNOME panel.
        track.addEventListener('ended', () => {
          streamRef.current = null
          setActive(false)
          setColors(null)
        })

        const readable = openFrameStream(track)
        post({ type: 'start', readable, targets: walls, settings }, [readable])
        setActive(true)
      })
      .catch((cause: unknown) => {
        // A cancelled GNOME picker surfaces here: that is not a failure.
        const message = reasonFor(cause)
        setError(message.includes('Permission denied') ? null : message)
      })
      .finally(() => setStarting(false))
  }, [settings])

  /**
   * Keeps the worker's geometry in step with the walls.
   *
   * The pipelines used to be frozen at whatever was passed on `start`: a
   * wall rotated mid-sync went on being mapped at its old angle, and one
   * that finished pairing never received a frame at all.
   */
  useEffect(() => {
    if (!active) return
    workerRef.current?.postMessage({ type: 'targets', targets })
  }, [active, targets])

  const setSettings = useCallback((partial: Partial<SyncSettings>) => {
    setSettingsState((previous) => {
      const next = clampSettings({ ...previous, ...partial })
      writeJson(SETTINGS_KEY, next)
      workerRef.current?.postMessage({ type: 'settings', settings: next })
      return next
    })
  }, [])

  useEffect(() => {
    const worker = new Worker(new URL('./worker/capture.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data

      if (message.type === 'colors') {
        onColorsRef.current(message.colors)
        setColors(
          new Map(
            targetsRef.current.map((target) => [
              target.deviceId,
              new Map(
                target.layout.panels.map((panel, index) => [
                  panel.panelId,
                  message.colors[target.deviceId]?.[index] ?? { r: 0, g: 0, b: 0 },
                ]),
              ),
            ]),
          ),
        )
        return
      }

      if (message.type === 'preview') {
        setPreview({
          width: message.width,
          height: message.height,
          data: new Uint8ClampedArray(message.data),
        })
        return
      }

      if (message.type === 'error') setError(message.message)
      if (message.type === 'ended') setActive(false)
    }

    return () => {
      worker.postMessage({ type: 'stop' })
      worker.terminate()
      workerRef.current = null
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  return { active, starting, settings, colors, preview, error, setSettings, start, stop }
}
