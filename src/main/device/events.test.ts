import { describe, expect, it } from 'vitest'
import { parseEventBlock } from './events'

describe('parseEventBlock', () => {
  it('reads a brightness change', () => {
    expect(parseEventBlock('1', '{"events":[{"attr":2,"value":60}]}')).toEqual([
      { deviceId: '', kind: 'brightness', value: 60 },
    ])
  })

  it('reads a power change', () => {
    expect(parseEventBlock('1', '{"events":[{"attr":1,"value":false}]}')).toEqual([
      { deviceId: '', kind: 'on', value: false },
    ])
  })

  it('reads an effect change', () => {
    expect(parseEventBlock('3', '{"events":[{"attr":1,"value":"Prism"}]}')).toEqual([
      { deviceId: '', kind: 'effect', value: 'Prism' },
    ])
  })

  it('reads several events from one block', () => {
    const evenements = parseEventBlock(
      '1',
      '{"events":[{"attr":2,"value":60},{"attr":3,"value":210}]}',
    )

    expect(evenements.map((e) => e.kind)).toEqual(['brightness', 'hue'])
  })

  it('reports a layout change', () => {
    expect(parseEventBlock('2', '{"events":[{"attr":1,"value":1}]}')[0]?.kind).toBe('layout')
  })

  it('ignores an unknown attribute', () => {
    expect(parseEventBlock('1', '{"events":[{"attr":99,"value":1}]}')).toEqual([])
  })

  it('ignores a category we do not care about', () => {
    expect(parseEventBlock('4', '{"events":[{"panelId":1,"gesture":0}]}')).toEqual([])
  })

  it('ignores an effect attribute other than the name', () => {
    expect(parseEventBlock('3', '{"events":[{"attr":2,"value":"x"}]}')).toEqual([])
  })

  it('survives unreadable JSON', () => {
    expect(parseEventBlock('1', 'pas du json')).toEqual([])
  })

  it('survives a block with no events', () => {
    expect(parseEventBlock('1', '{}')).toEqual([])
  })

  it('ignores a missing value', () => {
    expect(parseEventBlock('1', '{"events":[{"attr":2}]}')).toEqual([])
  })
})
