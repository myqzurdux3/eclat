import { describe, expect, it } from 'vitest'
import { SourceArbiter } from './arbiter'

function clock() {
  let value = 0
  return { now: () => value, advance: (ms: number) => { value += ms } }
}

describe('SourceArbiter', () => {
  it('picks nobody when no source is active', () => {
    expect(new SourceArbiter().current()).toBeNull()
  })

  it('picks the only active source', () => {
    const arbiter = new SourceArbiter()
    arbiter.activate('audio')

    expect(arbiter.current()).toBe('audio')
  })

  it('puts screen ahead of audio', () => {
    const arbiter = new SourceArbiter()
    arbiter.activate('audio')
    arbiter.activate('screen')

    expect(arbiter.current()).toBe('screen')
  })

  it('hands back to audio when screen stops', () => {
    const arbiter = new SourceArbiter()
    arbiter.activate('audio')
    arbiter.activate('screen')

    arbiter.deactivate('screen')

    expect(arbiter.current()).toBe('audio')
  })

  it('gives manual painting priority for 3 s', () => {
    const time = clock()
    const arbiter = new SourceArbiter({ now: time.now })
    arbiter.activate('screen')

    arbiter.touchManual()
    expect(arbiter.current()).toBe('manual')

    time.advance(2999)
    expect(arbiter.current()).toBe('manual')
  })

  it('releases the manual override once the delay is past', () => {
    const time = clock()
    const arbiter = new SourceArbiter({ now: time.now })
    arbiter.activate('screen')
    arbiter.touchManual()

    time.advance(3000)

    expect(arbiter.current()).toBe('screen')
  })

  it('extends the override on every new stroke', () => {
    const time = clock()
    const arbiter = new SourceArbiter({ now: time.now })
    arbiter.activate('screen')

    arbiter.touchManual()
    time.advance(2000)
    arbiter.touchManual()
    time.advance(2000)

    expect(arbiter.current()).toBe('manual')
  })

  it('leaves the device to its effect when the manual override expires alone', () => {
    const time = clock()
    const arbiter = new SourceArbiter({ now: time.now })
    arbiter.touchManual()

    time.advance(3000)

    expect(arbiter.current()).toBeNull()
  })

  it('accepts only the elected source', () => {
    const arbiter = new SourceArbiter()
    arbiter.activate('screen')
    arbiter.activate('audio')

    expect(arbiter.accepts('screen')).toBe(true)
    expect(arbiter.accepts('audio')).toBe(false)
    expect(arbiter.accepts('manual')).toBe(false)
  })

  it('forgets everything after a reset', () => {
    const arbiter = new SourceArbiter()
    arbiter.activate('screen')
    arbiter.touchManual()

    arbiter.reset()

    expect(arbiter.current()).toBeNull()
  })
})
