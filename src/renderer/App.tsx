import { useEffect, useState } from 'react'
import type { NanoleafApi, RendererDevice } from '../shared/ipc-contract'
import type { DeviceState, PanelLayout } from '../shared/types'

declare global {
  interface Window {
    nanoleaf: NanoleafApi
  }
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
    void run(async () => setDevices(await window.nanoleaf.listDevices()))
  }, [])

  useEffect(() => {
    if (!streaming || active === undefined || layout === null) return

    const count = layout.panels.length
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const phase = (Date.now() - startedAt) / 4000
      const colors = Array.from({ length: count }, (_, index) =>
        hueToRgb(phase + index / count),
      )
      void window.nanoleaf.sendFrame(active.id, 'screen', colors)
    }, 40)

    return () => clearInterval(timer)
  }, [streaming, active, layout])

  return (
    <main style={{ padding: 24, display: 'grid', gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Nanoleaf — socle device</h1>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          disabled={busy}
          onClick={() => void run(async () => setDevices(await window.nanoleaf.discover()))}
        >
          Découvrir
        </button>
        <button
          disabled={busy || active === undefined || active.paired}
          onClick={() =>
            void run(async () => {
              await window.nanoleaf.pair(active!.id)
              setDevices(await window.nanoleaf.listDevices())
            })
          }
        >
          Appairer (maintiens le bouton power 5-7 s)
        </button>
        <button
          disabled={busy || active === undefined || !active.paired}
          onClick={() =>
            void run(async () => {
              setState(await window.nanoleaf.getState(active!.id))
              setLayout(await window.nanoleaf.getLayout(active!.id))
            })
          }
        >
          Lire l'état
        </button>
        <button
          disabled={busy || state === null}
          onClick={() =>
            void run(async () => {
              await window.nanoleaf.setOn(active!.id, !state!.on)
              setState(await window.nanoleaf.getState(active!.id))
            })
          }
        >
          Basculer on/off
        </button>
        <button
          disabled={busy || streaming || active === undefined || !active.paired}
          onClick={() =>
            void run(async () => {
              setLayout(await window.nanoleaf.getLayout(active!.id))
              await window.nanoleaf.startStream(active!.id, 'screen')
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
              await window.nanoleaf.stopStream(active!.id, 'screen')
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
