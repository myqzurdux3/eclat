import { describe, expect, it } from 'vitest'
import { discoverDevices, type MdnsBrowser, type MdnsFactory, type MdnsService } from './discovery'

/** A test mDNS factory: replays a list of services on subscription. */
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
  name: 'Shapes Lounge',
  host: 'shapes.local',
  addresses: ['fe80::1', '192.168.1.42'],
  port: 16021,
  txt: { md: 'NL42', srcvers: '4.6.2' },
  ...over,
})

describe('discoverDevices', () => {
  it('converts a service into a DeviceInfo, keeping the IPv4 address', async () => {
    const factory = fakeFactory([service()])

    const devices = await discoverDevices(factory, { timeoutMs: 0, sleep: () => Promise.resolve() })

    expect(devices).toEqual([
      {
        id: 'Shapes Lounge',
        name: 'Shapes Lounge',
        ip: '192.168.1.42',
        port: 16021,
        model: 'NL42',
        firmware: '4.6.2',
      },
    ])
  })

  it('deduplicates repeated announcements', async () => {
    const factory = fakeFactory([service(), service(), service({ name: 'Autre' })])

    const devices = await discoverDevices(factory, { timeoutMs: 0, sleep: () => Promise.resolve() })

    expect(devices).toHaveLength(2)
  })

  it('ignores a service with no IPv4 address', async () => {
    const factory = fakeFactory([service({ addresses: ['fe80::1'] })])

    const devices = await discoverDevices(factory, { timeoutMs: 0, sleep: () => Promise.resolve() })

    expect(devices).toEqual([])
  })

  it('tolerates the absence of TXT records', async () => {
    const factory = fakeFactory([service({ txt: undefined })])

    const devices = await discoverDevices(factory, { timeoutMs: 0, sleep: () => Promise.resolve() })

    expect(devices[0]!.model).toBeUndefined()
    expect(devices[0]!.firmware).toBeUndefined()
  })

  it('stops the browser at the end', async () => {
    const factory = fakeFactory([service()])

    await discoverDevices(factory, { timeoutMs: 0, sleep: () => Promise.resolve() })

    expect(factory.stopped()).toBe(true)
  })
})
