import { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioSourceInfo, NanoleafApi } from '../shared/ipc-contract'
import { DEFAULT_AUDIO_SETTINGS, toMode, type AudioSettings } from '../shared/audio/palette'
import { AudioPainter } from '../shared/audio/painter'
import type { AudioFeatures } from '../shared/audio/analyser'
import type { Color, PanelLayout } from '../shared/types'
import { readJson, writeJson } from './storage'
import { reasonFor } from '../shared/i18n/errors'

const SETTINGS_KEY = 'eclat.audio'
const SOURCE_KEY = 'eclat.audio.source'

export interface AudioSyncTarget {
  deviceId: string
  layout: PanelLayout
}

export interface AudioSync {
  active: boolean
  sources: AudioSourceInfo[]
  sourceId: number | null
  features: AudioFeatures | null
  colors: Map<string, Map<number, Color>> | null
  settings: AudioSettings
  error: string | null
  refreshSources: () => void
  selectSource: (id: number) => void
  setSettings: (partial: Partial<AudioSettings>) => void
  start: () => void
  stop: () => void
}

function readSettings(): AudioSettings {
  const stored = { ...DEFAULT_AUDIO_SETTINGS, ...(readJson(SETTINGS_KEY, {}) as object) }
  // A mode saved by an older version, or edited by hand, means nothing.
  return { ...stored, mode: toMode(stored.mode) }
}

/**
 * The output chosen last time, if it is still the same one.
 *
 * `Number(null)` is 0, so an empty slot used to read as node 0 — a fresh
 * install started with a source nobody picked and a Start button already
 * enabled. And a PipeWire node id is only good for one session: the name is
 * stored beside it and checked against what PipeWire reports now.
 */
function readSource(): { id: number; name: string } | null {
  const stored = readJson(SOURCE_KEY, null)
  if (typeof stored !== 'object' || stored === null) return null
  const { id, name } = stored as { id?: unknown; name?: unknown }
  if (!Number.isInteger(id) || typeof name !== 'string') return null
  return { id: id as number, name }
}

/**
 * Drives audio capture and turns the analysed features into panel colours.
 *
 * The analysis runs in the main process, next to the recorder; only the
 * features cross the IPC boundary, five numbers at a time. Sending raw PCM
 * would move roughly 192 kB a second for no gain.
 */
export function useAudioSync(
  bridge: NanoleafApi,
  targets: AudioSyncTarget[],
  onColors: (byDevice: Record<string, Color[]>) => void,
): AudioSync {
  const [active, setActive] = useState(false)
  const [sources, setSources] = useState<AudioSourceInfo[]>([])
  const [remembered, setRemembered] = useState(readSource)
  const [chosen, setChosen] = useState<number | null>(null)

  /**
   * The node the capture will read.
   *
   * A remembered id is only honoured while PipeWire still reports a source
   * of that name: node ids are handed out afresh every session, so the id
   * alone would eventually point at something else entirely.
   */
  const sourceId =
    chosen ??
    (remembered === null
      ? null
      : (sources.find((entry) => entry.name === remembered.name)?.id ?? null))
  const [features, setFeatures] = useState<AudioFeatures | null>(null)
  const [colors, setColors] = useState<Map<string, Map<number, Color>> | null>(null)
  const [settings, setSettingsState] = useState<AudioSettings>(readSettings)
  const [error, setError] = useState<string | null>(null)

  const targetsRef = useRef(targets)
  targetsRef.current = targets
  const onColorsRef = useRef(onColors)
  onColorsRef.current = onColors
  /**
   * One painter per wall.
   *
   * A painter carries the memory a mode needs between blocks, and two walls
   * of different sizes fill their meters at different places: sharing one
   * would have each overwrite the other's peak, every block.
   */
  const painters = useRef(new Map<string, AudioPainter>())
  const painterFor = (deviceId: string): AudioPainter => {
    let painter = painters.current.get(deviceId)
    if (painter === undefined) {
      painter = new AudioPainter()
      painters.current.set(deviceId, painter)
    }
    return painter
  }

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const activeRef = useRef(active)
  activeRef.current = active

  const refreshSources = useCallback(() => {
    void bridge
      .listAudioSources()
      .then(setSources)
      .catch((cause: unknown) => setError(reasonFor(cause)))
  }, [bridge])

  useEffect(() => {
    refreshSources()
  }, [refreshSources])

  useEffect(() => {
    return bridge.onAudioFeatures((next) => {
      if (!activeRef.current) return
      setFeatures(next)

      const byDevice: Record<string, Color[]> = {}
      const rendered = new Map<string, Map<number, Color>>()

      for (const target of targetsRef.current) {
        const panelColors = painterFor(target.deviceId).paint(
          next,
          target.layout,
          settingsRef.current,
        )
        byDevice[target.deviceId] = panelColors
        rendered.set(
          target.deviceId,
          new Map(
            target.layout.panels.map((panel, index) => [
              panel.panelId,
              panelColors[index] ?? { r: 0, g: 0, b: 0 },
            ]),
          ),
        )
      }

      onColorsRef.current(byDevice)
      setColors(rendered)
    })
  }, [bridge])

  return {
    active,
    sources,
    sourceId,
    features,
    colors,
    settings,
    error,
    refreshSources,

    selectSource: (id) => {
      setChosen(id)
      const name = sources.find((entry) => entry.id === id)?.name
      if (name !== undefined) {
        setRemembered({ id, name })
        writeJson(SOURCE_KEY, { id, name })
      }
    },

    setSettings: (partial) => {
      setSettingsState((previous) => {
        const next = { ...previous, ...partial }
        writeJson(SETTINGS_KEY, next)
        return next
      })
    },

    start: () => {
      if (sourceId === null) return
      for (const painter of painters.current.values()) painter.reset()
      setError(null)
      void bridge
        .startAudioCapture(sourceId)
        .then(() => setActive(true))
        .catch((cause: unknown) => setError(reasonFor(cause)))
    },

    stop: () => {
      setActive(false)
      setColors(null)
      setFeatures(null)
      void bridge.stopAudioCapture().catch(() => undefined)
    },
  }
}
