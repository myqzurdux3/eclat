import { ColorWheel } from '../components/ColorWheel'
import { WallCanvas } from '../components/WallCanvas'
import { hsbToRgb } from '../../shared/color'
import { EXT_CONTROL_EFFECT } from '../../shared/types'
import { SOLIDE, type NanoleafSession } from '../useNanoleaf'
import type { Color } from '../../shared/types'
import { useT } from '../i18n'
import { translateError } from '../../shared/i18n/errors'

/** Shortcuts for snapping back to a right angle in one click. */
const RIGHT_ANGLES = [0, 90, 180, 270]

function Welcome({ session }: { session: NanoleafSession }) {
  const { device } = session
  const t = useT()

  return (
    <section className="control" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <div
        className="glass"
        style={{ display: 'grid', gap: 14, placeContent: 'center', textAlign: 'center' }}
      >
        {device === undefined ? (
          <>
            <strong style={{ fontSize: 17 }}>{t('control.noDevice.title')}</strong>
            <p className="hint">{t('control.noDevice.body')}</p>
            <button className="button" disabled={session.busy} onClick={session.discover}>
              {t('control.discover')}
            </button>
          </>
        ) : (
          <>
            <strong style={{ fontSize: 17 }}>{t('control.found.title', { name: device.name })}</strong>
            <p className="hint" style={{ maxWidth: 320 }}>
              {t('control.found.body')}
            </p>
            <button className="button" disabled={session.busy} onClick={() => session.pair()}>
              {t('control.pair')}
            </button>
          </>
        )}
        {session.error !== null && <p className="error">{translateError(session.error, t)}</p>}
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

  if (device === undefined || !device.paired) return <Welcome session={session} />

  // Under a scene the device stops keeping `hue` and `sat` current:
  // showing them would suggest the wall is lit white.
  const underScene =
    state !== null && state.colorMode === 'effect' && state.effect !== SOLIDE
  const brush = hsbToRgb(state?.hue ?? 0, state?.sat ?? 100, 100)

  // The wall is only animated while a device scene is running and no
  // source of the application is writing to it: in that case the displayed
  // colours are exact, so there is nothing to approximate.
  const palette = session.palettes.find((entry) => entry.name === state?.effect)?.colors
  const motion =
    underScene && palette !== undefined && palette.length > 0 && !session.live
      ? { palette, brightness: state?.brightness ?? 100 }
      : null

  return (
    <section className="control">
      {layout === null ? (
        <div className="stage" />
      ) : (
        <WallCanvas
          layout={layout}
          colors={colors}
          motion={motion}
          onPaint={(panelId) => session.paint(panelId, brush)}
        />
      )}

      <aside className="glass sidebar">
        <div className="wall-row">
          {session.devices.length > 1 && (
            <div className="segments walls">
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
            className="rescan"
            disabled={session.busy}
            onClick={session.discover}
            title={t('control.rescan')}
            aria-label={t('control.rescan')}
          >
            ⟳
          </button>
        </div>

        <div className="device-title">
          <strong>{device.name}</strong>
          <span>
            {t('control.panels', { count: layout?.panels.length ?? 0 })}
            {device.firmware === undefined
              ? ''
              : ` · ${t('control.firmware', { version: device.firmware })}`}
          </span>
        </div>

        <button
          className="button"
          data-actif={state?.on === true}
          disabled={session.busy || state === null}
          onClick={() => session.setOn(!(state?.on ?? false))}
        >
          {state?.on === true ? t('control.turnOff') : t('control.turnOn')}
        </button>

        <div className="group">
          <div className="label">
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

        <div className="group">
          <div className="label">
            {t('control.colour')}
            <b>
              {!underScene
                ? `${Math.round(state?.hue ?? 0)}° · ${Math.round(state?.sat ?? 0)} %`
                : state!.effect === EXT_CONTROL_EFFECT
                  ? t('control.externalControl')
                  : state!.effect}
            </b>
          </div>
          <ColorWheel
            hue={state?.hue ?? 0}
            sat={state?.sat ?? 0}
            size={200}
            onPick={({ hue, sat }) => session.setColor(Math.round(hue), Math.round(sat))}
          />
          {underScene && <p className="hint">{t('control.colour.underScene')}</p>}
          {motion !== null && <p className="hint">{t('control.motion.approximate')}</p>}
        </div>

        <div className="group">
          <div className="label">
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
            {RIGHT_ANGLES.map((angle) => (
              <button
                key={angle}
                aria-pressed={session.rotation === angle}
                onClick={() => session.setRotation(angle)}
              >
                {angle}°
              </button>
            ))}
          </div>
          <p className="hint">{t('control.orientation.help')}</p>
        </div>

        <p className="hint">{t('control.paint.help')}</p>

        {session.error !== null && <p className="error">{translateError(session.error, t)}</p>}
      </aside>
    </section>
  )
}
