import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DeviceEventMessage, NanoleafApi, RendererDevice } from '../shared/ipc-contract'
import { createCoalescer } from '../shared/coalesce'
import { rotateLayout } from '../shared/geometry'
import { wallColors } from '../shared/wall-colors'
import type { Color, DeviceState, EffectPalette, PanelLayout } from '../shared/types'

const CLE_ROTATION = 'nanoleaf.rotation'

/** Chaque mur est accroché à sa façon : l'orientation est propre au device. */
const cleRotation = (deviceId: string): string => `${CLE_ROTATION}.${deviceId}`
const CLE_ACTIF = 'nanoleaf.device'

/** Nom d'effet rapporté par le device quand il éclaire en couleur unie. */
export const SOLIDE = '*Solid*'

/** Rotation du mur, en degrés horaires à l'écran. */
const ROTATION_MAX = 360

export interface NanoleafSession {
  /** Tous les devices connus, appairés ou seulement découverts. */
  devices: RendererDevice[]
  device: RendererDevice | undefined
  selectDevice: (deviceId: string) => void
  state: DeviceState | null
  /** Déjà pivotée selon le réglage de l'utilisateur. */
  layout: PanelLayout | null
  palettes: EffectPalette[]
  colors: Map<number, Color>
  /** Géométrie de chaque mur appairé, déjà pivotée. */
  layouts: Map<string, PanelLayout>
  /** Vrai quand l'application écrit elle-même sur les panneaux. */
  live: boolean
  rotation: number
  busy: boolean
  error: string | null
  discover: () => void
  pair: (deviceId?: string) => void
  refresh: () => void
  /** Angle en degrés horaires, à l'écran. */
  setRotation: (degrees: number) => void
  setOn: (on: boolean) => void
  setBrightness: (value: number) => void
  setColor: (hue: number, sat: number) => void
  paint: (panelId: number, color: Color) => void
  selectEffect: (name: string) => void
  /** Arme le mode externe pour la source écran, sur tous les murs appairés. */
  armScreen: () => Promise<void>
  disarmScreen: () => Promise<void>
  /** Diffuse une frame produite par le sync écran, device par device. */
  pushColors: (byDevice: Record<string, Color[]>) => void
}

const normaliserAngle = (degres: number): number =>
  ((Math.round(degres) % ROTATION_MAX) + ROTATION_MAX) % ROTATION_MAX

/** Le device ne dit pas comment le mur est accroché : l'utilisateur décide. */
function lireRotation(deviceId: string | undefined): number {
  if (deviceId === undefined) return 0
  try {
    const brut = localStorage.getItem(cleRotation(deviceId))
    return brut === null ? 0 : normaliserAngle(Number(brut))
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
  const [layoutsBruts, setLayoutsBruts] = useState<Record<string, PanelLayout>>({})
  const [palettes, setPalettes] = useState<EffectPalette[]>([])
  const [painted, setPainted] = useState<Map<number, Color>>(new Map())
  const [live, setLive] = useState(false)
  const [rotations, setRotations] = useState<Record<string, number>>({})
  const [choisi, setChoisi] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CLE_ACTIF)
    } catch {
      return null
    }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Le device choisi s'il est toujours là, sinon le premier appairé.
  const device =
    devices.find((entry) => entry.id === choisi) ??
    devices.find((entry) => entry.paired) ??
    devices[0]
  const deviceId = device?.id

  const rotation = deviceId === undefined ? 0 : (rotations[deviceId] ?? lireRotation(deviceId))

  /** Chaque mur appairé, déjà pivoté selon son propre réglage. */
  const layouts = useMemo(() => {
    const tournes = new Map<string, PanelLayout>()
    for (const [id, geometrie] of Object.entries(layoutsBruts)) {
      tournes.set(id, rotateLayout(geometrie, rotations[id] ?? lireRotation(id)))
    }
    return tournes
  }, [layoutsBruts, rotations])

  const layout = deviceId === undefined ? null : (layouts.get(deviceId) ?? null)

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
        const geometrie = await bridge.getLayout(id)
        setLayoutsBruts((precedents) => ({ ...precedents, [id]: geometrie }))
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

  /**
   * Le device signale lui-même ce qui change — y compris quand la commande
   * vient de l'app mobile ou du bouton physique. Sans ce flux, l'interface
   * afficherait un état périmé jusqu'à la prochaine relecture complète.
   */
  useEffect(() => {
    return bridge.onDeviceEvent((event: DeviceEventMessage) => {
      if (event.deviceId !== deviceId) return

      if (event.kind === 'effect') {
        const nom = String(event.value)
        setState((precedent) =>
          precedent === null
            ? precedent
            : { ...precedent, effect: nom, colorMode: nom === SOLIDE ? 'hs' : 'effect' },
        )
        setPainted(new Map())
        setLive(false)
        return
      }

      if (event.kind === 'layout') {
        void bridge
          .getLayout(event.deviceId)
          .then((geometrie) =>
            setLayoutsBruts((precedents) => ({ ...precedents, [event.deviceId]: geometrie })),
          )
          .catch(() => undefined)
        return
      }

      const champs: Partial<Record<DeviceEventMessage['kind'], keyof DeviceState>> = {
        on: 'on',
        brightness: 'brightness',
        hue: 'hue',
        sat: 'sat',
        ct: 'ct',
        colourMode: 'colorMode',
      }
      const champ = champs[event.kind]
      if (champ === undefined) return

      setState((precedent) =>
        precedent === null ? precedent : { ...precedent, [champ]: event.value },
      )
    })
  }, [bridge, deviceId])

  /**
   * La géométrie des autres murs appairés est chargée en fond : un sync les
   * alimente tous, et sans leur layout on ne saurait pas quoi leur envoyer.
   */
  useEffect(() => {
    for (const entry of devices) {
      if (!entry.paired || entry.id === deviceId || layoutsBruts[entry.id] !== undefined) continue
      void bridge
        .getLayout(entry.id)
        .then((geometrie) =>
          setLayoutsBruts((precedents) => ({ ...precedents, [entry.id]: geometrie })),
        )
        .catch(() => undefined)
    }
  }, [devices, deviceId, layoutsBruts, bridge])

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
      setChoisi(id)
      try {
        localStorage.setItem(CLE_ACTIF, id)
      } catch {
        // Stockage indisponible : le choix vaut pour cette session.
      }
    },

    pair: (cible) =>
      run(async () => {
        const id = cible ?? deviceId
        if (id === undefined) return
        await bridge.pair(id)
        setDevices(await bridge.listDevices())
      }),

    refresh: () => {
      if (deviceId !== undefined) load(deviceId)
    },

    setRotation: (degrees) => {
      if (deviceId === undefined) return
      const angle = normaliserAngle(degrees)
      setRotations((precedentes) => ({ ...precedentes, [deviceId]: angle }))
      try {
        localStorage.setItem(cleRotation(deviceId), String(angle))
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
      setLive(true)
      void bridge.paintPanel(deviceId, panelId, color).catch(signaler)
    },

    armScreen: async () => {
      const appaires = devices.filter((entry) => entry.paired)
      if (appaires.length === 0) return
      await Promise.all(appaires.map((entry) => bridge.startStream(entry.id, 'screen')))
      setLive(true)
    },

    disarmScreen: async () => {
      const appaires = devices.filter((entry) => entry.paired)
      await Promise.all(appaires.map((entry) => bridge.stopStream(entry.id, 'screen')))
      setLive(false)
      setPainted(new Map())
      if (deviceId !== undefined) setState(await bridge.getState(deviceId))
    },

    // Le retour n'est pas attendu : la frame suivante corrige de toute
    // façon, et attendre ferait traîner la boucle d'analyse.
    pushColors: (byDevice) => {
      for (const [id, colors] of Object.entries(byDevice)) {
        void bridge.sendFrame(id, 'screen', colors).catch(signaler)
      }
    },

    selectEffect: (name) =>
      run(async () => {
        if (deviceId === undefined) return
        await bridge.selectEffect(deviceId, name)
        setPainted(new Map())
        setLive(false)
        setState(await bridge.getState(deviceId))
      }),
  }
}
