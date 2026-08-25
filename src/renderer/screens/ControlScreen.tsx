import { ColorWheel } from '../components/ColorWheel'
import { WallCanvas } from '../components/WallCanvas'
import { hsbToRgb } from '../../shared/color'
import { SOLIDE, type NanoleafSession } from '../useNanoleaf'
import type { Color } from '../../shared/types'
import { useT } from '../i18n'
import { translateError } from '../../shared/i18n/errors'

/** Repères pour retomber d'un clic sur un angle droit. */
const ANGLES_DROITS = [0, 90, 180, 270]

function Accueil({ session }: { session: NanoleafSession }) {
  const { device } = session
  const t = useT()

  return (
    <section className="controle" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <div
        className="verre"
        style={{ display: 'grid', gap: 14, placeContent: 'center', textAlign: 'center' }}
      >
        {device === undefined ? (
          <>
            <strong style={{ fontSize: 17 }}>{t('control.noDevice.title')}</strong>
            <p className="aide">{t('control.noDevice.body')}</p>
            <button className="bouton" disabled={session.busy} onClick={session.discover}>
              {t('control.discover')}
            </button>
          </>
        ) : (
          <>
            <strong style={{ fontSize: 17 }}>{t('control.found.title', { name: device.name })}</strong>
            <p className="aide" style={{ maxWidth: 320 }}>
              {t('control.found.body')}
            </p>
            <button className="bouton" disabled={session.busy} onClick={() => session.pair()}>
              {t('control.pair')}
            </button>
          </>
        )}
        {session.error !== null && <p className="erreur">{translateError(session.error, t)}</p>}
      </div>
    </section>
  )
}

export function ControlScreen({
  session,
  colors,
}: {
  session: NanoleafSession
  colors: Map<number, Color>
}) {
  const { device, state, layout } = session
  const t = useT()

  if (device === undefined || !device.paired) return <Accueil session={session} />

  // Sous une scène, le device cesse de tenir `hue` et `sat` à jour : les
  // afficher laisserait croire que le mur éclaire en blanc.
  const sousScene =
    state !== null && state.colorMode === 'effect' && state.effect !== SOLIDE
  const pinceau = hsbToRgb(state?.hue ?? 0, state?.sat ?? 100, 100)

  // Le mur n'est animé que lorsqu'une scène du device tourne et qu'aucune
  // source de l'application n'écrit dessus : dans ce dernier cas les
  // couleurs affichées sont exactes, il n'y a rien à approcher.
  const palette = session.palettes.find((entry) => entry.name === state?.effect)?.colors
  const motion =
    sousScene && palette !== undefined && palette.length > 0 && !session.live
      ? { palette, brightness: state?.brightness ?? 100 }
      : null

  return (
    <section className="controle">
      {layout === null ? (
        <div className="scene" />
      ) : (
        <WallCanvas
          layout={layout}
          colors={colors}
          motion={motion}
          onPaint={(panelId) => session.paint(panelId, pinceau)}
        />
      )}

      <aside className="verre panneau-lateral">
        <div className="rangee-murs">
          {session.devices.length > 1 && (
            <div className="segments murs">
              {session.devices.map((entry) => (
                <button
                  key={entry.id}
                  aria-pressed={entry.id === device.id}
                  onClick={() => session.selectDevice(entry.id)}
                  title={entry.paired ? entry.name : `${entry.name} — ${t('control.pair')}`}
                >
                  {entry.paired ? entry.name : `• ${entry.name}`}
                </button>
              ))}
            </div>
          )}
          <button
            className="rechercher"
            disabled={session.busy}
            onClick={session.discover}
            title={t('control.rescan')}
            aria-label={t('control.rescan')}
          >
            ⟳
          </button>
        </div>

        <div className="titre-device">
          <strong>{device.name}</strong>
          <span>
            {t('control.panels', { count: layout?.panels.length ?? 0 })}
            {device.firmware === undefined
              ? ''
              : ` · ${t('control.firmware', { version: device.firmware })}`}
          </span>
        </div>

        <button
          className="bouton"
          data-actif={state?.on === true}
          disabled={session.busy || state === null}
          onClick={() => session.setOn(!(state?.on ?? false))}
        >
          {state?.on === true ? t('control.turnOff') : t('control.turnOn')}
        </button>

        <div className="groupe">
          <div className="etiquette">
            {t('control.brightness')} <b>{state?.brightness ?? 0} %</b>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={state?.brightness ?? 0}
            onChange={(event) => session.setBrightness(Number(event.target.value))}
          />
        </div>

        <div className="groupe">
          <div className="etiquette">
            {t('control.colour')}
            <b>
              {sousScene
                ? state!.effect
                : `${Math.round(state?.hue ?? 0)}° · ${Math.round(state?.sat ?? 0)} %`}
            </b>
          </div>
          <ColorWheel
            hue={state?.hue ?? 0}
            sat={state?.sat ?? 0}
            size={200}
            onPick={({ hue, sat }) => session.setColor(Math.round(hue), Math.round(sat))}
          />
          {sousScene && <p className="aide">{t('control.colour.underScene')}</p>}
          {motion !== null && <p className="aide">{t('control.motion.approximate')}</p>}
        </div>

        <div className="groupe">
          <div className="etiquette">
            {t('control.orientation')} <b>{session.rotation}°</b>
          </div>
          <input
            type="range"
            min={0}
            max={359}
            step={1}
            value={session.rotation}
            onChange={(event) => session.setRotation(Number(event.target.value))}
          />
          <div className="segments">
            {ANGLES_DROITS.map((angle) => (
              <button
                key={angle}
                aria-pressed={session.rotation === angle}
                onClick={() => session.setRotation(angle)}
              >
                {angle}°
              </button>
            ))}
          </div>
          <p className="aide">{t('control.orientation.help')}</p>
        </div>

        <p className="aide">{t('control.paint.help')}</p>

        {session.error !== null && <p className="erreur">{translateError(session.error, t)}</p>}
      </aside>
    </section>
  )
}
