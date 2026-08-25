import { useEffect, useRef } from 'react'
import type { MappingMode } from '../../shared/sync/settings'
import type { ScreenSync } from '../useScreenSync'
import type { NanoleafSession } from '../useNanoleaf'
import { useT } from '../i18n'
import { translateError } from '../../shared/i18n/errors'
import type { MessageKey } from '../../shared/i18n'

const MODES: Array<{ value: MappingMode; key: MessageKey }> = [
  { value: 'spatial', key: 'sync.mode.spatial' },
  { value: 'dominant', key: 'sync.mode.dominant' },
  { value: 'palette', key: 'sync.mode.palette' },
]

const SETTINGS = [
  { key: 'radius', label: 'sync.radius', min: 0.05, max: 0.5, step: 0.01, unit: '' },
  { key: 'saturation', label: 'sync.saturation', min: 0.5, max: 2, step: 0.05, unit: '×' },
  { key: 'blackFloor', label: 'sync.blackFloor', min: 0, max: 0.2, step: 0.01, unit: '' },
  { key: 'attack', label: 'sync.attack', min: 0.1, max: 1, step: 0.05, unit: '' },
  { key: 'release', label: 'sync.release', min: 0.02, max: 0.5, step: 0.01, unit: '' },
  { key: 'hz', label: 'sync.hz', min: 10, max: 30, step: 1, unit: ' Hz' },
] as const satisfies ReadonlyArray<{ label: MessageKey; [k: string]: unknown }>

/** Draws the analysed image exactly as the pipeline sees it: 64x36 pixels. */
function PreviewCanvas({ sync }: { sync: ScreenSync }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const t = useT()

  useEffect(() => {
    const canvas = canvasRef.current
    const preview = sync.preview
    if (canvas === null || preview === null) return
    const context = canvas.getContext('2d')
    if (context === null) return

    canvas.width = preview.width
    canvas.height = preview.height
    context.putImageData(new ImageData(preview.data, preview.width, preview.height), 0, 0)
  }, [sync.preview])

  if (sync.preview === null) {
    return (
      <div className="preview-empty">
        <p className="hint">{t('sync.preview.empty')}</p>
      </div>
    )
  }

  return <canvas ref={canvasRef} className="preview" />
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
      <section className="stage-grid">
        <p className="empty-state">{t('sync.unpaired')}</p>
      </section>
    )
  }

  const toggle = (): void => {
    if (sync.active) {
      sync.stop()
      void session.disarmScreen()
      return
    }
    void session.armScreen().then(() => sync.start())
  }

  return (
    <section className="control">
      <div className="stage preview-frame">
        <PreviewCanvas sync={sync} />
        {sync.colors !== null &&
          [...sync.colors].map(([deviceId, couleurs]) => (
            <div className="colour-strip" key={deviceId} title={deviceId}>
              {[...couleurs.values()].map((color, index) => (
                <span
                  key={index}
                  style={{ background: `rgb(${color.r}, ${color.g}, ${color.b})` }}
                />
              ))}
            </div>
          ))}
      </div>

      <aside className="glass sidebar">
        <div className="device-title">
          <strong>{t('sync.title')}</strong>
          <span>{sync.active ? t('sync.running') : t('sync.stopped')}</span>
        </div>

        <button className="button" data-actif={sync.active} disabled={sync.starting} onClick={toggle}>
          {sync.starting ? t('sync.choosing') : sync.active ? t('sync.stop') : t('sync.choose')}
        </button>

        <div className="group">
          <div className="label">{t('sync.mode')}</div>
          <div className="segments">
            {MODES.map(({ value, key: modeKey }) => (
              <button
                key={value}
                aria-pressed={sync.settings.mode === value}
                onClick={() => sync.setSettings({ mode: value })}
              >
                {t(modeKey)}
              </button>
            ))}
          </div>
        </div>

        {SETTINGS.map(({ key, label, min, max, step, unit }) => (
          <div className="group" key={key}>
            <div className="label">
              {t(label)}
              <b>
                {key === 'hz' ? sync.settings[key] : sync.settings[key].toFixed(2)}
                {unit}
              </b>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={sync.settings[key]}
              disabled={key === 'radius' && sync.settings.mode !== 'spatial'}
              onChange={(event) => sync.setSettings({ [key]: Number(event.target.value) })}
            />
          </div>
        ))}

        <p className="hint">{t('sync.wayland.help')}</p>

        {sync.error !== null && <p className="error">{translateError(sync.error, t)}</p>}
      </aside>
    </section>
  )
}
