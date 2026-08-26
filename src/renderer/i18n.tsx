import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import {
  createTranslate,
  matchLocale,
  type Locale,
  type Translate,
} from '../shared/i18n'
import { readText, writeText } from './storage'

const LOCALE_KEY = 'eclat.locale'

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translate
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

/** The remembered locale, else the system's, else French. */
function readLocale(): Locale {
  const stored = readText(LOCALE_KEY)
  if (stored === 'fr' || stored === 'en') return stored
  return matchLocale(typeof navigator === 'undefined' ? [] : navigator.languages)
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readLocale)

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    writeText(LOCALE_KEY, next)
    document.documentElement.lang = next
  }, [])

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t: createTranslate(locale) }),
    [locale, setLocale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext)
  if (context === null) throw new Error('useLocale used outside LocaleProvider')
  return context
}

/** A shortcut for components that only need to translate. */
export function useT(): Translate {
  return useLocale().t
}
