import { en } from './en'
import { fr, type Dictionary } from './fr'

export type Locale = 'fr' | 'en'
export type MessageKey = keyof Dictionary

export const LOCALES: Array<{ value: Locale; label: string }> = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
]

const DICTIONNAIRES: Record<Locale, Dictionary> = { fr, en }

/** Traducteur : une clé, des paramètres nommés, une chaîne. */
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

/**
 * Construit le traducteur d'une langue.
 *
 * Les paramètres sont substitués par nom — `{count}` — plutôt que par
 * position : l'ordre des mots change d'une langue à l'autre, une
 * substitution positionnelle finirait par mentir.
 */
export function createTranslate(locale: Locale): Translate {
  const dictionnaire = DICTIONNAIRES[locale] ?? fr

  return (key, params) => {
    const modele = dictionnaire[key] ?? fr[key] ?? key
    if (params === undefined) return modele

    return Object.entries(params).reduce(
      (texte, [nom, valeur]) => texte.split(`{${nom}}`).join(String(valeur)),
      modele,
    )
  }
}

/** Langue à retenir d'une préférence de navigateur, français par défaut. */
export function matchLocale(preferences: readonly string[]): Locale {
  for (const preference of preferences) {
    const racine = preference.toLowerCase().split('-')[0]
    if (racine === 'fr' || racine === 'en') return racine
  }
  return 'fr'
}

export { en, fr }
export type { Dictionary }
