import type { DeviceInfo } from '../../shared/types'

export interface MdnsService {
  name: string
  host: string
  addresses?: string[]
  port: number
  txt?: Record<string, string>
}

export interface MdnsBrowser {
  on(event: 'up', listener: (service: MdnsService) => void): void
  stop(): void
}

export interface MdnsFactory {
  browse(): MdnsBrowser
}

export interface DiscoverOptions {
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Collecte les contrôleurs Nanoleaf annoncés en mDNS pendant la fenêtre
 * indiquée, puis arrête le browser.
 */
export async function discoverDevices(
  factory: MdnsFactory,
  options: DiscoverOptions = {},
): Promise<DeviceInfo[]> {
  const timeoutMs = options.timeoutMs ?? 3000
  const sleep = options.sleep ?? defaultSleep

  const found = new Map<string, DeviceInfo>()
  const browser = factory.browse()

  browser.on('up', (service) => {
    const ip = service.addresses?.find((address) => IPV4.test(address))
    if (ip === undefined) return

    found.set(service.name, {
      id: service.name,
      name: service.name,
      ip,
      port: service.port,
      model: service.txt?.md,
      firmware: service.txt?.srcvers,
    })
  })

  try {
    await sleep(timeoutMs)
  } finally {
    browser.stop()
  }

  return [...found.values()]
}
