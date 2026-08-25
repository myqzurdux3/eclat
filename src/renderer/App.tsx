import { useEffect, useState } from 'react'
import type { NanoleafApi, RendererDevice } from '../shared/ipc-contract'
import type { DeviceState, PanelLayout } from '../shared/types'

declare global {
  interface Window {
    /**
     * Injecté par le preload d'Electron. Absent quand la page est ouverte
     * directement dans un navigateur : le serveur Vite ne sert que le
     * renderer, il n'apporte aucun pont IPC.
     */
    nanoleaf?: NanoleafApi
  }
}

/** Affiché quand la page tourne hors d'Electron, sans pont IPC. */
function MissingBridge() {
  return (
    <main style={{ padding: 24, display: 'grid', gap: 16, maxWidth: 620 }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Nanoleaf — pont IPC absent</h1>
      <p style={{ margin: 0, lineHeight: 1.5 }}>
        Cette page est servie par Vite, qui ne fournit que l&apos;interface. Le dialogue
        avec les panneaux passe par le processus main d&apos;Electron : le token
        d&apos;authentification ne doit jamais atteindre le navigateur.
      </p>
      <p style={{ margin: 0, lineHeight: 1.5 }}>
        Lance l&apos;application dans Electron, en gardant ce serveur actif :
      </p>
      <pre
        style={{
          margin: 0,
          padding: 12,
          background: '#17171c',
          borderRadius: 6,
          overflowX: 'auto',
        }}
      >
        VITE_DEV_SERVER_URL=http://localhost:5173 npm run start
      </pre>
    </main>
  )
}

/** Teinte [0,1] vers RGB saturé, pour la démonstration de balayage. */
function hueToRgb(hue: number): { r: number; g: number; b: number } {
  const sector = (((hue % 1) + 1) % 1) * 6
  const rising = Math.round((sector % 1) * 255)
  switch (Math.floor(sector)) {
    case 0:
      return { r: 255, g: rising, b: 0 }
    case 1:
      return { r: 255 - rising, g: 255, b: 0 }
    case 2:
      return { r: 0, g: 255, b: rising }
    case 3:
      return { r: 0, g: 255 - rising, b: 255 }
    case 4:
      return { r: rising, g: 0, b: 255 }
    default:
      return { r: 255, g: 0, b: 255 - rising }
  }
}

export function App() {
  const [devices, setDevices] = useState<RendererDevice[]>([])
  const [state, setState] = useState<DeviceState | null>(null)
  const [layout, setLayout] = useState<PanelLayout | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)

  const bridge = typeof window === 'undefined' ? undefined : window.nanoleaf
  const active = devices.find((d) => d.paired) ?? devices[0]

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (bridge === undefined) return
    void run(async () => setDevices(await bridge.listDevices()))
  }, [bridge])

  useEffect(() => {
    if (bridge === undefined || !streaming || active === undefined || layout === null) return

    const count = layout.panels.length
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const phase = (Date.now() - startedAt) / 4000
      const colors = Array.from({ length: count }, (_, index) =>
        hueToRgb(phase + index / count),
      )
      void bridge.sendFrame(active.id, 'screen', colors)
    }, 40)

    return () => clearInterval(timer)
  }, [bridge, streaming, active, layout])

  if (bridge === undefined) return <MissingBridge />

  return (
    <main style={{ padding: 24, display: 'grid', gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Nanoleaf — socle device</h1>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          disabled={busy}
          onClick={() => void run(async () => setDevices(await bridge.discover()))}
        >
          Découvrir
        </button>
        <button
          disabled={busy || active === undefined || active.paired}
          onClick={() =>
            void run(async () => {
              await bridge.pair(active!.id)
              setDevices(await bridge.listDevices())
            })
          }
        >
          Appairer (maintiens le bouton power 5-7 s)
        </button>
        <button
          disabled={busy || active === undefined || !active.paired}
          onClick={() =>
            void run(async () => {
              setState(await bridge.getState(active!.id))
              setLayout(await bridge.getLayout(active!.id))
            })
          }
        >
          Lire l'état
        </button>
        <button
          disabled={busy || state === null}
          onClick={() =>
            void run(async () => {
              await bridge.setOn(active!.id, !state!.on)
              setState(await bridge.getState(active!.id))
            })
          }
        >
          Basculer on/off
        </button>
        <button
          disabled={busy || streaming || active === undefined || !active.paired}
          onClick={() =>
            void run(async () => {
              setLayout(await bridge.getLayout(active!.id))
              await bridge.startStream(active!.id, 'screen')
              setStreaming(true)
            })
          }
        >
          Démarrer le balayage
        </button>
        <button
          disabled={busy || !streaming}
          onClick={() =>
            void run(async () => {
              setStreaming(false)
              await bridge.stopStream(active!.id, 'screen')
            })
          }
        >
          Arrêter le balayage
        </button>
      </div>

      {error !== null && <p style={{ color: '#ff6b6b' }}>{error}</p>}

      <ul>
        {devices.map((device) => (
          <li key={device.id}>
            {device.name} — {device.ip}:{device.port} — {device.paired ? 'appairé' : 'non appairé'}
          </li>
        ))}
      </ul>

      {state !== null && <pre>{JSON.stringify(state, null, 2)}</pre>}
      {layout !== null && <p>{layout.panels.length} panneaux, aspect {layout.aspect.toFixed(2)}</p>}
    </main>
  )
}
