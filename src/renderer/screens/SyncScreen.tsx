import { useEffect, useRef } from 'react'
import type { MappingMode } from '../../shared/sync/settings'
import type { ScreenSync } from '../useScreenSync'
import type { NanoleafSession } from '../useNanoleaf'

const MODES: Array<{ value: MappingMode; libelle: string }> = [
  { value: 'spatial', libelle: 'Spatial' },
  { value: 'dominant', libelle: 'Dominante' },
  { value: 'palette', libelle: 'Palette' },
]

const REGLAGES = [
  { cle: 'radius', libelle: 'Rayon', min: 0.05, max: 0.5, pas: 0.01, unite: '' },
  { cle: 'saturation', libelle: 'Saturation', min: 0.5, max: 2, pas: 0.05, unite: '×' },
  { cle: 'blackFloor', libelle: 'Plancher de noir', min: 0, max: 0.2, pas: 0.01, unite: '' },
  { cle: 'attack', libelle: 'Attaque', min: 0.1, max: 1, pas: 0.05, unite: '' },
  { cle: 'release', libelle: 'Relâche', min: 0.02, max: 0.5, pas: 0.01, unite: '' },
  { cle: 'hz', libelle: 'Cadence', min: 10, max: 30, pas: 1, unite: ' Hz' },
] as const

/** Rend l'image analysée, telle que le pipeline la voit : 64×36 pixels. */
function Apercu({ sync }: { sync: ScreenSync }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const apercu = sync.apercu
    if (canvas === null || apercu === null) return
    const context = canvas.getContext('2d')
    if (context === null) return

    canvas.width = apercu.width
    canvas.height = apercu.height
    context.putImageData(new ImageData(apercu.data, apercu.width, apercu.height), 0, 0)
  }, [sync.apercu])

  if (sync.apercu === null) {
    return (
      <div className="apercu-vide">
        <p className="aide">L&apos;aperçu apparaîtra ici une fois la capture démarrée.</p>
      </div>
    )
  }

  return <canvas ref={canvasRef} className="apercu" />
}

export function SyncScreen({
  session,
  sync,
}: {
  session: NanoleafSession
  sync: ScreenSync
}) {
  if (session.device === undefined || !session.device.paired) {
    return (
      <section className="grille-scenes">
        <p className="etat-vide">Appaire un device pour synchroniser l&apos;écran.</p>
      </section>
    )
  }

  const basculer = (): void => {
    if (sync.actif) {
      sync.stop()
      void session.disarmScreen()
      return
    }
    void session.armScreen().then(() => sync.start())
  }

  return (
    <section className="controle">
      <div className="scene apercu-cadre">
        <Apercu sync={sync} />
        {sync.colors !== null && (
          <div className="bande-couleurs">
            {[...sync.colors.values()].map((color, index) => (
              <span
                key={index}
                style={{ background: `rgb(${color.r}, ${color.g}, ${color.b})` }}
              />
            ))}
          </div>
        )}
      </div>

      <aside className="verre panneau-lateral">
        <div className="titre-device">
          <strong>Synchronisation écran</strong>
          <span>{sync.actif ? 'En cours' : 'À l’arrêt'}</span>
        </div>

        <button className="bouton" data-actif={sync.actif} disabled={sync.demarrage} onClick={basculer}>
          {sync.demarrage ? 'Sélection…' : sync.actif ? 'Arrêter' : 'Choisir une source'}
        </button>

        <div className="groupe">
          <div className="etiquette">Mode de mapping</div>
          <div className="segments">
            {MODES.map(({ value, libelle }) => (
              <button
                key={value}
                aria-pressed={sync.settings.mode === value}
                onClick={() => sync.setSettings({ mode: value })}
              >
                {libelle}
              </button>
            ))}
          </div>
        </div>

        {REGLAGES.map(({ cle, libelle, min, max, pas, unite }) => (
          <div className="groupe" key={cle}>
            <div className="etiquette">
              {libelle}
              <b>
                {cle === 'hz' ? sync.settings[cle] : sync.settings[cle].toFixed(2)}
                {unite}
              </b>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              step={pas}
              value={sync.settings[cle]}
              disabled={cle === 'radius' && sync.settings.mode !== 'spatial'}
              onChange={(event) => sync.setSettings({ [cle]: Number(event.target.value) })}
            />
          </div>
        ))}

        <p className="aide">
          Sous Wayland, c&apos;est le sélecteur de GNOME qui choisit la fenêtre :
          l&apos;application ne peut pas en afficher les vignettes. La source doit être
          re-choisie à chaque lancement, le portail ne rendant pas son jeton de restauration.
          En revanche le flux reste ouvert tant que l&apos;app tourne, donc arrêter puis
          relancer le sync ne redemande rien.
        </p>

        {sync.error !== null && <p className="erreur">{sync.error}</p>}
      </aside>
    </section>
  )
}
