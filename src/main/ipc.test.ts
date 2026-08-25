import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { FakeNanoleaf } from '../test-support/fake-nanoleaf'
import { DeviceService } from './ipc'
import { ConfigStore } from './store'
import type { MdnsFactory, MdnsService } from './device/discovery'

let device: FakeNanoleaf
let service: DeviceService

function fakeFactory(services: MdnsService[]): MdnsFactory {
  return {
    browse() {
      return {
        on(_event, listener) {
          for (const s of services) listener(s)
        },
        stop() {},
      }
    },
  }
}

beforeEach(async () => {
  device = new FakeNanoleaf({ token: 'tok' })
  await device.start()

  const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-ipc-'))
  service = new DeviceService({
    store: new ConfigStore(join(dir, 'config.json')),
    mdnsFactory: fakeFactory([
      {
        name: 'Shapes Salon',
        host: 'shapes.local',
        addresses: ['127.0.0.1'],
        port: device.port,
        txt: { md: 'NL42', srcvers: '4.6.2' },
      },
    ]),
    discoverTimeoutMs: 0,
    sleep: () => Promise.resolve(),
    pairAttempts: 2,
  })

  return async () => {
    await device.stop()
  }
})

describe('DeviceService', () => {
  it('découvre un device non appairé', async () => {
    const devices = await service.discover()

    expect(devices).toEqual([
      {
        id: 'Shapes Salon',
        name: 'Shapes Salon',
        ip: '127.0.0.1',
        port: device.port,
        model: 'NL42',
        firmware: '4.6.2',
        paired: false,
      },
    ])
  })

  it('n expose jamais le token au renderer', async () => {
    device.pairingMode = true
    await service.discover()

    const paired = await service.pair('Shapes Salon')

    expect(paired.paired).toBe(true)
    expect(JSON.stringify(paired)).not.toContain('tok')
  })

  it('appaire puis lit l état', async () => {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Salon')

    const state = await service.getState('Shapes Salon')

    expect(state.brightness).toBe(50)
    expect(state.on).toBe(true)
  })

  it('pilote on/off et luminosité après appairage', async () => {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Salon')

    await service.setOn('Shapes Salon', false)
    await service.setBrightness('Shapes Salon', 30)

    expect(device.state.on).toBe(false)
    expect(device.state.brightness).toBe(30)
  })

  it('renvoie une layout normalisée', async () => {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Salon')

    const layout = await service.getLayout('Shapes Salon')

    expect(layout.panels).toHaveLength(3)
  })

  it('refuse une opération sur un device non appairé', async () => {
    await service.discover()

    await expect(service.getState('Shapes Salon')).rejects.toThrow(/non appairé/i)
  })

  it('liste les devices persistés au démarrage suivant', async () => {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Salon')

    const listed = await service.listDevices()

    expect(listed).toHaveLength(1)
    expect(listed[0]!.paired).toBe(true)
  })
})
