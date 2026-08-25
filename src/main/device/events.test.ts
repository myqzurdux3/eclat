import { describe, expect, it } from 'vitest'
import { parseEventBlock } from './events'

describe('parseEventBlock', () => {
  it('lit un changement de luminosité', () => {
    expect(parseEventBlock('1', '{"events":[{"attr":2,"value":60}]}')).toEqual([
      { deviceId: '', kind: 'brightness', value: 60 },
    ])
  })

  it('lit un changement d allumage', () => {
    expect(parseEventBlock('1', '{"events":[{"attr":1,"value":false}]}')).toEqual([
      { deviceId: '', kind: 'on', value: false },
    ])
  })

  it('lit un changement d effet', () => {
    expect(parseEventBlock('3', '{"events":[{"attr":1,"value":"Prism"}]}')).toEqual([
      { deviceId: '', kind: 'effect', value: 'Prism' },
    ])
  })

  it('lit plusieurs événements d un même bloc', () => {
    const evenements = parseEventBlock(
      '1',
      '{"events":[{"attr":2,"value":60},{"attr":3,"value":210}]}',
    )

    expect(evenements.map((e) => e.kind)).toEqual(['brightness', 'hue'])
  })

  it('signale un changement de layout', () => {
    expect(parseEventBlock('2', '{"events":[{"attr":1,"value":1}]}')[0]?.kind).toBe('layout')
  })

  it('ignore un attribut inconnu', () => {
    expect(parseEventBlock('1', '{"events":[{"attr":99,"value":1}]}')).toEqual([])
  })

  it('ignore une catégorie qui ne nous concerne pas', () => {
    expect(parseEventBlock('4', '{"events":[{"panelId":1,"gesture":0}]}')).toEqual([])
  })

  it('ignore un attribut d effet autre que le nom', () => {
    expect(parseEventBlock('3', '{"events":[{"attr":2,"value":"x"}]}')).toEqual([])
  })

  it('encaisse un JSON illisible', () => {
    expect(parseEventBlock('1', 'pas du json')).toEqual([])
  })

  it('encaisse un bloc sans événements', () => {
    expect(parseEventBlock('1', '{}')).toEqual([])
  })

  it('ignore une valeur absente', () => {
    expect(parseEventBlock('1', '{"events":[{"attr":2}]}')).toEqual([])
  })
})
