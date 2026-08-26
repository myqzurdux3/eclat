import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DeviceEventMessage, NanoleafApi, RendererDevice } from '../shared/ipc-contract'
import { createCoalescer } from '../shared/coalesce'
import { hsbToRgb } from '../shared/color'
import { rotateLayout } from '../shared/geometry'
import { isUnlit, nextPaint, toFrameColor } from '../shared/paint'
import { OFF, wallColors } from '../shared/wall-colors'
import type { Color, DeviceState, EffectPalette, PanelLayout } from '../shared/types'

const ROTATION_KEY = 'nanoleaf.rotation'

/** Every wall hangs its own way: orientation is per device. */
const rotationKey = (deviceId: string): string => `${ROTATION_KEY}.${deviceId}`
const ACTIVE_KEY = 'nanoleaf.device'

/** The effect name the device reports while lighting a solid colour. */
export const SOLIDE = '*Solid*'

/** Wall rotation, in clockwise degrees on screen. */
const ROTATION_MAX = 360

export interface NanoleafSession {
  /** Every known device, paired or merely discovered. */
  devices: RendererDevice[]
  device: RendererDevice | undefined
  selectDevice: (deviceId: string) => void
  state: DeviceState | null
  /** Already rotated according to the user's setting. */
  layout: PanelLayout | null
  palettes: EffectPalette[]
  colors: Map<number, Color>
  /** Each paired wall's geometry, already rotated. */
  layouts: Map<string, PanelLayout>
  /** True while the application itself is writing to the panels. */
  live: boolean
  rotation: number
  busy: boolean
  error: string | null
  discover: () => void
  pair: (deviceId?: string) => void
  refresh: () => void
  /** Angle in clockwise degrees, on screen. */
  setRotation: (degrees: number) => void
  setOn: (on: boolean) => void
  setBrightness: (value: number) => void
  setColor: (hue: number, sat: number) => void
  paint: (panelId: number, color: Color) => void
  selectEffect: (name: string) => void
  /** Arms external control for the screen source, on every paired wall. */
  armScreen: () => Promise<void>
  disarmScreen: () => Promise<void>
  /** Broadcasts a frame from the screen sync, device by device. */
  pushColors: (byDevice: Record<string, Color[]>) => void
}

const normaliseAngle = (degres: number): number =>
  ((Math.round(degres) % ROTATION_MAX) + ROTATION_MAX) % ROTATION_MAX

/** The device does not report how the wall hangs: the user decides. */
function readRotation(deviceId: string | undefined): number {
  if (deviceId === undefined) return 0
  try {
    const brut = localStorage.getItem(rotationKey(deviceId))
    return brut === null ? 0 : normaliseAngle(Number(brut))
  } catch {
    return 0
  }
}

/**
 * Gathers the device state on the renderer side. Painted colours are held
 * here so the canvas can draw them with no extra IPC round trip.
 */
export function useNanoleaf(bridge: NanoleafApi): NanoleafSession {
  const [devices, setDevices] = useState<RendererDevice[]>([])
  const [state, setState] = useState<DeviceState | null>(null)
  const [rawLayouts, setRawLayouts] = useState<Record<string, PanelLayout>>({})
  const [palettes, setPalettes] = useState<EffectPalette[]>([])
  const [painted, setPainted] = useState<Map<number, Color>>(new Map())
  /**
   * The panels the user has actually clicked.
   *
   * Distinct from `painted`, which also holds the panels seeded to keep the
   * wall looking like itself: without the distinction the colour wheel would
   * repaint the whole wall instead of the handful of panels chosen.
   */
  const [selection, setSelection] = useState<Set<number>>(new Set())
  const [live, setLive] = useState(false)
  const [rotations, setRotations] = useState<Record<string, number>>({})
  const [chosen, setChosen] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY)
    } catch {
      return null
    }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The chosen device if it is still around, otherwise the first paired one.
  const device =
    devices.find((entry) => entry.id === chosen) ??
    devices.find((entry) => entry.paired) ??
    devices[0]
  const deviceId = device?.id

  const rotation = deviceId === undefined ? 0 : (rotations[deviceId] ?? readRotation(deviceId))

  /** Each paired wall, already rotated by its own setting. */
  const layouts = useMemo(() => {
    const rotated = new Map<string, PanelLayout>()
    for (const [id, geometry] of Object.entries(rawLayouts)) {
      rotated.set(id, rotateLayout(geometry, rotations[id] ?? readRotation(id)))
    }
    return rotated
  }, [rawLayouts, rotations])

  const layout = deviceId === undefined ? null : (layouts.get(deviceId) ?? null)

  /** The wall mock-up: painting when present, the device state otherwise. */
  const colors = useMemo(
    () => wallColors(layout?.panels ?? [], state, palettes, painted),
    [layout, state, palettes, painted],
  )

  const run = useCallback((fn: () => Promise<void>): void => {
    setBusy(true)
    setError(null)
    void fn()
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }, [])

  const report = useCallback((cause: unknown): void => {
    setError(cause instanceof Error ? cause.message : String(cause))
  }, [])

  /**
   * Continuous settings go through a coalescer: one write in flight, latest
   * value wins. Without it, dragging a slider piles up dozens of REST
   * requests of 60 to 340 ms each, and the interface falls behind.
   */
  const pushBrightness = useMemo(
    () =>
      createCoalescer<{ id: string; value: number }>(({ id, value }) =>
        bridge.setBrightness(id, value).catch(report),
      ),
    [bridge, report],
  )

  const pushColour = useMemo(
    () =>
      createCoalescer<{ id: string; hue: number; sat: number }>(({ id, hue, sat }) =>
        bridge.setColor(id, hue, sat).catch(report),
      ),
    [bridge, report],
  )

  const pushSelection = useMemo(
    () =>
      createCoalescer<{ id: string; entries: Array<{ panelId: number; color: Color }> }>(
        ({ id, entries }) => bridge.paintPanels(id, entries).catch(report),
      ),
    [bridge, report],
  )

  const load = useCallback(
    (id: string): void => {
      run(async () => {
        setState(await bridge.getState(id))
        const geometry = await bridge.getLayout(id)
        setRawLayouts((previous) => ({ ...previous, [id]: geometry }))
        setPalettes(await bridge.getEffectPalettes(id))
      })
    },
    [bridge, run],
  )

  /**
   * Already-paired devices first, so the interface is useful straight away,
   * then a discovery pass: a panel added since the last session has to show
   * up without being asked for.
   */
  useEffect(() => {
    run(async () => {
      setDevices(await bridge.listDevices())
      setDevices(await bridge.discover())
    })
  }, [bridge, run])

  useEffect(() => {
    if (device?.paired === true) load(device.id)
  }, [device?.id, device?.paired, load])

  /**
   * The device reports its own changes — including when the command comes
   * from the mobile app or the physical button. Without this stream the
   * interface would show a stale state until the next full re-read.
   */
  useEffect(() => {
    return bridge.onDeviceEvent((event: DeviceEventMessage) => {
      if (event.deviceId !== deviceId) return

      if (event.kind === 'effect') {
        const name = String(event.value)
        setState((previous) =>
          previous === null
            ? previous
            : { ...previous, effect: name, colorMode: name === SOLIDE ? 'hs' : 'effect' },
        )
        setPainted(new Map())
        setSelection(new Set())
        setLive(false)
        return
      }

      if (event.kind === 'layout') {
        void bridge
          .getLayout(event.deviceId)
          .then((geometry) =>
            setRawLayouts((previous) => ({ ...previous, [event.deviceId]: geometry })),
          )
          .catch(() => undefined)
        return
      }

      const fields: Partial<Record<DeviceEventMessage['kind'], keyof DeviceState>> = {
        on: 'on',
        brightness: 'brightness',
        hue: 'hue',
        sat: 'sat',
        ct: 'ct',
        colourMode: 'colorMode',
      }
      const field = fields[event.kind]
      if (field === undefined) return

      setState((previous) =>
        previous === null ? previous : { ...previous, [field]: event.value },
      )
    })
  }, [bridge, deviceId])

  /**
   * The other paired walls' geometry is loaded in the background: one sync
   * feeds them all, and without their layout we would not know what to send.
   */
  useEffect(() => {
    for (const entry of devices) {
      if (!entry.paired || entry.id === deviceId || rawLayouts[entry.id] !== undefined) continue
      void bridge
        .getLayout(entry.id)
        .then((geometry) =>
          setRawLayouts((previous) => ({ ...previous, [entry.id]: geometry })),
        )
        .catch(() => undefined)
    }
  }, [devices, deviceId, rawLayouts, bridge])

  return {
    devices,
    device,
    state,
    layout,
    palettes,
    colors,
    layouts,
    live,
    rotation,
    busy,
    error,

    discover: () => run(async () => setDevices(await bridge.discover())),

    selectDevice: (id) => {
      setChosen(id)
      try {
        localStorage.setItem(ACTIVE_KEY, id)
      } catch {
        // Storage unavailable: the choice holds for this session only.
      }
    },

    pair: (target) =>
      run(async () => {
        const id = target ?? deviceId
        if (id === undefined) return
        await bridge.pair(id)
        setDevices(await bridge.listDevices())
      }),

    refresh: () => {
      if (deviceId !== undefined) load(deviceId)
    },

    setRotation: (degrees) => {
      if (deviceId === undefined) return
      const angle = normaliseAngle(degrees)
      setRotations((previous) => ({ ...previous, [deviceId]: angle }))
      try {
        localStorage.setItem(rotationKey(deviceId), String(angle))
      } catch {
        // Storage unavailable: the setting holds for this session only.
      }
    },

    setOn: (on) =>
      run(async () => {
        if (deviceId === undefined) return
        await bridge.setOn(deviceId, on)
        setState(await bridge.getState(deviceId))
      }),

    // Immediate display, coalesced write: the slider stays smooth even when
    // the device takes 300 ms to answer.
    setBrightness: (value) => {
      setState((previous) => (previous === null ? previous : { ...previous, brightness: value }))
      if (deviceId !== undefined) pushBrightness({ id: deviceId, value })
    },

    /**
     * Recolours the panels the user has chosen, or the whole wall when they
     * have chosen none.
     *
     * Painting holds the wall through external control, and the solid colour
     * goes over REST: sending one while the other owns the panels made two
     * writers fight — the wall flashed the new colour, then the re-arm probe
     * put the painted frame back, and the interface showed neither.
     *
     * On the whole wall, setting a colour pulls the device out of its
     * effect: it switches to `hs` mode and reports `*Solid*`. Reflecting
     * that at once stops the mock-up from showing the palette of a scene
     * already replaced.
     */
    setColor: (hue, sat) => {
      if (deviceId === undefined) return

      const lit = [...selection]
      if (lit.length > 0) {
        const colour = hsbToRgb(hue, sat, 100)
        setPainted((previous) => {
          const next = new Map(previous)
          for (const id of lit) next.set(id, colour)
          return next
        })
        setState((previous) => (previous === null ? previous : { ...previous, hue, sat }))
        pushSelection({ id: deviceId, entries: lit.map((panelId) => ({ panelId, color: colour })) })
        return
      }

      setState((previous) =>
        previous === null
          ? previous
          : { ...previous, hue, sat, colorMode: 'hs', effect: SOLIDE },
      )
      pushColour({ id: deviceId, hue, sat })
    },

    /**
     * A click either lights a panel or switches it back off.
     *
     * Painting an off wall switches it on in the main process; reflecting
     * that here at once keeps the mock-up from drawing a dark wall for the
     * time it takes the device to announce its own change.
     *
     * The first stroke takes the whole wall, because external control drives
     * every panel: the ones left out of the frame go black. Seeding them
     * with what the wall already appears to be spares the jump from a lit
     * scene to a single lit panel over a dead wall.
     */
    paint: (panelId, color) => {
      if (deviceId === undefined) return
      const next = nextPaint(selection.has(panelId), color)
      setLive(true)
      setState((previous) => (previous === null ? previous : { ...previous, on: true }))

      setSelection((previous) => {
        const chosen = new Set(previous)
        // A panel switched off leaves the selection: the wheel must not
        // light it again behind the user's back.
        if (isUnlit(next)) chosen.delete(panelId)
        else chosen.add(panelId)
        return chosen
      })

      if (painted.size > 0) {
        setPainted((previous) => new Map(previous).set(panelId, next))
        void bridge.paintPanel(deviceId, panelId, next).catch(report)
        return
      }

      const seeded = new Map<number, Color>()
      for (const panel of layout?.panels ?? []) {
        seeded.set(panel.panelId, toFrameColor(colors.get(panel.panelId), OFF))
      }
      seeded.set(panelId, next)

      setPainted(seeded)
      pushSelection({
        id: deviceId,
        entries: [...seeded].map(([id, colour]) => ({ panelId: id, color: colour })),
      })
    },

    armScreen: async () => {
      const paired = devices.filter((entry) => entry.paired)
      if (paired.length === 0) return
      await Promise.all(paired.map((entry) => bridge.startStream(entry.id, 'screen')))
      setLive(true)
    },

    disarmScreen: async () => {
      const paired = devices.filter((entry) => entry.paired)
      await Promise.all(paired.map((entry) => bridge.stopStream(entry.id, 'screen')))
      setLive(false)
      setPainted(new Map())
      setSelection(new Set())
      if (deviceId !== undefined) setState(await bridge.getState(deviceId))
    },

    // The result is not awaited: the next frame corrects it anyway, and
    // waiting would drag the analysis loop.
    pushColors: (byDevice) => {
      for (const [id, colors] of Object.entries(byDevice)) {
        void bridge.sendFrame(id, 'screen', colors).catch(report)
      }
    },

    selectEffect: (name) =>
      run(async () => {
        if (deviceId === undefined) return
        await bridge.selectEffect(deviceId, name)
        setPainted(new Map())
        setSelection(new Set())
        setLive(false)
        setState(await bridge.getState(deviceId))
      }),
  }
}
