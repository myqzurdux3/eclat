import dgram from 'node:dgram'
import os from 'node:os'
import dnsPacket from 'dns-packet'
import type { MdnsBrowser, MdnsFactory, MdnsService } from './discovery'

/** Type de service annoncé par les contrôleurs Shapes, Elements et Lines. */
export const SERVICE_TYPE = '_nanoleafapi._tcp.local'

const MULTICAST_ADDR = '224.0.0.251'
const MULTICAST_PORT = 5353
/** Bit QU : demande une réponse unicast plutôt que multicast (RFC 6762 §5.4). */
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
 * Construit une requête PTR avec le bit QU armé.
 *
 * Le port 5353 est déjà occupé par avahi-daemon sur la plupart des postes
 * Linux, et le noyau ne délivre la réponse multicast qu'à un seul des
 * processus qui y sont liés. En demandant une réponse unicast on la reçoit
 * sur notre propre port éphémère, sans concurrence.
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

/** Recompose les services annoncés à partir d'une réponse mDNS décodée. */
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

/** Adresses IPv4 locales par lesquelles émettre la requête. */
function outboundAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
}

export interface MdnsFactoryOptions {
  serviceType?: string
  /** Adresses locales d'émission ; par défaut toutes les IPv4 non internes. */
  interfaces?: string[]
}

/**
 * Fabrique réelle, adossée à `node:dgram`. Non couverte par les tests.
 *
 * Une socket est ouverte par interface IPv4 de la machine, chacune émettant
 * sa requête par la sienne. Un VPN actif porte la route par défaut sans mener
 * au réseau local : n'interroger que l'interface par défaut ne trouverait
 * rien, et réutiliser une seule socket pour toutes les interfaces fait perdre
 * les réponses des envois précédents.
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
            // Interface inutilisable pour le multicast : les autres suffiront.
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
              // Socket déjà fermée.
            }
          }
        },
      }
    },
  }
}
