import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { FakeNanoleaf } from '../test-support/fake-nanoleaf'
import { DeviceService } from './ipc'
import { ConfigStore } from './store'
import type { MdnsFactory, MdnsService } from './device/discovery'
import { EXT_CONTROL_EFFECT } from '../shared/types'
import { FakeStreamReceiver } from '../test-support/fake-stream'
import { PanelStream } from './device/stream'

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

describe('DeviceService — streaming', () => {
  let receiver: FakeStreamReceiver

  async function paired(): Promise<string> {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Salon')
    return 'Shapes Salon'
  }

  beforeEach(async () => {
    receiver = new FakeStreamReceiver()
    await receiver.start()

    const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-stream-'))
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
      // La sonde de réarmement est neutralisée : ces tests ne la couvrent pas,
      // c'est le rôle de `stream.test.ts`.
      streamFactory: ({ client }) =>
        new PanelStream({
          client,
          ip: '127.0.0.1',
          port: receiver.port,
          scheduler: { setInterval: () => 1, clearInterval: () => {} },
        }),
    })

    return async () => {
      await service.shutdown()
      await receiver.stop()
    }
  })

  it('arme le device au démarrage du stream', async () => {
    const id = await paired()

    await service.startStream(id, 'screen')

    expect(device.extControlVersion).toBe('v2')
    expect(device.state.effect).toBe(EXT_CONTROL_EFFECT)
  })

  it('émet une trame couvrant tous les panneaux du layout', async () => {
    const id = await paired()
    await service.startStream(id, 'screen')

    expect(await service.sendFrame(id, 'screen', [{ r: 255, g: 0, b: 0 }])).toBe(true)

    const [frame] = await receiver.waitForFrames(1)
    expect(frame!.panels.map((p) => p.panelId)).toEqual([1, 2, 3])
    expect(frame!.panels[2]!.color).toEqual({ r: 255, g: 0, b: 0 })
  })

  it('refuse la trame d une source non élue', async () => {
    const id = await paired()
    await service.startStream(id, 'screen')
    await service.startStream(id, 'audio')

    expect(await service.sendFrame(id, 'audio', [{ r: 1, g: 1, b: 1 }])).toBe(false)
  })

  it('donne la main à la peinture manuelle', async () => {
    const id = await paired()
    await service.startStream(id, 'screen')

    expect(await service.sendFrame(id, 'manual', [{ r: 0, g: 255, b: 0 }])).toBe(true)
    expect(await service.sendFrame(id, 'screen', [{ r: 255, g: 0, b: 0 }])).toBe(false)
  })

  it('refuse une trame sans stream armé', async () => {
    const id = await paired()

    expect(await service.sendFrame(id, 'screen', [{ r: 1, g: 1, b: 1 }])).toBe(false)
  })

  it('restaure l effet à l arrêt du stream', async () => {
    const id = await paired()
    device.state.effect = 'Forest'
    await service.startStream(id, 'screen')

    await service.stopStream(id, 'screen')

    expect(device.state.effect).toBe('Forest')
  })

  it('garde le stream armé tant qu une autre source écrit', async () => {
    const id = await paired()
    device.state.effect = 'Forest'
    await service.startStream(id, 'screen')
    await service.startStream(id, 'audio')

    await service.stopStream(id, 'screen')

    expect(device.state.effect).toBe(EXT_CONTROL_EFFECT)
    expect(await service.sendFrame(id, 'audio', [{ r: 1, g: 1, b: 1 }])).toBe(true)
  })

  it('restaure tout à l extinction de l application', async () => {
    const id = await paired()
    device.state.effect = 'Forest'
    await service.startStream(id, 'screen')

    await service.shutdown()

    expect(device.state.effect).toBe('Forest')
  })
})

describe('DeviceService — palettes', () => {
  it('renvoie les palettes converties en RGB', async () => {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Salon')

    const palettes = await service.getEffectPalettes('Shapes Salon')

    expect(palettes).toHaveLength(3)
    expect(palettes[1]).toEqual({
      name: 'Northern Lights',
      colors: [{ r: 0, g: 230, b: 77 }],
    })
  })

  it('tolère un effet sans palette', async () => {
    device.pairingMode = true
    device.effects = ['Vide']
    device.palettes = {}
    await service.discover()
    await service.pair('Shapes Salon')

    expect(await service.getEffectPalettes('Shapes Salon')).toEqual([
      { name: 'Vide', colors: [] },
    ])
  })
})

describe('DeviceService — peinture manuelle', () => {
  let receiver: FakeStreamReceiver

  beforeEach(async () => {
    receiver = new FakeStreamReceiver()
    await receiver.start()

    const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-paint-'))
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
      streamFactory: ({ client }) =>
        new PanelStream({
          client,
          ip: '127.0.0.1',
          port: receiver.port,
          scheduler: { setInterval: () => 1, clearInterval: () => {} },
        }),
    })

    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Salon')

    return async () => {
      await service.shutdown()
      await receiver.stop()
    }
  })

  it('arme le stream toute seule au premier clic', async () => {
    expect(await service.paintPanel('Shapes Salon', 2, { r: 255, g: 0, b: 0 })).toBe(true)

    expect(device.extControlVersion).toBe('v2')
  })

  it('ne peint que le panneau visé, les autres restent éteints', async () => {
    await service.paintPanel('Shapes Salon', 2, { r: 255, g: 0, b: 0 })

    const [frame] = await receiver.waitForFrames(1)
    expect(frame!.panels).toEqual([
      { panelId: 1, color: { r: 0, g: 0, b: 0 } },
      { panelId: 2, color: { r: 255, g: 0, b: 0 } },
      { panelId: 3, color: { r: 0, g: 0, b: 0 } },
    ])
  })

  it('conserve les panneaux déjà peints', async () => {
    await service.paintPanel('Shapes Salon', 1, { r: 255, g: 0, b: 0 })
    await new Promise((resolve) => setTimeout(resolve, 40))
    await service.paintPanel('Shapes Salon', 3, { r: 0, g: 0, b: 255 })

    const frames = await receiver.waitForFrames(2)
    expect(frames[1]!.panels[0]!.color).toEqual({ r: 255, g: 0, b: 0 })
    expect(frames[1]!.panels[2]!.color).toEqual({ r: 0, g: 0, b: 255 })
  })

  it('oublie la peinture à l extinction', async () => {
    await service.paintPanel('Shapes Salon', 1, { r: 255, g: 0, b: 0 })

    await service.shutdown()

    expect(device.state.effect).toBe('Nemo')
  })

  it('règle teinte et saturation par le REST', async () => {
    await service.setColor('Shapes Salon', 200, 80)

    expect(device.state.hue).toBe(200)
    expect(device.state.sat).toBe(80)
  })
})
