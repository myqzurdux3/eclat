import { useEffect, useState } from 'react'
import type { NanoleafApi, RendererDevice } from '../shared/ipc-contract'
import type { DeviceState, PanelLayout } from '../shared/types'

declare global {
  interface Window {
    nanoleaf: NanoleafApi
  }
}

export function App() {
  const [devices, setDevices] = useState<RendererDevice[]>([])
  const [state, setState] = useState<DeviceState | null>(null)
  const [layout, setLayout] = useState<PanelLayout | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
