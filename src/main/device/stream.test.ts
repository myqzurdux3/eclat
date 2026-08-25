import { beforeEach, describe, expect, it } from 'vitest'
import { EXT_CONTROL_EFFECT } from '../../shared/types'
import { FakeNanoleaf } from '../../test-support/fake-nanoleaf'
import { FakeStreamReceiver } from '../../test-support/fake-stream'
import { NanoleafClient } from './client'
import { RateGovernor } from './rate'
import { PanelStream, type SchedulerLike } from './stream'

/** Ordonnanceur manuel : la sonde de réarmement se déclenche à la demande. */
function fakeScheduler(): SchedulerLike & { fire: () => void } {
  let handler: (() => void) | null = null
  return {
    setInterval(fn) {
      handler = fn
      return 1
    },
    clearInterval() {
      handler = null
    },
    fire() {
      handler?.()
    },
  }
}

function clock() {
  let value = 0
  return { now: () => value, advance: (ms: number) => { value += ms } }
}

/**
 * La sonde est déclenchée sans être attendue : elle enchaîne deux
 * allers-retours HTTP, il faut donc sonder le résultat plutôt que céder la
 * main une seule fois.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Condition jamais atteinte')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

let device: FakeNanoleaf
let receiver: FakeStreamReceiver
let scheduler: ReturnType<typeof fakeScheduler>
let stream: PanelStream

const red = [{ panelId: 1, color: { r: 255, g: 0, b: 0 } }]

beforeEach(async () => {
  device = new FakeNanoleaf({ token: 'tok' })
  await device.start()
  device.state.effect = 'Nemo'
  device.state.on = true

  receiver = new FakeStreamReceiver()
  await receiver.start()

  scheduler = fakeScheduler()
  stream = new PanelStream({
    client: new NanoleafClient({ ip: '127.0.0.1', token: 'tok', port: device.port }),
    ip: '127.0.0.1',
    port: receiver.port,
    scheduler,
  })

  return async () => {
    await stream.stop()
    await receiver.stop()
    await device.stop()
  }
})

describe('PanelStream', () => {
  it('arme le mode External Control v2', async () => {
    await stream.arm()

    expect(stream.armed).toBe(true)
    expect(device.extControlVersion).toBe('v2')
  })

  it('n émet rien tant que le mode n est pas armé', async () => {
    expect(stream.send(red)).toBe(false)
    expect(receiver.frames).toEqual([])
  })

  it('émet une trame décodable une fois armé', async () => {
    await stream.arm()

    expect(stream.send(red)).toBe(true)

    const [frame] = await receiver.waitForFrames(1)
    expect(frame).toEqual({ transitionTime: 1, panels: red })
  })

  it('refuse une trame trop rapprochée', async () => {
    const time = clock()
    stream = new PanelStream({
      client: new NanoleafClient({ ip: '127.0.0.1', token: 'tok', port: device.port }),
      ip: '127.0.0.1',
      port: receiver.port,
      scheduler,
      governor: new RateGovernor({ targetHz: 30, now: time.now }),
    })
    await stream.arm()

    expect(stream.send(red)).toBe(true)
    expect(stream.send(red)).toBe(false)

    time.advance(40)
    expect(stream.send(red)).toBe(true)
  })

  it('réarme quand une autre source a repris la main', async () => {
    await stream.arm()
    device.state.effect = 'Northern Lights'
    device.extControlVersion = null

    await stream.probe()

    expect(device.extControlVersion).toBe('v2')
    expect(device.state.effect).toBe(EXT_CONTROL_EFFECT)
  })

  it('ne réarme pas si le mode tient toujours', async () => {
    await stream.arm()
    const armCount = device.requests.filter((r) => r.path.endsWith('/effects')).length

    await stream.probe()

    expect(device.requests.filter((r) => r.path.endsWith('/effects'))).toHaveLength(armCount)
  })

  it('branche la sonde sur l ordonnanceur', async () => {
    await stream.arm()
    device.state.effect = 'Forest'
    device.extControlVersion = null

    scheduler.fire()
    await waitFor(() => device.extControlVersion === 'v2')

    expect(device.extControlVersion).toBe('v2')
  })

  it('restaure l effet et l état on/off à l arrêt', async () => {
    device.state.effect = 'Forest'
    device.state.on = true
    await stream.arm()
    expect(device.state.effect).toBe(EXT_CONTROL_EFFECT)

    await stream.stop()

    expect(stream.armed).toBe(false)
    expect(device.state.effect).toBe('Forest')
    expect(device.state.on).toBe(true)
  })

  it('rallume un device qui était allumé avant l armement', async () => {
    device.state.on = true
    await stream.arm()
    device.state.on = false

    await stream.stop()

    expect(device.state.on).toBe(true)
  })

  it('supporte un arrêt répété', async () => {
    await stream.arm()

    await stream.stop()
    await expect(stream.stop()).resolves.toBeUndefined()
  })

  it('ne réécrase pas l état sauvegardé si on arme deux fois', async () => {
    device.state.effect = 'Forest'
    await stream.arm()
    await stream.arm()

    await stream.stop()

    expect(device.state.effect).toBe('Forest')
  })
})
