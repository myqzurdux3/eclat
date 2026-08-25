import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clampSettings,
  DEFAULT_SYNC_SETTINGS,
  type SyncSettings,
} from '../shared/sync/settings'
import type { DepuisWorker, VersWorker } from './worker/capture.worker'
import type { Color, PanelLayout } from '../shared/types'

export interface SyncTarget {
  deviceId: string
  layout: PanelLayout
}

const CLE_REGLAGES = 'nanoleaf.sync'

/**
 * `MediaStreamTrackProcessor` n'est pas dans la lib DOM de TypeScript : c'est
 * une API Chromium (WebCodecs). On déclare le strict nécessaire.
 */
declare class MediaStreamTrackProcessor<T> {
  constructor(init: { track: MediaStreamTrack })
  readonly readable: ReadableStream<T>
}

/**
 * Ouvre le flux de frames d'une piste vidéo.
 *
 * Le processeur est construit ici, sur le thread principal, et c'est son
 * `ReadableStream` qui part au Worker : une `MediaStreamTrack` n'est pas
 * transférable dans cette version de Chromium, alors qu'un flux l'est.
 */
function ouvrirFlux(piste: MediaStreamTrack): ReadableStream<VideoFrame> {
  if (typeof MediaStreamTrackProcessor === 'undefined') {
    throw new Error(
      "MediaStreamTrackProcessor est indisponible : cette version de Chromium ne peut pas lire la capture image par image.",
    )
  }
  return new MediaStreamTrackProcessor<VideoFrame>({ track: piste }).readable
}

export interface Apercu {
  width: number
  height: number
  data: Uint8ClampedArray<ArrayBuffer>
}

export interface ScreenSync {
  actif: boolean
  demarrage: boolean
  settings: SyncSettings
  /** Dernières couleurs envoyées, par device. */
  colors: Map<string, Map<number, Color>> | null
  apercu: Apercu | null
  error: string | null
  setSettings: (partial: Partial<SyncSettings>) => void
  start: () => void
  stop: () => void
}

function lireReglages(): SyncSettings {
  try {
    const brut = localStorage.getItem(CLE_REGLAGES)
    return brut === null ? DEFAULT_SYNC_SETTINGS : clampSettings(JSON.parse(brut))
  } catch {
    return DEFAULT_SYNC_SETTINGS
  }
}

/**
 * Pilote la capture d'écran et le Worker d'analyse.
 *
 * Le flux est gardé vivant tant que l'application tourne : le jeton de
 * restauration du portail xdg-desktop-portal n'étant pas exposé par
 * Electron, redemander la source rouvrirait le sélecteur GNOME à chaque
 * bascule. Arrêter le sync coupe donc l'analyse, pas la capture.
 */
export function useScreenSync(
  targets: SyncTarget[],
  onColors: (byDevice: Record<string, Color[]>) => void,
): ScreenSync {
  const [actif, setActif] = useState(false)
  const [demarrage, setDemarrage] = useState(false)
  const [settings, setSettingsState] = useState<SyncSettings>(lireReglages)
  const [colors, setColors] = useState<Map<string, Map<number, Color>> | null>(null)
  const [apercu, setApercu] = useState<Apercu | null>(null)
  const [error, setError] = useState<string | null>(null)

  const workerRef = useRef<Worker | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const targetsRef = useRef(targets)
  targetsRef.current = targets
  const onColorsRef = useRef(onColors)
  onColorsRef.current = onColors

  const poster = (message: VersWorker, transfer: Transferable[] = []): void => {
    workerRef.current?.postMessage(message, transfer)
  }

  const stop = useCallback(() => {
    poster({ type: 'stop' })
    setActif(false)
    setColors(null)
  }, [])

  const start = useCallback(() => {
    const cibles = targetsRef.current
    if (cibles.length === 0 || streamRef.current !== null) {
      if (streamRef.current !== null && cibles.length > 0) {
        // La capture est déjà ouverte : on relance seulement l'analyse.
        const piste = streamRef.current.getVideoTracks()[0]
        if (piste !== undefined) {
          try {
            const readable = ouvrirFlux(piste)
            poster({ type: 'start', readable, targets: cibles, settings }, [readable])
            setActif(true)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
          }
        }
      }
      return
    }

    setDemarrage(true)
    setError(null)

    void navigator.mediaDevices
      .getDisplayMedia({ video: true, audio: false })
      .then((stream) => {
        streamRef.current = stream
        const piste = stream.getVideoTracks()[0]
        if (piste === undefined) throw new Error('Aucune piste vidéo dans le flux')

        // L'utilisateur peut couper le partage depuis le panneau GNOME.
        piste.addEventListener('ended', () => {
          streamRef.current = null
          setActif(false)
          setColors(null)
        })

        const readable = ouvrirFlux(piste)
        poster({ type: 'start', readable, targets: cibles, settings }, [readable])
        setActif(true)
      })
      .catch((cause: unknown) => {
        // Le sélecteur GNOME annulé remonte ici : ce n'est pas une panne.
        const message = cause instanceof Error ? cause.message : String(cause)
        setError(message.includes('Permission denied') ? null : message)
      })
      .finally(() => setDemarrage(false))
  }, [settings])

  const setSettings = useCallback((partial: Partial<SyncSettings>) => {
    setSettingsState((precedent) => {
      const suivant = clampSettings({ ...precedent, ...partial })
      try {
        localStorage.setItem(CLE_REGLAGES, JSON.stringify(suivant))
      } catch {
        // Stockage indisponible : les réglages valent pour cette session.
      }
      workerRef.current?.postMessage({ type: 'settings', settings: suivant })
      return suivant
    })
  }, [])

  useEffect(() => {
    const worker = new Worker(new URL('./worker/capture.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<DepuisWorker>) => {
      const message = event.data

      if (message.type === 'colors') {
        onColorsRef.current(message.colors)
        setColors(
          new Map(
            targetsRef.current.map((cible) => [
              cible.deviceId,
              new Map(
                cible.layout.panels.map((panel, index) => [
                  panel.panelId,
                  message.colors[cible.deviceId]?.[index] ?? { r: 0, g: 0, b: 0 },
                ]),
              ),
            ]),
          ),
        )
        return
      }

      if (message.type === 'preview') {
        setApercu({
          width: message.width,
          height: message.height,
          data: new Uint8ClampedArray(message.data),
        })
        return
      }

      if (message.type === 'error') setError(message.message)
      if (message.type === 'ended') setActif(false)
    }

    return () => {
      worker.postMessage({ type: 'stop' })
      worker.terminate()
      workerRef.current = null
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  return { actif, demarrage, settings, colors, apercu, error, setSettings, start, stop }
}
