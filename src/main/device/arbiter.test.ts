import { describe, expect, it } from 'vitest'
import { SourceArbiter } from './arbiter'

function clock() {
  let value = 0
  return { now: () => value, advance: (ms: number) => { value += ms } }
}

describe('SourceArbiter', () => {
  it('ne désigne personne quand aucune source n est active', () => {
    expect(new SourceArbiter().current()).toBeNull()
  })

  it('désigne la seule source active', () => {
    const arbiter = new SourceArbiter()
    arbiter.activate('audio')

    expect(arbiter.current()).toBe('audio')
  })

  it('donne l écran devant l audio', () => {
    const arbiter = new SourceArbiter()
    arbiter.activate('audio')
    arbiter.activate('screen')

    expect(arbiter.current()).toBe('screen')
  })

  it('rend la main à l audio quand l écran s arrête', () => {
    const arbiter = new SourceArbiter()
    arbiter.activate('audio')
    arbiter.activate('screen')

    arbiter.deactivate('screen')

    expect(arbiter.current()).toBe('audio')
  })

  it('donne la priorité à la peinture manuelle pendant 3 s', () => {
    const time = clock()
    const arbiter = new SourceArbiter({ now: time.now })
    arbiter.activate('screen')

    arbiter.touchManual()
    expect(arbiter.current()).toBe('manual')

    time.advance(2999)
    expect(arbiter.current()).toBe('manual')
  })

  it('relâche l override manuel passé le délai', () => {
    const time = clock()
    const arbiter = new SourceArbiter({ now: time.now })
    arbiter.activate('screen')
    arbiter.touchManual()

    time.advance(3000)

    expect(arbiter.current()).toBe('screen')
  })

  it('prolonge l override à chaque nouvelle peinture', () => {
    const time = clock()
    const arbiter = new SourceArbiter({ now: time.now })
    arbiter.activate('screen')

    arbiter.touchManual()
    time.advance(2000)
    arbiter.touchManual()
    time.advance(2000)

    expect(arbiter.current()).toBe('manual')
  })

  it('laisse le device à son effet quand l override manuel expire seul', () => {
    const time = clock()
    const arbiter = new SourceArbiter({ now: time.now })
    arbiter.touchManual()

    time.advance(3000)

    expect(arbiter.current()).toBeNull()
  })

  it('n accepte que la source élue', () => {
    const arbiter = new SourceArbiter()
    arbiter.activate('screen')
    arbiter.activate('audio')

    expect(arbiter.accepts('screen')).toBe(true)
    expect(arbiter.accepts('audio')).toBe(false)
    expect(arbiter.accepts('manual')).toBe(false)
  })

  it('oublie tout après reset', () => {
    const arbiter = new SourceArbiter()
    arbiter.activate('screen')
    arbiter.touchManual()

    arbiter.reset()

    expect(arbiter.current()).toBeNull()
  })
})
