import { useT } from '../i18n'
import type { AudioSync } from '../useAudioSync'
import type { NanoleafSession } from '../useNanoleaf'
import type { MessageKey } from '../../shared/i18n'
import { translateError } from '../../shared/i18n/errors'
import { AUDIO_MODES } from '../../shared/audio/palette'

const SLIDERS = [
  { key: 'sensitivity', label: 'audio.sensitivity', min: 0.2, max: 3, step: 0.1 },
  { key: 'beatFlash', label: 'audio.beatFlash', min: 0, max: 1, step: 0.05 },
  { key: 'gate', label: 'audio.gate', min: 0, max: 0.2, step: 0.005 },
] as const satisfies ReadonlyArray<{ label: MessageKey; [k: string]: unknown }>

const BANDS = [
  { key: 'bass', label: 'audio.bass' },
  { key: 'mid', label: 'audio.mid' },
  { key: 'treble', label: 'audio.treble' },
] as const satisfies ReadonlyArray<{ label: MessageKey; [k: string]: unknown }>

/** A live meter per band, plus a lamp that lights on every beat. */
function Meters({ audio }: { audio: AudioSync }) {
  const t = useT()
  const features = audio.features

  return (
    <div className="meters">
      {BANDS.map(({ key, label }) => (
        <div className="meter" key={key}>
          <span className="meter-label">{t(label)}</span>
          <div className="meter-track">
            <div
              className="meter-fill"
              style={{ transform: `scaleX(${features?.[key] ?? 0})` }}
            />
          </div>
        </div>
      ))}
      <div className="meter">
        <span className="meter-label">{t('audio.beat')}</span>
        <div className="beat-lamp" data-on={features?.beat === true} />
      </div>
    </div>
  )
}

export function AudioScreen({
  session,
  audio,
}: {
  session: NanoleafSession
  audio: AudioSync
}) {
  const t = useT()

  if (session.device === undefined || !session.device.paired) {
    return (
      <section className="scene-grid">
        <p className="empty-state">{t('sync.unpaired')}</p>
      </section>
    )
  }

  const toggle = (): void => {
    if (audio.active) {
      audio.stop()
      void session.disarmScreen()
      return
    }
    void session.armScreen().then(() => audio.start())
  }

  return (
    <section className="control">
      <div className="stage preview-frame">
        <Meters audio={audio} />
        {audio.colors !== null &&
          [...audio.colors].map(([deviceId, colours]) => (
            <div className="colour-strip" key={deviceId} title={deviceId}>
              {[...colours.values()].map((colour, index) => (
                <span
                  key={index}
                  style={{ background: `rgb(${colour.r}, ${colour.g}, ${colour.b})` }}
                />
              ))}
            </div>
          ))}
      </div>

      <aside className="glass sidebar">
        <div className="device-title">
          <strong>{t('audio.title')}</strong>
          <span>{audio.active ? t('sync.running') : t('sync.stopped')}</span>
        </div>

        <div className="group">
          <div className="label">
            {t('audio.output')}
            <button className="rescan" onClick={audio.refreshSources} title={t('audio.refresh')}>
              ⟳
            </button>
          </div>
          {audio.sources.length === 0 ? (
            <p className="hint">{t('audio.none')}</p>
          ) : (
            <div className="segments walls">
              {audio.sources.map((source) => (
                <button
                  key={source.id}
                  aria-pressed={audio.sourceId === source.id}
                  onClick={() => audio.selectSource(source.id)}
                  title={source.name}
                >
                  {source.description}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          className="button"
          data-actif={audio.active}
          disabled={audio.sourceId === null}
          onClick={toggle}
        >
          {audio.active ? t('audio.stop') : t('audio.start')}
        </button>

        <div className="group">
          <div className="label">
            {t('audio.mode')}
            <b>{t(`audio.mode.${audio.settings.mode}` as MessageKey)}</b>
          </div>
          <div className="segments">
            {AUDIO_MODES.map((mode) => (
              <button
                key={mode}
                aria-pressed={audio.settings.mode === mode}
                onClick={() => audio.setSettings({ mode })}
              >
                {t(`audio.mode.${mode}` as MessageKey)}
              </button>
            ))}
          </div>
          <p className="hint">{t(`audio.mode.${audio.settings.mode}.help` as MessageKey)}</p>
        </div>

        {SLIDERS.map(({ key, label, min, max, step }) => (
          <div className="group" key={key}>
            <div className="label">
              {t(label)}
              <b>{audio.settings[key].toFixed(2)}</b>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={audio.settings[key]}
              onChange={(event) => audio.setSettings({ [key]: Number(event.target.value) })}
            />
          </div>
        ))}

        <p className="hint">{t('audio.help')}</p>

        {audio.error !== null && <p className="error">{translateError(audio.error, t)}</p>}
      </aside>
    </section>
  )
}
