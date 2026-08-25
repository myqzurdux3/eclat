import { describe, expect, it } from 'vitest'
import { discoverDevices, type MdnsBrowser, type MdnsFactory, type MdnsService } from './discovery'

/** Fabrique mDNS de test : rejoue une liste de services à l abonnement. */
function fakeFactory(services: MdnsService[]): MdnsFactory & { stopped: () => boolean } {
  let stopped = false
  return {
    stopped: () => stopped,
    browse(): MdnsBrowser {
      return {
        on(_event, listener) {
          for (const service of services) listener(service)
        },
        stop() {
          stopped = true
        },
      }
    },
  }
}

const service = (over: Partial<MdnsService> = {}): MdnsService => ({
  name: 'Shapes Salon',
  host: 'shapes.local',
  addresses: ['fe80::1', '192.168.1.42'],
  port: 16021,
  txt: { md: 'NL42', srcvers: '4.6.2' },
  ...over,
})

describe('discoverDevices', () => {
  it('convertit un service en DeviceInfo en retenant l adresse IPv4', async () => {
    const factory = fakeFactory([service()])

    const devices = await discoverDevices(factory, { timeoutMs: 0, sleep: () => Promise.resolve() })

    expect(devices).toEqual([
      {
        id: 'Shapes Salon',
        name: 'Shapes Salon',
        ip: '192.168.1.42',
        port: 16021,
        model: 'NL42',
        firmware: '4.6.2',
      },
    ])
  })

  it('déduplique les annonces répétées', async () => {
    const factory = fakeFactory([service(), service(), service({ name: 'Autre' })])

    const devices = await discoverDevices(factory, { timeoutMs: 0, sleep: () => Promise.resolve() })

    expect(devices).toHaveLength(2)
  })

  it('ignore un service sans adresse IPv4', async () => {
    const factory = fakeFactory([service({ addresses: ['fe80::1'] })])

    const devices = await discoverDevices(factory, { timeoutMs: 0, sleep: () => Promise.resolve() })

    expect(devices).toEqual([])
  })

  it('tolère l absence de TXT records', async () => {
    const factory = fakeFactory([service({ txt: undefined })])

    const devices = await discoverDevices(factory, { timeoutMs: 0, sleep: () => Promise.resolve() })

    expect(devices[0]!.model).toBeUndefined()
    expect(devices[0]!.firmware).toBeUndefined()
  })

  it('arrête le browser à la fin', async () => {
    const factory = fakeFactory([service()])

    await discoverDevices(factory, { timeoutMs: 0, sleep: () => Promise.resolve() })

    expect(factory.stopped()).toBe(true)
  })
})
