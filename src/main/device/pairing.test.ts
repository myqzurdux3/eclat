import { createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeNanoleaf } from '../../test-support/fake-nanoleaf'
import { NanoleafError } from './errors'
import { pairDevice } from './pairing'

let device: FakeNanoleaf

beforeEach(async () => {
  device = new FakeNanoleaf({ token: 'tok-abc' })
  await device.start()
})

afterEach(async () => {
  await device.stop()
})

/** Temporisation instantanée : les tests ne doivent pas attendre réellement. */
const noSleep = () => Promise.resolve()

describe('pairDevice', () => {
  it('renvoie le token quand le device est en mode appairage', async () => {
    device.pairingMode = true

    const token = await pairDevice({
      ip: '127.0.0.1',
      port: device.port,
      sleep: noSleep,
    })

    expect(token).toBe('tok-abc')
  })

  it('réessaie jusqu à ce que le bouton soit maintenu', async () => {
    const sleep = vi.fn(async () => {
      if (device.requests.length >= 3) device.pairingMode = true
    })

    const token = await pairDevice({
      ip: '127.0.0.1',
      port: device.port,
      attempts: 10,
      sleep,
    })

    expect(token).toBe('tok-abc')
    expect(sleep).toHaveBeenCalled()
  })

  it('abandonne après le nombre d essais imparti', async () => {
    await expect(
      pairDevice({ ip: '127.0.0.1', port: device.port, attempts: 3, sleep: noSleep }),
    ).rejects.toBeInstanceOf(NanoleafError)

    const pairingCalls = device.requests.filter((r) => r.path === '/api/v1/new')
    expect(pairingCalls).toHaveLength(3)
  })

  it('s interrompt sur signal d annulation', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      pairDevice({
        ip: '127.0.0.1',
        port: device.port,
        attempts: 10,
        sleep: noSleep,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/annul/i)
  })

  it('rapporte status 0 si le device est injoignable', async () => {
    // Créer un serveur, récupérer son port, puis le fermer
    // pour obtenir un port libre où rien n'écoute.
    const tempServer = createServer()
    await new Promise<void>((resolve) => tempServer.listen(0, '127.0.0.1', resolve))
    const closedPort = (tempServer.address() as any).port
    await new Promise<void>((resolve) => tempServer.close(() => resolve()))

    try {
      await pairDevice({
        ip: '127.0.0.1',
        port: closedPort,
        attempts: 2,
        sleep: noSleep,
      })
      expect.fail('Should have thrown NanoleafError')
    } catch (error) {
      expect(error).toBeInstanceOf(NanoleafError)
      expect((error as NanoleafError).status).toBe(0)
    }
  })

  it('rapporte le status HTTP si le device a refusé', async () => {
    try {
      await pairDevice({ ip: '127.0.0.1', port: device.port, attempts: 2, sleep: noSleep })
      expect.fail('Should have thrown NanoleafError')
    } catch (error) {
      expect(error).toBeInstanceOf(NanoleafError)
      expect((error as NanoleafError).status).toBe(403)
    }
  })
})
