import { ColorWheel } from '../components/ColorWheel'
import { WallCanvas } from '../components/WallCanvas'
import { hsbToRgb } from '../../shared/color'
import type { NanoleafSession } from '../useNanoleaf'

export function ControlScreen({ session }: { session: NanoleafSession }) {
  const { device, state, layout } = session

  if (device === undefined) {
    return (
      <section className="controle">
        <div className="verre">
          <p>Aucun device connu.</p>
          <button disabled={session.busy} onClick={session.discover}>
            Découvrir
          </button>
        </div>
      </section>
    )
  }

  if (!device.paired) {
    return (
      <section className="controle">
        <div className="verre">
          <p>{device.name} trouvé, pas encore appairé.</p>
          <p style={{ color: 'var(--discret)' }}>
            Maintiens le bouton power du panneau 5 à 7 secondes, puis lance l&apos;appairage.
          </p>
          <button disabled={session.busy} onClick={session.pair}>
            Appairer
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="controle">
      {layout === null ? (
        <div />
      ) : (
        <WallCanvas
          layout={layout}
          colors={session.colors}
          onPaint={(panelId) =>
            session.paint(panelId, hsbToRgb(state?.hue ?? 0, state?.sat ?? 100, 100))
          }
        />
      )}

      <aside className="verre" style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <strong style={{ fontSize: 15 }}>{device.name}</strong>
          <span style={{ color: 'var(--discret)', fontSize: 12 }}>
            {layout?.panels.length ?? 0} panneaux
          </span>
        </div>

        <button
          disabled={session.busy || state === null}
          onClick={() => session.setOn(!(state?.on ?? false))}
        >
          {state?.on === true ? 'Éteindre' : 'Allumer'}
        </button>

        <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          Luminosité {state?.brightness ?? 0} %
          <input
            type="range"
            min={0}
            max={100}
            value={state?.brightness ?? 0}
            onChange={(event) => session.setBrightness(Number(event.target.value))}
          />
        </label>

        <ColorWheel
          hue={state?.hue ?? 0}
          sat={state?.sat ?? 0}
          size={220}
          onPick={({ hue, sat }) => session.setColor(Math.round(hue), Math.round(sat))}
        />

        <p style={{ margin: 0, color: 'var(--discret)', fontSize: 12, lineHeight: 1.5 }}>
          Clique un panneau pour le peindre de la couleur choisie. La peinture garde la main
          pendant 3 secondes, puis le device reprend son effet.
        </p>

        {session.error !== null && <p style={{ color: '#ff6b6b' }}>{session.error}</p>}
      </aside>
    </section>
  )
}
