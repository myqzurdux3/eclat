import { afterEach, describe, expect, it } from 'vitest'
import { FakeNanoleaf } from './fake-nanoleaf'

let device: FakeNanoleaf | undefined

afterEach(async () => {
  await device?.stop()
  device = undefined
})

const base = (d: FakeNanoleaf) => `http://127.0.0.1:${d.port}`

describe('FakeNanoleaf', () => {
  it('refuses pairing outside pairing mode', async () => {
    device = new FakeNanoleaf()
    await device.start()

    const res = await fetch(`${base(device)}/api/v1/new`, { method: 'POST' })

    expect(res.status).toBe(403)
  })

  it('hands over a token while in pairing mode', async () => {
    device = new FakeNanoleaf({ token: 'tok-123' })
    await device.start()
    device.pairingMode = true

    const res = await fetch(`${base(device)}/api/v1/new`, { method: 'POST' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ auth_token: 'tok-123' })
  })

  it('rejette un token inconnu', async () => {
    device = new FakeNanoleaf({ token: 'bon' })
    await device.start()

    const res = await fetch(`${base(device)}/api/v1/mauvais/`)

    expect(res.status).toBe(401)
  })

  it('serves the full state', async () => {
    device = new FakeNanoleaf({ token: 'tok' })
    await device.start()

    const res = await fetch(`${base(device)}/api/v1/tok/`)
    const body = (await res.json()) as any

    expect(res.status).toBe(200)
    expect(body.state.on.value).toBe(true)
    expect(body.state.brightness.value).toBe(50)
    expect(body.panelLayout.layout.numPanels).toBeGreaterThan(0)
  })

  it('applies a PUT /state and records the request', async () => {
    device = new FakeNanoleaf({ token: 'tok' })
    await device.start()

    const res = await fetch(`${base(device)}/api/v1/tok/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brightness: { value: 80 } }),
    })

    expect(res.status).toBe(204)
    expect(device.state.brightness).toBe(80)
    expect(device.requests.at(-1)).toEqual({
      method: 'PUT',
      path: '/api/v1/tok/state',
      body: { brightness: { value: 80 } },
    })
  })

  it('serves the effect list and applies a selection', async () => {
    device = new FakeNanoleaf({ token: 'tok' })
    await device.start()
    device.effects = ['Nemo', 'Northern Lights']

    const list = await fetch(`${base(device)}/api/v1/tok/effects/effectsList`)
    expect(await list.json()).toEqual(['Nemo', 'Northern Lights'])

    await fetch(`${base(device)}/api/v1/tok/effects`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ select: 'Nemo' }),
    })
    expect(device.state.effect).toBe('Nemo')
  })

  it('sert la layout des panneaux', async () => {
    device = new FakeNanoleaf({
      token: 'tok',
      positionData: [{ panelId: 42, x: 0, y: 0, o: 0, shapeType: 7 }],
    })
    await device.start()

    const res = await fetch(`${base(device)}/api/v1/tok/panelLayout/layout`)
    const body = (await res.json()) as any

    expect(body.numPanels).toBe(1)
    expect(body.positionData[0].panelId).toBe(42)
  })
})
