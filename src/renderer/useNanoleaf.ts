import { useCallback, useEffect, useState } from 'react'
import type { NanoleafApi, RendererDevice } from '../shared/ipc-contract'
import type { Color, DeviceState, EffectPalette, PanelLayout } from '../shared/types'

export interface NanoleafSession {
  device: RendererDevice | undefined
  state: DeviceState | null
  layout: PanelLayout | null
  palettes: EffectPalette[]
  colors: Map<number, Color>
  busy: boolean
  error: string | null
  discover: () => void
  pair: () => void
  refresh: () => void
  setOn: (on: boolean) => void
  setBrightness: (value: number) => void
  setColor: (hue: number, sat: number) => void
  paint: (panelId: number, color: Color) => void
  selectEffect: (name: string) => void
}

/**
 * Rassemble l'état du device côté renderer. Les couleurs peintes sont tenues
 * ici pour que le canvas les rende sans aller-retour IPC supplémentaire.
 */
export function useNanoleaf(bridge: NanoleafApi): NanoleafSession {
  const [devices, setDevices] = useState<RendererDevice[]>([])
  const [state, setState] = useState<DeviceState | null>(null)
  const [layout, setLayout] = useState<PanelLayout | null>(null)
  const [palettes, setPalettes] = useState<EffectPalette[]>([])
  const [colors, setColors] = useState<Map<number, Color>>(new Map())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const device = devices.find((entry) => entry.paired) ?? devices[0]

  const run = useCallback((fn: () => Promise<void>): void => {
    setBusy(true)
    setError(null)
    void fn()
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }, [])

  const load = useCallback(
    (id: string): void => {
      run(async () => {
        setState(await bridge.getState(id))
        setLayout(await bridge.getLayout(id))
        setPalettes(await bridge.getEffectPalettes(id))
      })
    },
    [bridge, run],
  )

  useEffect(() => {
    run(async () => setDevices(await bridge.listDevices()))
  }, [bridge, run])

  useEffect(() => {
    if (device?.paired === true) load(device.id)
  }, [device?.id, device?.paired, load])

  return {
    device,
    state,
    layout,
    palettes,
    colors,
    busy,
    error,
    discover: () => run(async () => setDevices(await bridge.discover())),
    pair: () =>
      run(async () => {
        if (device === undefined) return
        await bridge.pair(device.id)
        setDevices(await bridge.listDevices())
      }),
    refresh: () => {
      if (device !== undefined) load(device.id)
    },
    setOn: (on) =>
      run(async () => {
        if (device === undefined) return
        await bridge.setOn(device.id, on)
        setState(await bridge.getState(device.id))
      }),
    setBrightness: (value) =>
      run(async () => {
        if (device === undefined) return
        await bridge.setBrightness(device.id, value)
        setState((previous) => (previous === null ? previous : { ...previous, brightness: value }))
      }),
    setColor: (hue, sat) =>
      run(async () => {
        if (device === undefined) return
        await bridge.setColor(device.id, hue, sat)
        setState((previous) => (previous === null ? previous : { ...previous, hue, sat }))
      }),
    paint: (panelId, color) =>
      run(async () => {
        if (device === undefined) return
        await bridge.paintPanel(device.id, panelId, color)
        setColors((previous) => new Map(previous).set(panelId, color))
      }),
    selectEffect: (name) =>
      run(async () => {
        if (device === undefined) return
        await bridge.selectEffect(device.id, name)
        setColors(new Map())
        setState(await bridge.getState(device.id))
      }),
  }
}
