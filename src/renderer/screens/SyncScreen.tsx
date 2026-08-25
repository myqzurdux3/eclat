import { useEffect, useRef } from 'react'
import type { MappingMode } from '../../shared/sync/settings'
import type { ScreenSync } from '../useScreenSync'
import type { NanoleafSession } from '../useNanoleaf'
import { useT } from '../i18n'
import { translateError } from '../../shared/i18n/errors'
import type { MessageKey } from '../../shared/i18n'

const MODES: Array<{ value: MappingMode; cle: MessageKey }> = [
  { value: 'spatial', cle: 'sync.mode.spatial' },
  { value: 'dominant', cle: 'sync.mode.dominant' },
  { value: 'palette', cle: 'sync.mode.palette' },
]

const REGLAGES = [
  { cle: 'radius', libelle: 'sync.radius', min: 0.05, max: 0.5, pas: 0.01, unite: '' },
  { cle: 'saturation', libelle: 'sync.saturation', min: 0.5, max: 2, pas: 0.05, unite: '×' },
  { cle: 'blackFloor', libelle: 'sync.blackFloor', min: 0, max: 0.2, pas: 0.01, unite: '' },
  { cle: 'attack', libelle: 'sync.attack', min: 0.1, max: 1, pas: 0.05, unite: '' },
  { cle: 'release', libelle: 'sync.release', min: 0.02, max: 0.5, pas: 0.01, unite: '' },
  { cle: 'hz', libelle: 'sync.hz', min: 10, max: 30, pas: 1, unite: ' Hz' },
] as const satisfies ReadonlyArray<{ libelle: MessageKey; [k: string]: unknown }>

/** Rend l'image analysée, telle que le pipeline la voit : 64×36 pixels. */
function Apercu({ sync }: { sync: ScreenSync }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const t = useT()

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
        <p className="aide">{t('sync.preview.empty')}</p>
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
  const t = useT()

  if (session.device === undefined || !session.device.paired) {
    return (
      <section className="grille-scenes">
        <p className="etat-vide">{t('sync.unpaired')}</p>
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
        {sync.colors !== null &&
          [...sync.colors].map(([deviceId, couleurs]) => (
            <div className="bande-couleurs" key={deviceId} title={deviceId}>
              {[...couleurs.values()].map((color, index) => (
                <span
                  key={index}
                  style={{ background: `rgb(${color.r}, ${color.g}, ${color.b})` }}
                />
              ))}
            </div>
          ))}
      </div>

      <aside className="verre panneau-lateral">
        <div className="titre-device">
          <strong>{t('sync.title')}</strong>
          <span>{sync.actif ? t('sync.running') : t('sync.stopped')}</span>
        </div>

        <button className="bouton" data-actif={sync.actif} disabled={sync.demarrage} onClick={basculer}>
          {sync.demarrage ? t('sync.choosing') : sync.actif ? t('sync.stop') : t('sync.choose')}
        </button>

        <div className="groupe">
          <div className="etiquette">{t('sync.mode')}</div>
          <div className="segments">
            {MODES.map(({ value, cle }) => (
              <button
                key={value}
                aria-pressed={sync.settings.mode === value}
                onClick={() => sync.setSettings({ mode: value })}
              >
                {t(cle)}
              </button>
            ))}
          </div>
        </div>

        {REGLAGES.map(({ cle, libelle, min, max, pas, unite }) => (
          <div className="groupe" key={cle}>
            <div className="etiquette">
              {t(libelle)}
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

        <p className="aide">{t('sync.wayland.help')}</p>

        {sync.error !== null && <p className="erreur">{translateError(sync.error, t)}</p>}
      </aside>
    </section>
  )
}
