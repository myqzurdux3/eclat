import { en } from './en'
import { fr, type Dictionary } from './fr'

export type Locale = 'fr' | 'en'
export type MessageKey = keyof Dictionary

export const LOCALES: Array<{ value: Locale; label: string }> = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
]

const DICTIONARIES: Record<Locale, Dictionary> = { fr, en }

/** A translator: a key, named parameters, a string. */
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

/**
 * Builds the translator for one locale.
 *
 * Parameters are substituted by name — `{count}` — rather than by position:
 * word order changes from one language to the next, and positional
 * substitution would eventually lie.
 */
export function createTranslate(locale: Locale): Translate {
  const dictionary = DICTIONARIES[locale] ?? fr

  return (key, params) => {
    const template = dictionary[key] ?? fr[key] ?? key
    if (params === undefined) return template

    return Object.entries(params).reduce(
      (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
      template,
    )
  }
}

/** The locale to keep from a browser preference; French by default. */
export function matchLocale(preferences: readonly string[]): Locale {
  for (const preference of preferences) {
    const root = preference.toLowerCase().split('-')[0]
    if (root === 'fr' || root === 'en') return root
  }
  return 'fr'
}

export { en, fr }
export type { Dictionary }
