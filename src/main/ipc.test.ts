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
        name: 'Shapes Lounge',
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
  it('discovers an unpaired device', async () => {
    const devices = await service.discover()

    expect(devices).toEqual([
      {
        id: 'Shapes Lounge',
        name: 'Shapes Lounge',
        ip: '127.0.0.1',
        port: device.port,
        model: 'NL42',
        firmware: '4.6.2',
        paired: false,
      },
    ])
  })

  it('never exposes the token to the renderer', async () => {
    device.pairingMode = true
    await service.discover()

    const paired = await service.pair('Shapes Lounge')

    expect(paired.paired).toBe(true)
    expect(JSON.stringify(paired)).not.toContain('tok')
  })

  it('pairs, then reads the state', async () => {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Lounge')

    const state = await service.getState('Shapes Lounge')

    expect(state.brightness).toBe(50)
    expect(state.on).toBe(true)
  })

  it('drives on/off and brightness after pairing', async () => {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Lounge')

    await service.setOn('Shapes Lounge', false)
    await service.setBrightness('Shapes Lounge', 30)

    expect(device.state.on).toBe(false)
    expect(device.state.brightness).toBe(30)
  })

  it('returns a normalised layout', async () => {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Lounge')

    const layout = await service.getLayout('Shapes Lounge')

    expect(layout.panels).toHaveLength(3)
  })

  it('refuses an operation on an unpaired device', async () => {
    await service.discover()

    await expect(service.getState('Shapes Lounge')).rejects.toThrow(/not paired/i)
  })

  it('lists the persisted devices on the next start', async () => {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Lounge')

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
    await service.pair('Shapes Lounge')
    return 'Shapes Lounge'
  }

  beforeEach(async () => {
    receiver = new FakeStreamReceiver()
    await receiver.start()

    const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-stream-'))
    service = new DeviceService({
      store: new ConfigStore(join(dir, 'config.json')),
      mdnsFactory: fakeFactory([
        {
          name: 'Shapes Lounge',
          host: 'shapes.local',
          addresses: ['127.0.0.1'],
          port: device.port,
          txt: { md: 'NL42', srcvers: '4.6.2' },
        },
      ]),
      discoverTimeoutMs: 0,
      sleep: () => Promise.resolve(),
      pairAttempts: 2,
      // The re-arm probe is neutralised: these tests do not cover it, that
      // is `stream.test.ts`'s job.
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

  it('arms the device when the stream starts', async () => {
    const id = await paired()

    await service.startStream(id, 'screen')

    expect(device.extControlVersion).toBe('v2')
    expect(device.state.effect).toBe(EXT_CONTROL_EFFECT)
  })

  it('sends a frame covering every panel in the layout', async () => {
    const id = await paired()
    await service.startStream(id, 'screen')

    expect(await service.sendFrame(id, 'screen', [{ r: 255, g: 0, b: 0 }])).toBe(true)

    const [frame] = await receiver.waitForFrames(1)
    expect(frame!.panels.map((p) => p.panelId)).toEqual([1, 2, 3])
    expect(frame!.panels[2]!.color).toEqual({ r: 255, g: 0, b: 0 })
  })

  it('refuses a frame from a source that was not elected', async () => {
    const id = await paired()
    await service.startStream(id, 'screen')
    await service.startStream(id, 'audio')

    expect(await service.sendFrame(id, 'audio', [{ r: 1, g: 1, b: 1 }])).toBe(false)
  })

  it('gives control to manual painting', async () => {
    const id = await paired()
    await service.startStream(id, 'screen')

    expect(await service.sendFrame(id, 'manual', [{ r: 0, g: 255, b: 0 }])).toBe(true)
    expect(await service.sendFrame(id, 'screen', [{ r: 255, g: 0, b: 0 }])).toBe(false)
  })

  it('refuses a frame with no stream armed', async () => {
    const id = await paired()

    expect(await service.sendFrame(id, 'screen', [{ r: 1, g: 1, b: 1 }])).toBe(false)
  })

  it('restores the effect when the stream stops', async () => {
    const id = await paired()
    device.state.effect = 'Forest'
    await service.startStream(id, 'screen')

    await service.stopStream(id, 'screen')

    expect(device.state.effect).toBe('Forest')
  })

  it('keeps the stream armed while another source is writing', async () => {
    const id = await paired()
    device.state.effect = 'Forest'
    await service.startStream(id, 'screen')
    await service.startStream(id, 'audio')

    await service.stopStream(id, 'screen')

    expect(device.state.effect).toBe(EXT_CONTROL_EFFECT)
    expect(await service.sendFrame(id, 'audio', [{ r: 1, g: 1, b: 1 }])).toBe(true)
  })

  it('restores everything when the application exits', async () => {
    const id = await paired()
    device.state.effect = 'Forest'
    await service.startStream(id, 'screen')

    await service.shutdown()

    expect(device.state.effect).toBe('Forest')
  })
})

describe('DeviceService — palettes', () => {
  it('returns the palettes converted to RGB', async () => {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Lounge')

    const palettes = await service.getEffectPalettes('Shapes Lounge')

    expect(palettes).toHaveLength(3)
    expect(palettes[1]).toEqual({
      name: 'Northern Lights',
      colors: [{ r: 0, g: 230, b: 77 }],
    })
  })

  it('tolerates an effect with no palette', async () => {
    device.pairingMode = true
    device.effects = ['Vide']
    device.palettes = {}
    await service.discover()
    await service.pair('Shapes Lounge')

    expect(await service.getEffectPalettes('Shapes Lounge')).toEqual([
      { name: 'Vide', colors: [] },
    ])
  })
})

describe('DeviceService — a device that is switched off', () => {
  let store: ConfigStore

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-absent-'))
    store = new ConfigStore(join(dir, 'config.json'))
    service = new DeviceService({
      store,
      mdnsFactory: fakeFactory([]),
      discoverTimeoutMs: 0,
      sleep: () => Promise.resolve(),
      probeTimeoutMs: 200,
    })
  })

  /**
   * A wall at the wrong end of a switched-off socket answers nothing. Listing
   * it invites the user to drive a device that cannot hear them, and every
   * command they try ends on a timeout.
   */
  it('leaves an unreachable wall out of the list', async () => {
    await store.upsertDevice({
      id: 'Ghost',
      name: 'Ghost',
      // Port 1 is closed and privileged: the connection is refused at once.
      ip: '127.0.0.1',
      port: 1,
      token: 'tok',
    })

    expect(await service.listDevices()).toEqual([])
  })

  it('lists a wall that answers', async () => {
    await store.upsertDevice({
      id: 'Shapes Lounge',
      name: 'Shapes Lounge',
      ip: '127.0.0.1',
      port: device.port,
      token: 'tok',
    })

    expect((await service.listDevices()).map((entry) => entry.id)).toEqual(['Shapes Lounge'])
  })

  /**
   * The pairing survives: a token is only obtained by holding the power
   * button, so throwing it away over a power cut would make every switch-off
   * cost the user that dance again.
   */
  it('keeps the pairing so the wall comes back on its own', async () => {
    await store.upsertDevice({
      id: 'Ghost',
      name: 'Ghost',
      ip: '127.0.0.1',
      port: 1,
      token: 'tok',
    })
    await service.listDevices()

    expect((await store.load()).devices['Ghost']?.token).toBe('tok')
  })
})

describe('DeviceService — manual painting', () => {
  let receiver: FakeStreamReceiver

  beforeEach(async () => {
    receiver = new FakeStreamReceiver()
    await receiver.start()

    const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-paint-'))
    service = new DeviceService({
      store: new ConfigStore(join(dir, 'config.json')),
      mdnsFactory: fakeFactory([
        {
          name: 'Shapes Lounge',
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
    await service.pair('Shapes Lounge')

    return async () => {
      await service.shutdown()
      await receiver.stop()
    }
  })

  it('arms the stream by itself on the first click', async () => {
    expect(await service.paintPanel('Shapes Lounge', 2, { r: 255, g: 0, b: 0 })).toBe(true)

    expect(device.extControlVersion).toBe('v2')
  })

  it('paints only the targeted panel, the others stay off', async () => {
    await service.paintPanel('Shapes Lounge', 2, { r: 255, g: 0, b: 0 })

    const [frame] = await receiver.waitForFrames(1)
    expect(frame!.panels).toEqual([
      { panelId: 1, color: { r: 0, g: 0, b: 0 } },
      { panelId: 2, color: { r: 255, g: 0, b: 0 } },
      { panelId: 3, color: { r: 0, g: 0, b: 0 } },
    ])
  })

  it('keeps the panels already painted', async () => {
    await service.paintPanel('Shapes Lounge', 1, { r: 255, g: 0, b: 0 })
    await new Promise((resolve) => setTimeout(resolve, 40))
    await service.paintPanel('Shapes Lounge', 3, { r: 0, g: 0, b: 255 })

    const frames = await receiver.waitForFrames(2)
    expect(frames[1]!.panels[0]!.color).toEqual({ r: 255, g: 0, b: 0 })
    expect(frames[1]!.panels[2]!.color).toEqual({ r: 0, g: 0, b: 255 })
  })

  it('forgets the painting on shutdown', async () => {
    await service.paintPanel('Shapes Lounge', 1, { r: 255, g: 0, b: 0 })

    await service.shutdown()

    expect(device.state.effect).toBe('Nemo')
  })

  it('sets hue and saturation over REST', async () => {
    await service.setColor('Shapes Lounge', 200, 80)

    expect(device.state.hue).toBe(200)
    expect(device.state.sat).toBe(80)
  })
})

describe('DeviceService — releasing external control', () => {
  let receiver: FakeStreamReceiver

  beforeEach(async () => {
    receiver = new FakeStreamReceiver()
    await receiver.start()

    const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-release-'))
    service = new DeviceService({
      store: new ConfigStore(join(dir, 'config.json')),
      mdnsFactory: fakeFactory([
        {
          name: 'Shapes Lounge',
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
    await service.pair('Shapes Lounge')

    return async () => {
      await service.shutdown()
      await receiver.stop()
    }
  })

  /**
   * Waits well past the old three-second deadline's worth of event-loop
   * turns: nothing may take the wall back on its own any more.
   */
  async function fire(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 60))
  }

  /**
   * A click on a panel is a request for light. On an off wall external
   * control lights nothing at all, so the click has to switch the power on
   * before it can mean anything.
   */
  it('switches an off wall on before painting it', async () => {
    device.state.on = false

    await service.paintPanel('Shapes Lounge', 1, { r: 255, g: 0, b: 0 })

    expect(device.state.on).toBe(true)
  })

  /** And nothing may undo it afterwards: the wall stays lit. */
  it('leaves the wall on after painting it from off', async () => {
    device.state.on = false
    device.state.effect = 'Forest'

    await service.paintPanel('Shapes Lounge', 1, { r: 255, g: 0, b: 0 })

    expect(device.state.on).toBe(true)
  })

  /**
   * Recolouring a selection has to arrive as one frame. Sent panel by panel
   * the rate governor refuses all but the first, and the wall ends up
   * showing half the change.
   */
  it('paints a whole selection in a single frame', async () => {
    expect(
      await service.paintPanels('Shapes Lounge', [
        { panelId: 1, color: { r: 255, g: 0, b: 0 } },
        { panelId: 2, color: { r: 255, g: 0, b: 0 } },
      ]),
    ).toBe(true)

    const frames = await receiver.waitForFrames(1)

    expect(frames).toHaveLength(1)
  })

  /**
   * The rate governor caps the stream at 30 Hz, and refuses anything closer.
   * A click is not a stream frame: dropping it loses a deliberate action and
   * the panel simply never lights. Two clicks in the same breath must both
   * reach the wall.
   */
  it('lands a click the rate governor would have refused', async () => {
    await service.paintPanel('Shapes Lounge', 1, { r: 255, g: 0, b: 0 })
    await service.paintPanel('Shapes Lounge', 2, { r: 0, g: 255, b: 0 })

    const frames = await receiver.waitForFrames(2)
    const painted = new Map(frames.at(-1)!.panels.map((panel) => [panel.panelId, panel.color]))

    expect(painted.get(2)).toEqual({ r: 0, g: 255, b: 0 })
  })

  /**
   * Dragging the wheel writes as fast as the pointer moves. Making each
   * write wait out the governor's interval before returning turned the drag
   * into a stutter: the caller has to come straight back, and the frame the
   * governor refused is sent on its own.
   */
  it('returns at once when the governor refuses, and sends the frame after', async () => {
    await service.paintPanel('Shapes Lounge', 1, { r: 255, g: 0, b: 0 })
    await receiver.waitForFrames(1)

    const started = process.hrtime.bigint()
    await service.paintPanel('Shapes Lounge', 2, { r: 0, g: 255, b: 0 })
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

    expect(elapsedMs).toBeLessThan(20)

    const frames = await receiver.waitForFrames(2)
    const painted = new Map(frames.at(-1)!.panels.map((panel) => [panel.panelId, panel.color]))
    expect(painted.get(2)).toEqual({ r: 0, g: 255, b: 0 })
  })

  it('keeps the panels painted earlier when a selection is recoloured', async () => {
    await service.paintPanel('Shapes Lounge', 1, { r: 0, g: 255, b: 0 })
    await receiver.waitForFrames(1)
    await fire()

    await service.paintPanels('Shapes Lounge', [{ panelId: 2, color: { r: 255, g: 0, b: 0 } }])
    const frames = await receiver.waitForFrames(2)

    const painted = new Map(
      frames.at(-1)!.panels.map((panel) => [panel.panelId, panel.color]),
    )
    expect(painted.get(1)).toEqual({ r: 0, g: 255, b: 0 })
    expect(painted.get(2)).toEqual({ r: 255, g: 0, b: 0 })
  })

  /**
   * The stream used to be filed before it was usable. A wall that went quiet
   * between the two left an unarmed stream in the map with no panel ids, and
   * every later click took the "already streaming" branch and did nothing —
   * for the rest of the session.
   */
  it('files no stream when arming it fails', async () => {
    const port = device.port
    await device.stop()

    await expect(service.paintPanel('Shapes Lounge', 1, { r: 255, g: 0, b: 0 })).rejects.toThrow()

    await device.start(port)
    expect(await service.paintPanel('Shapes Lounge', 1, { r: 255, g: 0, b: 0 })).toBe(true)
  })

  /**
   * The power was only ever checked while arming the stream. Now that
   * painting holds the wall, the stream is already there and the check never
   * ran: clicking a panel on a wall switched off lit it on screen and left
   * the room dark.
   */
  it('switches the wall back on when a panel is clicked after a power cut', async () => {
    await service.paintPanel('Shapes Lounge', 1, { r: 255, g: 0, b: 0 })
    await service.setOn('Shapes Lounge', false)

    await service.paintPanel('Shapes Lounge', 2, { r: 0, g: 255, b: 0 })

    expect(device.state.on).toBe(true)
  })

  /**
   * And switching the wall back on by hand has to bring the painting with
   * it: the panels were chosen, the power cut them, and nothing else would
   * ever send them again.
   */
  it('broadcasts the painting again when the wall is switched back on', async () => {
    await service.paintPanel('Shapes Lounge', 1, { r: 255, g: 0, b: 0 })
    await receiver.waitForFrames(1)

    await service.setOn('Shapes Lounge', false)
    await service.setOn('Shapes Lounge', true)

    const frames = await receiver.waitForFrames(2)
    const painted = new Map(frames.at(-1)!.panels.map((panel) => [panel.panelId, panel.color]))

    expect(device.state.on).toBe(true)
    expect(painted.get(1)).toEqual({ r: 255, g: 0, b: 0 })
  })

  /**
   * Painting used to expire on a three-second deadline, which read as the
   * wall wiping itself moments after being painted. A panel the user lit
   * stays lit; handing the wall back is something they ask for.
   */
  it('keeps the painting until something else takes the wall', async () => {
    device.state.effect = 'Forest'
    await service.paintPanel('Shapes Lounge', 1, { r: 255, g: 0, b: 0 })

    await fire()

    expect(device.state.effect).toBe(EXT_CONTROL_EFFECT)
    expect(device.extControlVersion).toBe('v2')
    expect(await service.sendFrame('Shapes Lounge', 'manual', [{ r: 0, g: 255, b: 0 }])).toBe(true)
  })

  /**
   * The counterpart to holding on: the probe re-arms external control every
   * ten seconds, so a stream nobody lets go of overwrites whatever the phone
   * app or the physical button chooses. The device's own announcement is the
   * signal to stand down.
   */
  it('lets go when the device announces an effect of its own', async () => {
    await service.paintPanel('Shapes Lounge', 1, { r: 255, g: 0, b: 0 })
    expect(device.extControlVersion).toBe('v2')

    // The announcement follows the change: by the time it reaches us the
    // device has already dropped external control for the new effect.
    device.state.effect = 'Northern Lights'
    device.extControlVersion = null
    await service.noteEffectChange('Shapes Lounge', 'Northern Lights')
    await fire()

    expect(await service.sendFrame('Shapes Lounge', 'manual', [{ r: 0, g: 255, b: 0 }])).toBe(false)
  })

  it('holds on when the announced effect is its own external control', async () => {
    await service.paintPanel('Shapes Lounge', 1, { r: 255, g: 0, b: 0 })

    await service.noteEffectChange('Shapes Lounge', EXT_CONTROL_EFFECT)
    await fire()

    expect(await service.sendFrame('Shapes Lounge', 'manual', [{ r: 0, g: 255, b: 0 }])).toBe(true)
  })

  /**
   * The stream saves the power state it found and puts it back on release.
   * Cutting the power in between makes that saved value a lie: the release
   * would light the wall the user just switched off.
   */
  it('does not light the wall back up when the power was cut mid-stroke', async () => {
    device.state.effect = 'Forest'
    await service.paintPanel('Shapes Lounge', 1, { r: 255, g: 0, b: 0 })

    await service.setOn('Shapes Lounge', false)
    expect(device.state.on).toBe(false)

    await service.stopStream('Shapes Lounge', 'manual')

    expect(device.state.on).toBe(false)
    expect(device.state.effect).toBe('Forest')
  })

  it('hands control back to the device when a scene is chosen', async () => {
    await service.paintPanel('Shapes Lounge', 1, { r: 255, g: 0, b: 0 })
    expect(device.extControlVersion).toBe('v2')

    await service.selectEffect('Shapes Lounge', 'Northern Lights')

    expect(device.state.effect).toBe('Northern Lights')
    expect(device.extControlVersion).toBeNull()
  })

  it('also cuts a screen sync when a scene is chosen', async () => {
    await service.startStream('Shapes Lounge', 'screen')

    await service.selectEffect('Shapes Lounge', 'Forest')

    expect(device.state.effect).toBe('Forest')
    expect(await service.sendFrame('Shapes Lounge', 'screen', [{ r: 1, g: 1, b: 1 }])).toBe(false)
  })
})

describe('DeviceService — several devices', () => {
  let second: FakeNanoleaf
  let receiver: FakeStreamReceiver

  beforeEach(async () => {
    second = new FakeNanoleaf({ token: 'tok2' })
    await second.start()
    second.pairingMode = true

    receiver = new FakeStreamReceiver()
    await receiver.start()

    const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-multi-'))
    service = new DeviceService({
      store: new ConfigStore(join(dir, 'config.json')),
      mdnsFactory: fakeFactory([
        {
          name: 'Lounge',
          host: 'lounge.local',
          addresses: ['127.0.0.1'],
          port: device.port,
          txt: { md: 'NL42' },
        },
        {
          name: 'Study',
          host: 'study.local',
          addresses: ['127.0.0.1'],
          port: second.port,
          txt: { md: 'NL42' },
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

    return async () => {
      await service.shutdown()
      await receiver.stop()
      await second.stop()
    }
  })

  it('discovers both', async () => {
    expect((await service.listDevices()).map((d) => d.id).sort()).toEqual(['Lounge', 'Study'])
  })

  it('pairs both and keeps both tokens', async () => {
    await service.pair('Lounge')
    await service.pair('Study')

    const listes = await service.listDevices()

    expect(listes.filter((d) => d.paired)).toHaveLength(2)
  })

  it('arbitrates each device separately', async () => {
    await service.pair('Lounge')
    await service.pair('Study')
    await service.startStream('Lounge', 'screen')
    await service.startStream('Study', 'screen')

    // Painting in the Lounge takes control there, without muzzling the Study.
    await service.paintPanel('Lounge', 1, { r: 255, g: 0, b: 0 })

    expect(await service.sendFrame('Lounge', 'screen', [{ r: 1, g: 1, b: 1 }])).toBe(false)
    expect(await service.sendFrame('Study', 'screen', [{ r: 1, g: 1, b: 1 }])).toBe(true)
  })

  it('stops one device without touching the other', async () => {
    await service.pair('Lounge')
    await service.pair('Study')
    device.state.effect = 'Forest'
    second.state.effect = 'Jungle'
    await service.startStream('Lounge', 'screen')
    await service.startStream('Study', 'screen')

    await service.stopStream('Lounge', 'screen')

    expect(device.state.effect).toBe('Forest')
    expect(second.state.effect).toBe(EXT_CONTROL_EFFECT)
  })

  it('gives every device its effect back on shutdown', async () => {
    await service.pair('Lounge')
    await service.pair('Study')
    device.state.effect = 'Forest'
    second.state.effect = 'Jungle'
    await service.startStream('Lounge', 'screen')
    await service.startStream('Study', 'screen')

    await service.shutdown()

    expect(device.state.effect).toBe('Forest')
    expect(second.state.effect).toBe('Jungle')
  })
})

describe('DeviceService — address refresh', () => {
  it('prefers the freshly discovered address over the stored one', async () => {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Lounge')

    // The panel comes back on a different address, as DHCP does.
    const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-move-'))
    const store = new ConfigStore(join(dir, 'config.json'))
    await store.upsertDevice({
      id: 'Shapes Lounge',
      name: 'Shapes Lounge',
      ip: '10.0.0.9',
      port: 1,
      token: 'tok',
    })

    const moved = new DeviceService({
      store,
      mdnsFactory: fakeFactory([
        {
          name: 'Shapes Lounge',
          host: 'shapes.local',
          addresses: ['127.0.0.1'],
          port: device.port,
          txt: { md: 'NL42' },
        },
      ]),
      discoverTimeoutMs: 0,
      sleep: () => Promise.resolve(),
    })

    const listed = await moved.discover()

    expect(listed[0]!.ip).toBe('127.0.0.1')
    expect(listed[0]!.port).toBe(device.port)
    expect(listed[0]!.paired).toBe(true)
  })

  it('writes the new address back, so the next start finds it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-move-'))
    const store = new ConfigStore(join(dir, 'config.json'))
    await store.upsertDevice({
      id: 'Shapes Lounge',
      name: 'Shapes Lounge',
      ip: '10.0.0.9',
      port: 1,
      token: 'tok',
    })

    const moved = new DeviceService({
      store,
      mdnsFactory: fakeFactory([
        {
          name: 'Shapes Lounge',
          host: 'shapes.local',
          addresses: ['127.0.0.1'],
          port: device.port,
          txt: { md: 'NL42' },
        },
      ]),
      discoverTimeoutMs: 0,
      sleep: () => Promise.resolve(),
    })
    await moved.discover()

    expect((await store.load()).devices['Shapes Lounge']?.ip).toBe('127.0.0.1')
  })

  /**
   * mDNS is regularly deaf on Linux — avahi holds the port, a VPN owns the
   * route — and the stored address is then all there is to go on. It has to
   * survive a silent discovery pass.
   */
  it('keeps the stored address when mDNS says nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-move-'))
    const store = new ConfigStore(join(dir, 'config.json'))
    await store.upsertDevice({
      id: 'Shapes Lounge',
      name: 'Shapes Lounge',
      ip: '127.0.0.1',
      port: device.port,
      token: 'tok',
    })

    const quiet = new DeviceService({
      store,
      mdnsFactory: fakeFactory([]),
      discoverTimeoutMs: 0,
      sleep: () => Promise.resolve(),
    })

    const listed = (await quiet.listDevices())[0]!

    expect(listed.ip).toBe('127.0.0.1')
    expect(listed.port).toBe(device.port)
  })

  it('leaves the token untouched when the address moves', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-move-'))
    const store = new ConfigStore(join(dir, 'config.json'))
    await store.upsertDevice({
      id: 'Shapes Lounge',
      name: 'Shapes Lounge',
      ip: '10.0.0.9',
      port: 1,
      token: 'precious',
    })

    const moved = new DeviceService({
      store,
      mdnsFactory: fakeFactory([
        { name: 'Shapes Lounge', host: 'h', addresses: ['127.0.0.1'], port: 9, txt: {} },
      ]),
      discoverTimeoutMs: 0,
      sleep: () => Promise.resolve(),
    })
    await moved.discover()

    expect((await store.load()).devices['Shapes Lounge']?.token).toBe('precious')
  })
})
