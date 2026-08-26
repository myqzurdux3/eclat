import { describe, expect, it } from 'vitest'
import { parseEventBlock, subscribeToEvents } from './events'
import { FakeNanoleaf } from '../../test-support/fake-nanoleaf'

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
    expect(parseEventBlock('1', 'not json')).toEqual([])
  })

  it('survives a block with no events', () => {
    expect(parseEventBlock('1', '{}')).toEqual([])
  })

  it('ignores a missing value', () => {
    expect(parseEventBlock('1', '{"events":[{"attr":2}]}')).toEqual([])
  })
})

describe('subscribeToEvents — the end of a stream', () => {
  /**
   * A dead stream is indistinguishable from a quiet one. Without this signal
   * the application goes on believing it hears the device and never re-opens,
   * so a Wi-Fi blip costs it every later event for the rest of the session.
   */
  it('says so when the stream ends on its own', async () => {
    const device = new FakeNanoleaf({ token: 'tok' })
    await device.start()

    // The fake serves no `/events` route: the request is refused, which is
    // exactly how an unreachable wall ends a stream.
    const closed = new Promise<void>((resolve) => {
      subscribeToEvents({
        ip: '127.0.0.1',
        port: device.port,
        token: 'tok',
        deviceId: 'Shapes',
        onEvent: () => undefined,
        onClosed: resolve,
      })
    })

    await closed
    await device.stop()
  })

  it('stays silent when the caller closes it', async () => {
    const device = new FakeNanoleaf({ token: 'tok' })
    await device.start()

    let closedItself = false
    subscribeToEvents({
      ip: '127.0.0.1',
      port: device.port,
      token: 'tok',
      deviceId: 'Shapes',
      onEvent: () => undefined,
      onClosed: () => {
        closedItself = true
      },
    }).close()

    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(closedItself).toBe(false)
    await device.stop()
  })
})
