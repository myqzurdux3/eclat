import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeNanoleaf } from '../../test-support/fake-nanoleaf'
import { NanoleafClient } from './client'
import { NanoleafError } from './errors'

let device: FakeNanoleaf
let client: NanoleafClient

beforeEach(async () => {
  device = new FakeNanoleaf({ token: 'tok' })
  await device.start()
  client = new NanoleafClient({ ip: '127.0.0.1', token: 'tok', port: device.port })
})

afterEach(async () => {
  await device.stop()
})

describe('NanoleafClient', () => {
  it('reads the state and flattens it', async () => {
    const state = await client.getState()

    expect(state).toEqual({
      on: true,
      brightness: 50,
      hue: 120,
      sat: 80,
      ct: 4000,
      colorMode: 'effect',
      effect: 'Nemo',
    })
  })

  it('reads the device information', async () => {
    const info = await client.getInfo()

    expect(info).toEqual({
      name: 'Fake Shapes',
      model: 'NL42',
      firmware: '4.6.2',
      serial: 'FAKE0001',
    })
  })

  it('switches the device off', async () => {
    await client.setOn(false)

    expect(device.state.on).toBe(false)
    expect(device.requests.at(-1)!.body).toEqual({ on: { value: false } })
  })

  it('sets brightness with a transition duration', async () => {
    await client.setBrightness(80, 2)

    expect(device.state.brightness).toBe(80)
    expect(device.requests.at(-1)!.body).toEqual({ brightness: { value: 80, duration: 2 } })
  })

  it('bounds brightness within [0,100]', async () => {
    await client.setBrightness(150)

    expect(device.state.brightness).toBe(100)
  })

  it('sets hue, saturation and temperature', async () => {
    await client.setHue(200)
    await client.setSat(65)
    await client.setColorTemp(3000)

    expect(device.state.hue).toBe(200)
    expect(device.state.sat).toBe(65)
    expect(device.state.ct).toBe(3000)
  })

  it('lists and selects an effect', async () => {
    const effects = await client.getEffects()
    expect(effects).toContain('Northern Lights')

    await client.selectEffect('Northern Lights')
    expect(device.state.effect).toBe('Northern Lights')
  })

  it('returns a normalised layout', async () => {
    const layout = await client.getLayout()

    expect(layout.sideLength).toBe(67)
    expect(layout.panels).toHaveLength(3)
    for (const panel of layout.panels) {
      expect(panel.nx).toBeGreaterThanOrEqual(0)
      expect(panel.nx).toBeLessThanOrEqual(1)
      expect(panel.ny).toBeGreaterThanOrEqual(0)
      expect(panel.ny).toBeLessThanOrEqual(1)
    }
  })

  it('raises a NanoleafError on an invalid token', async () => {
    const wrong = new NanoleafClient({ ip: '127.0.0.1', token: 'faux', port: device.port })

    await expect(wrong.getState()).rejects.toBeInstanceOf(NanoleafError)
    await expect(wrong.getState()).rejects.toMatchObject({ status: 401 })
  })
})
