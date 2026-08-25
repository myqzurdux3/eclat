import { describe, expect, it } from 'vitest'
import { createTranslate, en, fr, matchLocale, type MessageKey } from './index'
import { translateError } from './errors'

describe('dictionaries', () => {
  it('cover exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort())
  })

  it('leave no translation empty', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), `en.${key}`).not.toBe('')
    }
    for (const [key, value] of Object.entries(fr)) {
      expect(value.trim(), `fr.${key}`).not.toBe('')
    }
  })

  it('use the same parameters on both sides', () => {
    const parameters = (text: string) => (text.match(/\{(\w+)\}/g) ?? []).sort()

    for (const key of Object.keys(fr) as MessageKey[]) {
      expect(parameters(en[key]), `key ${key}`).toEqual(parameters(fr[key]))
    }
  })
})

describe('createTranslate', () => {
  it('returns the string for the requested locale', () => {
    expect(createTranslate('en')('control.discover')).toBe('Discover')
    expect(createTranslate('fr')('control.discover')).toBe('Découvrir')
  })

  it('substitutes named parameters', () => {
    expect(createTranslate('en')('control.panels', { count: 9 })).toBe('9 panels')
  })

  it('substitutes every occurrence of a parameter', () => {
    const translate = createTranslate('fr')

    expect(translate('control.found.title', { name: 'Shapes' })).toBe('Shapes trouvé')
  })

  it('leaves the template intact without parameters', () => {
    expect(createTranslate('en')('control.panels')).toBe('{count} panels')
  })

  it('returns the key as-is when it is unknown', () => {
    expect(createTranslate('en')('no.such.key' as MessageKey)).toBe('no.such.key')
  })
})

describe('matchLocale', () => {
  it('recognises a regional preference', () => {
    expect(matchLocale(['fr-FR'])).toBe('fr')
    expect(matchLocale(['en-GB'])).toBe('en')
  })

  it('keeps the first known preference', () => {
    expect(matchLocale(['de-DE', 'en-US', 'fr-FR'])).toBe('en')
  })

  it('falls back to French for want of better', () => {
    expect(matchLocale(['de', 'it'])).toBe('fr')
    expect(matchLocale([])).toBe('fr')
  })
})

describe('translateError', () => {
  const t = createTranslate('en')

  it('translates an error that carries a key', () => {
    expect(translateError('[error.deviceUnpaired] Device non appairé : Shapes', t)).toBe(
      'Device not paired: start pairing.',
    )
  })

  it('finds the key even behind Electron’s preamble', () => {
    const raw =
      "Error invoking remote method 'devices:getState': NanoleafError: [error.unreachable] Device injoignable"

    expect(translateError(raw, t)).toBe('Device unreachable on the network.')
  })

  it('returns the raw message when no key is present', () => {
    expect(translateError('Quelque chose a cassé', t)).toBe('Quelque chose a cassé')
  })

  it('returns the raw message when the key is unknown', () => {
    expect(translateError('[error.inventee] Bidule', t)).toBe('[error.inventee] Bidule')
  })
})
