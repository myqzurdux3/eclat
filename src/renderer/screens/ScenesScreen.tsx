import type { EffectPalette } from '../../shared/types'
import type { NanoleafSession } from '../useNanoleaf'
import { useT } from '../i18n'

/** Dégradé horizontal bâti sur la palette réelle de l'effet. */
function degrade(palette: EffectPalette): string {
  if (palette.colors.length === 0) return '#17171c'
  if (palette.colors.length === 1) {
    const { r, g, b } = palette.colors[0]!
    return `rgb(${r}, ${g}, ${b})`
  }

  const arrets = palette.colors.map((color, index) => {
    const position = (index / (palette.colors.length - 1)) * 100
    return `rgb(${color.r}, ${color.g}, ${color.b}) ${position.toFixed(1)}%`
  })
  return `linear-gradient(120deg, ${arrets.join(', ')})`
}

export function ScenesScreen({ session }: { session: NanoleafSession }) {
  const t = useT()

  if (session.palettes.length === 0) {
    return (
      <section className="grille-scenes">
        <p className="etat-vide">
          {session.device?.paired === true ? t('scenes.empty') : t('scenes.unpaired')}
        </p>
      </section>
    )
  }

  return (
    <section className="grille-scenes">
      {session.palettes.map((palette) => (
        <button
          key={palette.name}
          className="vignette"
          aria-current={session.state?.effect === palette.name}
          disabled={session.busy}
          onClick={() => session.selectEffect(palette.name)}
        >
          <div style={{ height: 90, background: degrade(palette) }} />
          <span>{palette.name}</span>
        </button>
      ))}
    </section>
  )
}
