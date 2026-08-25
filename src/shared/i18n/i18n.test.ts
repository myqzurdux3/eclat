import { describe, expect, it } from 'vitest'
import { createTranslate, en, fr, matchLocale, type MessageKey } from './index'
import { translateError } from './errors'

describe('dictionnaires', () => {
  it('couvrent exactement les mêmes clés', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort())
  })

  it('ne laissent aucune traduction vide', () => {
    for (const [cle, valeur] of Object.entries(en)) {
      expect(valeur.trim(), `en.${cle}`).not.toBe('')
    }
    for (const [cle, valeur] of Object.entries(fr)) {
      expect(valeur.trim(), `fr.${cle}`).not.toBe('')
    }
  })

  it('emploient les mêmes paramètres de part et d autre', () => {
    const parametres = (texte: string) => (texte.match(/\{(\w+)\}/g) ?? []).sort()

    for (const cle of Object.keys(fr) as MessageKey[]) {
      expect(parametres(en[cle]), `clé ${cle}`).toEqual(parametres(fr[cle]))
    }
  })
})

describe('createTranslate', () => {
  it('rend la chaîne de la langue demandée', () => {
    expect(createTranslate('en')('control.discover')).toBe('Discover')
    expect(createTranslate('fr')('control.discover')).toBe('Découvrir')
  })

  it('substitue les paramètres nommés', () => {
    expect(createTranslate('en')('control.panels', { count: 9 })).toBe('9 panels')
  })

  it('substitue toutes les occurrences d un paramètre', () => {
    const traduire = createTranslate('fr')

    expect(traduire('control.found.title', { name: 'Shapes' })).toBe('Shapes trouvé')
  })

  it('laisse le modèle intact sans paramètres', () => {
    expect(createTranslate('en')('control.panels')).toBe('{count} panels')
  })

  it('rend la clé telle quelle si elle est inconnue', () => {
    expect(createTranslate('en')('clé.inexistante' as MessageKey)).toBe('clé.inexistante')
  })
})

describe('matchLocale', () => {
  it('reconnaît une préférence régionale', () => {
    expect(matchLocale(['fr-FR'])).toBe('fr')
    expect(matchLocale(['en-GB'])).toBe('en')
  })

  it('retient la première préférence connue', () => {
    expect(matchLocale(['de-DE', 'en-US', 'fr-FR'])).toBe('en')
  })

  it('retombe sur le français faute de mieux', () => {
    expect(matchLocale(['de', 'it'])).toBe('fr')
    expect(matchLocale([])).toBe('fr')
  })
})

describe('translateError', () => {
  const t = createTranslate('en')

  it('traduit une erreur porteuse de clé', () => {
    expect(translateError('[error.deviceUnpaired] Device non appairé : Shapes', t)).toBe(
      'Device not paired: start pairing.',
    )
  })

  it('retrouve la clé même après le préambule d Electron', () => {
    const brut =
      "Error invoking remote method 'devices:getState': NanoleafError: [error.unreachable] Device injoignable"

    expect(translateError(brut, t)).toBe('Device unreachable on the network.')
  })

  it('rend le message brut quand aucune clé n est présente', () => {
    expect(translateError('Quelque chose a cassé', t)).toBe('Quelque chose a cassé')
  })

  it('rend le message brut quand la clé est inconnue', () => {
    expect(translateError('[error.inventee] Bidule', t)).toBe('[error.inventee] Bidule')
  })
})
