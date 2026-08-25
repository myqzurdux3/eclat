import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import {
  createTranslate,
  matchLocale,
  type Locale,
  type Translate,
} from '../shared/i18n'

const CLE_LANGUE = 'nanoleaf.langue'

interface Contexte {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translate
}

const LangueContext = createContext<Contexte | null>(null)

/** Langue retenue, sinon celle du système, sinon le français. */
function lireLangue(): Locale {
  try {
    const stocke = localStorage.getItem(CLE_LANGUE)
    if (stocke === 'fr' || stocke === 'en') return stocke
  } catch {
    // Stockage indisponible : on retombe sur la préférence système.
  }
  return matchLocale(typeof navigator === 'undefined' ? [] : navigator.languages)
}

export function LangueProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(lireLangue)

  const setLocale = useCallback((suivante: Locale) => {
    setLocaleState(suivante)
    try {
      localStorage.setItem(CLE_LANGUE, suivante)
    } catch {
      // Stockage indisponible : le choix vaut pour cette session.
    }
    document.documentElement.lang = suivante
  }, [])

  const valeur = useMemo<Contexte>(
    () => ({ locale, setLocale, t: createTranslate(locale) }),
    [locale, setLocale],
  )

  return <LangueContext.Provider value={valeur}>{children}</LangueContext.Provider>
}

export function useLangue(): Contexte {
  const contexte = useContext(LangueContext)
  if (contexte === null) throw new Error('useLangue hors de LangueProvider')
  return contexte
}

/** Raccourci pour les composants qui n'ont besoin que de traduire. */
export function useT(): Translate {
  return useLangue().t
}
