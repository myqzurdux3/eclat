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

/** Instant delay: tests must not actually wait. */
const noSleep = () => Promise.resolve()

describe('pairDevice', () => {
  it('returns the token when the device is in pairing mode', async () => {
    device.pairingMode = true

    const token = await pairDevice({
      ip: '127.0.0.1',
      port: device.port,
      sleep: noSleep,
    })

    expect(token).toBe('tok-abc')
  })

  it('retries until the button is held', async () => {
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

  it('gives up after the allotted number of attempts', async () => {
    await expect(
      pairDevice({ ip: '127.0.0.1', port: device.port, attempts: 3, sleep: noSleep }),
    ).rejects.toBeInstanceOf(NanoleafError)

    const pairingCalls = device.requests.filter((r) => r.path === '/api/v1/new')
    expect(pairingCalls).toHaveLength(3)
  })

  it('stops on an abort signal', async () => {
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
    ).rejects.toThrow(/cancelled/i)
  })

  it('reports status 0 when the device is unreachable', async () => {
    // Create a server, grab its port, then close it to obtain a free port
    // where nothing is listening.
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

  it('reports the HTTP status when the device refused', async () => {
    try {
      await pairDevice({ ip: '127.0.0.1', port: device.port, attempts: 2, sleep: noSleep })
      expect.fail('Should have thrown NanoleafError')
    } catch (error) {
      expect(error).toBeInstanceOf(NanoleafError)
      expect((error as NanoleafError).status).toBe(403)
    }
  })
})
