import { ColorWheel } from '../components/ColorWheel'
import { WallCanvas } from '../components/WallCanvas'
import { hsbToRgb } from '../../shared/color'
import type { NanoleafSession } from '../useNanoleaf'

const ROTATIONS = [
  { turns: 0, libelle: '0°' },
  { turns: 1, libelle: '90°' },
  { turns: 2, libelle: '180°' },
  { turns: 3, libelle: '270°' },
]

function Accueil({ session }: { session: NanoleafSession }) {
  const { device } = session

  return (
    <section className="controle" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <div
        className="verre"
        style={{ display: 'grid', gap: 14, placeContent: 'center', textAlign: 'center' }}
      >
        {device === undefined ? (
          <>
            <strong style={{ fontSize: 17 }}>Aucun device connu</strong>
            <p className="aide">Les panneaux s&apos;annoncent en mDNS sur le réseau local.</p>
            <button className="bouton" disabled={session.busy} onClick={session.discover}>
              Découvrir
            </button>
          </>
        ) : (
          <>
            <strong style={{ fontSize: 17 }}>{device.name} trouvé</strong>
            <p className="aide" style={{ maxWidth: 320 }}>
              Maintiens le bouton power du panneau 5 à 7 secondes, jusqu&apos;à ce que la LED
              clignote, puis lance l&apos;appairage.
            </p>
            <button className="bouton" disabled={session.busy} onClick={session.pair}>
              Appairer
            </button>
          </>
        )}
        {session.error !== null && <p className="erreur">{session.error}</p>}
      </div>
    </section>
  )
}

export function ControlScreen({ session }: { session: NanoleafSession }) {
  const { device, state, layout } = session

  if (device === undefined || !device.paired) return <Accueil session={session} />

  const pinceau = hsbToRgb(state?.hue ?? 0, state?.sat ?? 100, 100)

  return (
    <section className="controle">
      {layout === null ? (
        <div className="scene" />
      ) : (
        <WallCanvas
          layout={layout}
          colors={session.colors}
          onPaint={(panelId) => session.paint(panelId, pinceau)}
        />
      )}

      <aside className="verre panneau-lateral">
        <div className="titre-device">
          <strong>{device.name}</strong>
          <span>
            {layout?.panels.length ?? 0} panneaux
            {device.firmware === undefined ? '' : ` · firmware ${device.firmware}`}
          </span>
        </div>

        <button
          className="bouton"
          data-actif={state?.on === true}
          disabled={session.busy || state === null}
          onClick={() => session.setOn(!(state?.on ?? false))}
        >
          {state?.on === true ? 'Éteindre' : 'Allumer'}
        </button>

        <div className="groupe">
          <div className="etiquette">
            Luminosité <b>{state?.brightness ?? 0} %</b>
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
            Couleur
            <b>
              {Math.round(state?.hue ?? 0)}° · {Math.round(state?.sat ?? 0)} %
            </b>
          </div>
          <ColorWheel
            hue={state?.hue ?? 0}
            sat={state?.sat ?? 0}
            size={200}
            onPick={({ hue, sat }) => session.setColor(Math.round(hue), Math.round(sat))}
          />
        </div>

        <div className="groupe">
          <div className="etiquette">Orientation du mur</div>
          <div className="segments">
            {ROTATIONS.map(({ turns, libelle }) => (
              <button
                key={turns}
                aria-pressed={session.rotation === turns}
                onClick={() => session.setRotation(turns)}
              >
                {libelle}
              </button>
            ))}
          </div>
          <p className="aide">
            Le device ne dit pas comment le mur est accroché.
          </p>
        </div>

        <p className="aide">
          Clique un panneau du mur pour le peindre de la couleur choisie.
        </p>

        {session.error !== null && <p className="erreur">{session.error}</p>}
      </aside>
    </section>
  )
}
