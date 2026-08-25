import dgram from 'node:dgram'
import os from 'node:os'
import dnsPacket from 'dns-packet'
import type { MdnsBrowser, MdnsFactory, MdnsService } from './discovery'

/** The service type advertised by Shapes, Elements and Lines controllers. */
export const SERVICE_TYPE = '_nanoleafapi._tcp.local'

const MULTICAST_ADDR = '224.0.0.251'
const MULTICAST_PORT = 5353
/** The QU bit: asks for a unicast answer rather than a multicast one (RFC 6762 §5.4). */
const UNICAST_RESPONSE = 0x8000
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

interface Record_ {
  name: string
  type: string
  data: unknown
}

interface Packet {
  answers?: unknown
  additionals?: unknown
}

/**
 * Builds a PTR query with the QU bit set.
 *
 * Port 5353 is already held by avahi-daemon on most Linux desktops, and the
 * kernel delivers the multicast answer to only one of the processes bound to
 * it. Asking for a unicast answer brings it back on our own ephemeral port,
 * with no competition.
 */
export function buildQuery(serviceType: string): Buffer {
  const query = dnsPacket.encode({
    type: 'query',
    questions: [{ name: serviceType, type: 'PTR', class: 'IN' }],
  })

  query.writeUInt16BE(UNICAST_RESPONSE | 1, query.length - 2)
  return query
}

const isRecord = (value: unknown): value is Record_ =>
  typeof value === 'object' && value !== null && 'name' in value && 'type' in value

const parseTxt = (data: unknown): Record<string, string> => {
  const entries: Record<string, string> = {}
  if (!Array.isArray(data)) return entries

  for (const item of data) {
    const text = Buffer.isBuffer(item) ? item.toString('utf8') : String(item)
    const separator = text.indexOf('=')
    if (separator > 0) entries[text.slice(0, separator)] = text.slice(separator + 1)
  }
  return entries
}

/** Rebuilds the advertised services from a decoded mDNS answer. */
export function servicesFromPacket(packet: Packet, serviceType: string): MdnsService[] {
  const answers = Array.isArray(packet.answers) ? packet.answers : []
  const additionals = Array.isArray(packet.additionals) ? packet.additionals : []
  const records = [...answers, ...additionals].filter(isRecord)

  const suffix = `.${serviceType}`
  const instances = records
    .filter((record) => record.type === 'PTR' && record.name === serviceType)
    .map((record) => String(record.data))

  const services: MdnsService[] = []

  for (const instance of new Set(instances)) {
    const srv = records.find((record) => record.type === 'SRV' && record.name === instance)
    if (srv === undefined) continue

    const { port, target } = srv.data as { port: number; target: string }
    const txt = records.find((record) => record.type === 'TXT' && record.name === instance)
    const addresses = records
      .filter((record) => record.type === 'A' && record.name === target)
      .map((record) => String(record.data))
      .filter((address) => IPV4.test(address))

    services.push({
      name: instance.endsWith(suffix) ? instance.slice(0, -suffix.length) : instance,
      host: target,
      addresses,
      port,
      txt: parseTxt(txt?.data),
    })
  }

  return services
}

/** The local IPv4 addresses to send the query from. */
function outboundAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
}

export interface MdnsFactoryOptions {
  serviceType?: string
  /** Local sending addresses; by default every non-internal IPv4. */
  interfaces?: string[]
}

/**
 * The real factory, built on `node:dgram`. Not covered by tests.
 *
 * One socket is opened per IPv4 interface on the machine, each sending its
 * own query through its own interface. An active VPN owns the default route
 * without reaching the LAN, so querying only the default interface would
 * find nothing — and reusing a single socket across interfaces loses the
 * answers to the earlier sends.
 */
export function createMdnsFactory(options: MdnsFactoryOptions = {}): MdnsFactory {
  const serviceType = options.serviceType ?? SERVICE_TYPE

  return {
    browse(): MdnsBrowser {
      const listeners: Array<(service: MdnsService) => void> = []
      const query = buildQuery(serviceType)
      let closed = false

      const sockets = (options.interfaces ?? outboundAddresses()).map((address) => {
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

        socket.on('error', () => {})

        socket.on('message', (message) => {
          let decoded: Packet
          try {
            decoded = dnsPacket.decode(message) as Packet
          } catch {
            return
          }
          for (const service of servicesFromPacket(decoded, serviceType)) {
            for (const listener of listeners) listener(service)
          }
        })

        socket.bind(0, '0.0.0.0', () => {
          try {
            socket.setMulticastInterface(address)
            socket.send(query, MULTICAST_PORT, MULTICAST_ADDR)
          } catch {
            // Interface unusable for multicast: the others will do.
          }
        })

        return socket
      })

      return {
        on(_event, listener) {
          listeners.push(listener)
        },
        stop() {
          if (closed) return
          closed = true
          for (const socket of sockets) {
            try {
              socket.close()
            } catch {
              // Socket already closed.
            }
          }
        },
      }
    },
  }
}
