import { useCallback, useEffect, useMemo, useState } from 'react'
import type { NanoleafApi, RendererDevice } from '../shared/ipc-contract'
import { createCoalescer } from '../shared/coalesce'
import { rotateLayout } from '../shared/geometry'
import { wallColors } from '../shared/wall-colors'
import type { Color, DeviceState, EffectPalette, PanelLayout } from '../shared/types'

const CLE_ROTATION = 'nanoleaf.rotation'

/** Nom d'effet rapporté par le device quand il éclaire en couleur unie. */
export const SOLIDE = '*Solid*'

/** Rotation du mur, en degrés horaires à l'écran. */
const ROTATION_MAX = 360

export interface NanoleafSession {
  device: RendererDevice | undefined
  state: DeviceState | null
  /** Déjà pivotée selon le réglage de l'utilisateur. */
  layout: PanelLayout | null
  palettes: EffectPalette[]
  colors: Map<number, Color>
  rotation: number
  busy: boolean
  error: string | null
  discover: () => void
  pair: () => void
  refresh: () => void
  /** Angle en degrés horaires, à l'écran. */
  setRotation: (degrees: number) => void
  setOn: (on: boolean) => void
  setBrightness: (value: number) => void
  setColor: (hue: number, sat: number) => void
  paint: (panelId: number, color: Color) => void
  selectEffect: (name: string) => void
  /** Arme le mode externe pour la source écran. */
  armScreen: () => Promise<void>
  disarmScreen: () => Promise<void>
  /** Diffuse une frame produite par le sync écran. */
  pushColors: (colors: Color[]) => void
}

const normaliserAngle = (degres: number): number =>
  ((Math.round(degres) % ROTATION_MAX) + ROTATION_MAX) % ROTATION_MAX

/** Le device ne dit pas comment le mur est accroché : l'utilisateur décide. */
function lireRotation(): number {
  try {
    const brut = Number(localStorage.getItem(CLE_ROTATION))
    return Number.isFinite(brut) ? normaliserAngle(brut) : 0
  } catch {
    return 0
  }
}

/**
 * Rassemble l'état du device côté renderer. Les couleurs peintes sont tenues
 * ici pour que le canvas les rende sans aller-retour IPC supplémentaire.
 */
export function useNanoleaf(bridge: NanoleafApi): NanoleafSession {
  const [devices, setDevices] = useState<RendererDevice[]>([])
  const [state, setState] = useState<DeviceState | null>(null)
  const [brut, setBrut] = useState<PanelLayout | null>(null)
  const [palettes, setPalettes] = useState<EffectPalette[]>([])
  const [painted, setPainted] = useState<Map<number, Color>>(new Map())
  const [rotation, setRotationState] = useState(lireRotation)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const device = devices.find((entry) => entry.paired) ?? devices[0]
  const deviceId = device?.id

  const layout = useMemo(
    () => (brut === null ? null : rotateLayout(brut, rotation)),
    [brut, rotation],
  )

  /** Maquette du mur : la peinture si elle existe, l'état du device sinon. */
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

  const signaler = useCallback((cause: unknown): void => {
    setError(cause instanceof Error ? cause.message : String(cause))
  }, [])

  /**
   * Les réglages continus passent par un fusionneur : une seule écriture en
   * vol, la dernière valeur gagne. Sans lui, un glissement de curseur empile
   * des dizaines de requêtes REST de 60 à 340 ms chacune, et l'interface
   * décroche.
   */
  const pousserLuminosite = useMemo(
    () =>
      createCoalescer<{ id: string; value: number }>(({ id, value }) =>
        bridge.setBrightness(id, value).catch(signaler),
      ),
    [bridge, signaler],
  )

  const pousserCouleur = useMemo(
    () =>
      createCoalescer<{ id: string; hue: number; sat: number }>(({ id, hue, sat }) =>
        bridge.setColor(id, hue, sat).catch(signaler),
      ),
    [bridge, signaler],
  )

  const load = useCallback(
    (id: string): void => {
      run(async () => {
        setState(await bridge.getState(id))
        setBrut(await bridge.getLayout(id))
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
    rotation,
    busy,
    error,

    discover: () => run(async () => setDevices(await bridge.discover())),

    pair: () =>
      run(async () => {
        if (deviceId === undefined) return
        await bridge.pair(deviceId)
        setDevices(await bridge.listDevices())
      }),

    refresh: () => {
      if (deviceId !== undefined) load(deviceId)
    },

    setRotation: (degrees) => {
      const angle = normaliserAngle(degrees)
      setRotationState(angle)
      try {
        localStorage.setItem(CLE_ROTATION, String(angle))
      } catch {
        // Stockage indisponible : le réglage vaut pour cette session.
      }
    },

    setOn: (on) =>
      run(async () => {
        if (deviceId === undefined) return
        await bridge.setOn(deviceId, on)
        setState(await bridge.getState(deviceId))
      }),

    // Affichage immédiat, écriture fusionnée : le curseur reste fluide même
    // si le device met 300 ms à répondre.
    setBrightness: (value) => {
      setState((previous) => (previous === null ? previous : { ...previous, brightness: value }))
      if (deviceId !== undefined) pousserLuminosite({ id: deviceId, value })
    },

    // Régler une couleur sort le device de son effet : il bascule en mode
    // `hs` et rapporte `*Solid*`. Le refléter tout de suite évite que la
    // maquette continue d'afficher la palette d'une scène déjà remplacée.
    setColor: (hue, sat) => {
      setState((previous) =>
        previous === null
          ? previous
          : { ...previous, hue, sat, colorMode: 'hs', effect: SOLIDE },
      )
      if (deviceId !== undefined) pousserCouleur({ id: deviceId, hue, sat })
    },

    paint: (panelId, color) => {
      setPainted((previous) => new Map(previous).set(panelId, color))
      if (deviceId === undefined) return
      void bridge.paintPanel(deviceId, panelId, color).catch(signaler)
    },

    armScreen: async () => {
      if (deviceId === undefined) return
      await bridge.startStream(deviceId, 'screen')
    },

    disarmScreen: async () => {
      if (deviceId === undefined) return
      await bridge.stopStream(deviceId, 'screen')
      setState(await bridge.getState(deviceId))
    },

    // Le retour n'est pas attendu : la frame suivante corrige de toute
    // façon, et attendre ferait traîner la boucle d'analyse.
    pushColors: (colors) => {
      if (deviceId === undefined) return
      void bridge.sendFrame(deviceId, 'screen', colors).catch(signaler)
    },

    selectEffect: (name) =>
      run(async () => {
        if (deviceId === undefined) return
        await bridge.selectEffect(deviceId, name)
        setPainted(new Map())
        setState(await bridge.getState(deviceId))
      }),
  }
}
