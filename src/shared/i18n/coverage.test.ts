import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fr, type MessageKey } from './index'

const ROOT = join(__dirname, '..', '..')

/** Every source file, tests excluded: they must not stand in for a real use. */
function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sources(path)
    if (!/\.tsx?$/.test(entry) || entry.includes('.test.')) return []
    if (path.includes(join('shared', 'i18n'))) return []
    return [path]
  })
}

const CODE = sources(ROOT)
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')

const errorKeys = (Object.keys(fr) as MessageKey[]).filter((key) => key.startsWith('error.'))

describe('error keys', () => {
  /**
   * An orphan key is a bug that shows up only in the other language: the code
   * throws a hard-coded string, the dictionary translates a key nobody emits,
   * and the user reads the wrong language. This exact bug shipped once.
   */
  it.each(errorKeys)('%s is emitted somewhere in the code', (key) => {
    // Either handed to `NanoleafError` as a typed key, or written into a
    // message by hand — the renderer has no `NanoleafError` to lean on.
    expect(CODE.includes(`'${key}'`) || CODE.includes(`[${key}]`)).toBe(true)
  })

  it('never emits a bracketed key that the dictionary does not know', () => {
    const emitted = [...CODE.matchAll(/\[(error\.[A-Za-z]+)\]/g)].map((match) => match[1]!)

    expect([...new Set(emitted)].filter((key) => !(key in fr))).toEqual([])
  })
})
