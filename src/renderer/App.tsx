import { useEffect, useMemo, useRef, useState } from 'react'
import type { NanoleafApi } from '../shared/ipc-contract'
import { ControlScreen } from './screens/ControlScreen'
import { ScenesScreen } from './screens/ScenesScreen'
import { SyncScreen } from './screens/SyncScreen'
import { AudioScreen } from './screens/AudioScreen'
import { useAudioSync } from './useAudioSync'
import { useScreenSync } from './useScreenSync'
import { LocaleProvider, useLocale, useT } from './i18n'
import { LOCALES, type MessageKey } from '../shared/i18n'
import { useNanoleaf } from './useNanoleaf'
import { readText, writeText } from './storage'

declare global {
  interface Window {
    /**
     * Injected by Electron's preload. Absent when the page is opened
     * directly in a browser: the Vite server only serves the renderer and
     * brings no IPC bridge.
     */
    nanoleaf?: NanoleafApi
  }
}

/** Shown when the page runs outside Electron, with no IPC bridge. */
function MissingBridge() {
  const t = useT()

  return (
    <main style={{ padding: 24, display: 'grid', gap: 16, maxWidth: 620 }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>{t('bridge.missing.title')}</h1>
      <p style={{ margin: 0, lineHeight: 1.5 }}>{t('bridge.missing.body')}</p>
      <pre style={{ margin: 0, padding: 12, background: '#17171c', borderRadius: 6 }}>
        VITE_DEV_SERVER_URL=http://localhost:5173 npm run start
      </pre>
    </main>
  )
}

/** The locale switch, in the title bar. */
function LocaleSwitch() {
  const { locale, setLocale, t } = useLocale()

  return (
    <div className="segments locales" role="group" aria-label={t('app.language')}>
      {LOCALES.map(({ value, label }) => (
        <button
          key={value}
          aria-pressed={locale === value}
          onClick={() => setLocale(value)}
          title={label}
        >
          {value.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

type Tab = 'controle' | 'scenes' | 'sync' | 'audio'

const TABS: Array<{ value: Tab; key: MessageKey }> = [
  { value: 'controle', key: 'app.tab.control' },
  { value: 'scenes', key: 'app.tab.scenes' },
  { value: 'sync', key: 'app.tab.sync' },
  { value: 'audio', key: 'app.tab.audio' },
]

const TAB_KEY = 'eclat.tab'

/** The application reopens on the tab it was left on. */
function readTab(): Tab {
  const raw = readText(TAB_KEY)
  return TABS.some((tab) => tab.value === raw) ? (raw as Tab) : 'controle'
}

/** The `.drift` transition in the stylesheet. One swap per fade, no more. */
const DRIFT_FADE_MS = 1600

function Shell({ bridge }: { bridge: NanoleafApi }) {
  const t = useT()
  const session = useNanoleaf(bridge)
  // One sync feeds every paired wall at once: a single capture, one
  // pipeline per geometry.
  const walls = useMemo(
    () => [...session.layouts].map(([deviceId, layout]) => ({ deviceId, layout })),
    [session.layouts],
  )

  // Each sync names itself: the arbiter ranks by source, and two syncs
  // claiming to be the same one release each other's stream.
  const sync = useScreenSync(walls, (byDevice) => session.pushColors('screen', byDevice))
  const audio = useAudioSync(bridge, walls, (byDevice) =>
    session.pushColors('audio', byDevice),
  )
  const [screen, setScreen] = useState<Tab>(readTab)

  const chooseTab = (value: Tab): void => {
    setScreen(value)
    writeText(TAB_KEY, value)
  }

  // During a sync, the wall shows what is actually sent to the panels.
  const wallColours =
    (session.device === undefined
      ? undefined
      : (sync.colors?.get(session.device.id) ?? audio.colors?.get(session.device.id))) ??
    session.colors

  /** The background drifts towards the mean of the colours on the wall. */
  const drift = useMemo(() => {
    const laid = [...wallColours.values()]
    if (laid.length === 0) return 'radial-gradient(circle at 30% 30%, #16161c, #0a0a0c)'
    const total = laid.reduce(
      (total, color) => ({ r: total.r + color.r, g: total.g + color.g, b: total.b + color.b }),
      { r: 0, g: 0, b: 0 },
    )
    const n = laid.length
    const tint = `rgb(${Math.round(total.r / n)}, ${Math.round(total.g / n)}, ${Math.round(total.b / n)})`
    return `radial-gradient(circle at 30% 30%, ${tint}, #0a0a0c)`
  }, [wallColours])

  /**
   * Cross-fade: the outgoing layer keeps its background, only opacity moves.
   *
   * The swap is rationed. `drift` is recomputed from a fresh colour map on
   * every sync frame — twenty-five times a second — while the fade itself
   * takes 1.6 s. Swapping on each one restarted the transition some forty
   * times before it could finish, so both layers sat at half opacity and the
   * tint jumped instead of drifting. One swap per fade is what a fade is.
   */
  const [layers, setLayers] = useState<[string, string]>([drift, drift])
  const [visibleLayer, setVisibleLayer] = useState(0)
  const driftRef = useRef(drift)
  driftRef.current = drift

  useEffect(() => {
    const swap = (): void => {
      setVisibleLayer((visible) => {
        const next = visible === 0 ? 1 : 0
        setLayers((previous) => {
          if (previous[next] === driftRef.current) return previous
          const copy: [string, string] = [...previous]
          copy[next] = driftRef.current
          return copy
        })
        return next
      })
    }

    const timer = setInterval(swap, DRIFT_FADE_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <>
      {layers.map((background, index) => (
        <div
          key={index}
          className="drift"
          data-visible={index === visibleLayer}
          style={{ background }}
        />
      ))}
      <div className="shell">
        <header className="titlebar">
          <nav className="tabs">
            {TABS.map(({ value, key: messageKey }) => (
              <button
                key={value}
                aria-selected={screen === value}
                onClick={() => chooseTab(value)}
              >
                {t(messageKey)}
              </button>
            ))}
          </nav>
          <div className="window-controls">
            <LocaleSwitch />
            <button title={t('app.window.minimise')} onClick={() => void bridge.minimizeWindow()}>
              –
            </button>
            <button title={t('app.window.close')} onClick={() => void bridge.closeWindow()}>
              ×
            </button>
          </div>
        </header>

        {screen === 'controle' && <ControlScreen session={session} colors={wallColours} />}
        {screen === 'scenes' && <ScenesScreen session={session} />}
        {screen === 'sync' && (
          <SyncScreen session={session} sync={sync} stopOther={audio.stop} />
        )}
        {screen === 'audio' && (
          <AudioScreen session={session} audio={audio} stopOther={sync.stop} />
        )}
      </div>
    </>
  )
}

function Root() {
  const bridge = typeof window === 'undefined' ? undefined : window.nanoleaf
  if (bridge === undefined) return <MissingBridge />
  return <Shell bridge={bridge} />
}

export function App() {
  return (
    <LocaleProvider>
      <Root />
    </LocaleProvider>
  )
}
