import { beforeEach, describe, expect, it } from 'vitest'
import { EXT_CONTROL_EFFECT } from '../../shared/types'
import { FakeNanoleaf } from '../../test-support/fake-nanoleaf'
import { FakeStreamReceiver } from '../../test-support/fake-stream'
import { NanoleafClient } from './client'
import { RateGovernor } from './rate'
import { PanelStream, type SchedulerLike } from './stream'

/** A manual scheduler: the re-arm probe fires on demand. */
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
 * The probe is fired without being awaited: it chains two HTTP round
 * trips, so the result has to be polled rather than yielding once.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Condition never met')
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
  it('arms External Control v2', async () => {
    await stream.arm()

    expect(stream.armed).toBe(true)
    expect(device.extControlVersion).toBe('v2')
  })

  it('sends nothing until the mode is armed', async () => {
    expect(stream.send(red)).toBe(false)
    expect(receiver.frames).toEqual([])
  })

  it('sends a decodable frame once armed', async () => {
    await stream.arm()

    expect(stream.send(red)).toBe(true)

    const [frame] = await receiver.waitForFrames(1)
    expect(frame).toEqual({ transitionTime: 1, panels: red })
  })

  it('refuses a frame that comes too soon', async () => {
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

  it('re-arms when another source has taken over', async () => {
    await stream.arm()
    device.state.effect = 'Northern Lights'
    device.extControlVersion = null

    await stream.probe()

    expect(device.extControlVersion).toBe('v2')
    expect(device.state.effect).toBe(EXT_CONTROL_EFFECT)
  })

  it('does not re-arm while the mode still holds', async () => {
    await stream.arm()
    const armCount = device.requests.filter((r) => r.path.endsWith('/effects')).length

    await stream.probe()

    expect(device.requests.filter((r) => r.path.endsWith('/effects'))).toHaveLength(armCount)
  })

  it('wires the probe onto the scheduler', async () => {
    await stream.arm()
    device.state.effect = 'Forest'
    device.extControlVersion = null

    scheduler.fire()
    await waitFor(() => device.extControlVersion === 'v2')

    expect(device.extControlVersion).toBe('v2')
  })

  it('restores the effect and the on/off state on stop', async () => {
    device.state.effect = 'Forest'
    device.state.on = true
    await stream.arm()
    expect(device.state.effect).toBe(EXT_CONTROL_EFFECT)

    await stream.stop()

    expect(stream.armed).toBe(false)
    expect(device.state.effect).toBe('Forest')
    expect(device.state.on).toBe(true)
  })

  it('switches back on a device that was on before arming', async () => {
    device.state.on = true
    await stream.arm()
    device.state.on = false

    await stream.stop()

    expect(device.state.on).toBe(true)
  })

  it('tolerates a repeated stop', async () => {
    await stream.arm()

    await stream.stop()
    await expect(stream.stop()).resolves.toBeUndefined()
  })

  it('does not overwrite the saved state when arming twice', async () => {
    device.state.effect = 'Forest'
    await stream.arm()
    await stream.arm()

    await stream.stop()

    expect(device.state.effect).toBe('Forest')
  })
})
