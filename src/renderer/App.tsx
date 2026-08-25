import { useEffect, useMemo, useState } from 'react'
import type { NanoleafApi } from '../shared/ipc-contract'
import { ControlScreen } from './screens/ControlScreen'
import { ScenesScreen } from './screens/ScenesScreen'
import { SyncScreen } from './screens/SyncScreen'
import { useScreenSync } from './useScreenSync'
import { useNanoleaf } from './useNanoleaf'

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
        Cette page est servie par Vite, qui ne fournit que l&apos;interface. Le dialogue avec
        les panneaux passe par le processus main d&apos;Electron : le token
        d&apos;authentification ne doit jamais atteindre le navigateur.
      </p>
      <pre style={{ margin: 0, padding: 12, background: '#17171c', borderRadius: 6 }}>
        VITE_DEV_SERVER_URL=http://localhost:5173 npm run start
      </pre>
    </main>
  )
}

type Onglet = 'controle' | 'scenes' | 'sync'

const ONGLETS: Array<{ value: Onglet; libelle: string }> = [
  { value: 'controle', libelle: 'Contrôle' },
  { value: 'scenes', libelle: 'Scènes' },
  { value: 'sync', libelle: 'Sync' },
]

const CLE_ONGLET = 'nanoleaf.onglet'

/** L'application rouvre sur l'onglet quitté. */
function lireOnglet(): Onglet {
  try {
    const brut = localStorage.getItem(CLE_ONGLET)
    return ONGLETS.some((onglet) => onglet.value === brut) ? (brut as Onglet) : 'controle'
  } catch {
    return 'controle'
  }
}

function Shell({ bridge }: { bridge: NanoleafApi }) {
  const session = useNanoleaf(bridge)
  const sync = useScreenSync(session.layout, session.pushColors)
  const [screen, setScreen] = useState<Onglet>(lireOnglet)

  const choisirOnglet = (value: Onglet): void => {
    setScreen(value)
    try {
      localStorage.setItem(CLE_ONGLET, value)
    } catch {
      // Stockage indisponible : le choix vaut pour cette session.
    }
  }

  // Pendant un sync, le mur affiche ce qui part vraiment vers les panneaux.
  const couleursMur = sync.colors ?? session.colors

  /** Le fond dérive vers la moyenne des couleurs posées sur le mur. */
  const derive = useMemo(() => {
    const posees = [...couleursMur.values()]
    if (posees.length === 0) return 'radial-gradient(circle at 30% 30%, #16161c, #0a0a0c)'
    const somme = posees.reduce(
      (total, color) => ({ r: total.r + color.r, g: total.g + color.g, b: total.b + color.b }),
      { r: 0, g: 0, b: 0 },
    )
    const n = posees.length
    const teinte = `rgb(${Math.round(somme.r / n)}, ${Math.round(somme.g / n)}, ${Math.round(somme.b / n)})`
    return `radial-gradient(circle at 30% 30%, ${teinte}, #0a0a0c)`
  }, [couleursMur])

  // Fondu croisé : le calque sortant garde son fond, seule l'opacité bouge.
  const [calques, setCalques] = useState<[string, string]>([derive, derive])
  const [actif, setActif] = useState(0)

  useEffect(() => {
    if (calques[actif] === derive) return
    const suivant = actif === 0 ? 1 : 0
    setCalques((precedents) => {
      const copie: [string, string] = [...precedents]
      copie[suivant] = derive
      return copie
    })
    setActif(suivant)
  }, [derive, actif, calques])

  return (
    <>
      {calques.map((fond, index) => (
        <div
          key={index}
          className="derive"
          data-visible={index === actif}
          style={{ background: fond }}
        />
      ))}
      <div className="coquille">
        <header className="barre">
          <nav className="onglets">
            {ONGLETS.map(({ value, libelle }) => (
              <button
                key={value}
                aria-selected={screen === value}
                onClick={() => choisirOnglet(value)}
              >
                {libelle}
              </button>
            ))}
          </nav>
          <div className="commandes-fenetre">
            <button title="Réduire" onClick={() => void bridge.minimizeWindow()}>
              –
            </button>
            <button title="Fermer" onClick={() => void bridge.closeWindow()}>
              ×
            </button>
          </div>
        </header>

        {screen === 'controle' && <ControlScreen session={session} colors={couleursMur} />}
        {screen === 'scenes' && <ScenesScreen session={session} />}
        {screen === 'sync' && <SyncScreen session={session} sync={sync} />}
      </div>
    </>
  )
}

export function App() {
  const bridge = typeof window === 'undefined' ? undefined : window.nanoleaf
  if (bridge === undefined) return <MissingBridge />
  return <Shell bridge={bridge} />
}
