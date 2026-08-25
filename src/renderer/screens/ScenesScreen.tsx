import type { EffectPalette } from '../../shared/types'
import type { NanoleafSession } from '../useNanoleaf'
import { useT } from '../i18n'

/** A horizontal gradient built from the effect's real palette. */
function gradient(palette: EffectPalette): string {
  if (palette.colors.length === 0) return '#17171c'
  if (palette.colors.length === 1) {
    const { r, g, b } = palette.colors[0]!
    return `rgb(${r}, ${g}, ${b})`
  }

  const stops = palette.colors.map((color, index) => {
    const position = (index / (palette.colors.length - 1)) * 100
    return `rgb(${color.r}, ${color.g}, ${color.b}) ${position.toFixed(1)}%`
  })
  return `linear-gradient(120deg, ${stops.join(', ')})`
}

export function ScenesScreen({ session }: { session: NanoleafSession }) {
  const t = useT()

  if (session.palettes.length === 0) {
    return (
      <section className="stage-grid">
        <p className="empty-state">
          {session.device?.paired === true ? t('scenes.empty') : t('scenes.unpaired')}
        </p>
      </section>
    )
  }

  return (
    <section className="stage-grid">
      {session.palettes.map((palette) => (
        <button
          key={palette.name}
          className="thumb"
          aria-current={session.state?.effect === palette.name}
          disabled={session.busy}
          onClick={() => session.selectEffect(palette.name)}
        >
          <div style={{ height: 90, background: gradient(palette) }} />
          <span>{palette.name}</span>
        </button>
      ))}
    </section>
  )
}
