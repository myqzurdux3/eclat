import { describe, expect, it } from 'vitest'
import { buildQuery, servicesFromPacket, SERVICE_TYPE } from './mdns'

describe('buildQuery', () => {
  it('sets the QU bit to get a unicast answer', () => {
    const query = buildQuery(SERVICE_TYPE)
    const qclass = query.readUInt16BE(query.length - 2)

    expect(qclass & 0x8000).toBe(0x8000)
    expect(qclass & 0x7fff).toBe(1)
  })

  it('queries the requested service type', () => {
    expect(buildQuery(SERVICE_TYPE).includes(Buffer.from('_nanoleafapi'))).toBe(true)
  })
})

const packet = (over: Record<string, unknown> = {}) => ({
  answers: [
    { name: SERVICE_TYPE, type: 'PTR', data: `Shapes 83DC.${SERVICE_TYPE}` },
    {
      name: `Shapes 83DC.${SERVICE_TYPE}`,
      type: 'TXT',
      data: [Buffer.from('md=NL42'), Buffer.from('srcvers=12.4.1')],
    },
    {
      name: `Shapes 83DC.${SERVICE_TYPE}`,
      type: 'SRV',
      data: { port: 16021, target: 'Shapes-83DC.local' },
    },
    { name: 'Shapes-83DC.local', type: 'A', data: '192.168.1.142' },
  ],
  additionals: [],
  ...over,
})

describe('servicesFromPacket', () => {
  it('rebuilds a service from its PTR, SRV, TXT and A records', () => {
    expect(servicesFromPacket(packet(), SERVICE_TYPE)).toEqual([
      {
        name: 'Shapes 83DC',
        host: 'Shapes-83DC.local',
        addresses: ['192.168.1.142'],
        port: 16021,
        txt: { md: 'NL42', srcvers: '12.4.1' },
      },
    ])
  })

  it('also reads records placed in the additionals section', () => {
    const split = packet({
      answers: packet().answers.slice(0, 1),
      additionals: packet().answers.slice(1),
    })

    expect(servicesFromPacket(split, SERVICE_TYPE)[0]?.port).toBe(16021)
  })

  it('ignores a PTR that does not concern the service type', () => {
    const other = packet({
      answers: [{ name: '_hap._tcp.local', type: 'PTR', data: 'Autre._hap._tcp.local' }],
    })

    expect(servicesFromPacket(other, SERVICE_TYPE)).toEqual([])
  })

  it('ignores an instance without SRV, for want of a port', () => {
    const noSrv = packet({
      answers: packet().answers.filter((record) => record.type !== 'SRV'),
    })

    expect(servicesFromPacket(noSrv, SERVICE_TYPE)).toEqual([])
  })

  it('tolerates an instance with neither TXT nor address', () => {
    const bare = packet({
      answers: packet().answers.filter((record) => record.type === 'PTR' || record.type === 'SRV'),
    })

    expect(servicesFromPacket(bare, SERVICE_TYPE)).toEqual([
      { name: 'Shapes 83DC', host: 'Shapes-83DC.local', addresses: [], port: 16021, txt: {} },
    ])
  })

  it('keeps only IPv4 addresses', () => {
    const withV6 = packet({
      answers: [
        ...packet().answers,
        { name: 'Shapes-83DC.local', type: 'AAAA', data: 'fe80::255:daff:fe5f:83dc' },
      ],
    })

    expect(servicesFromPacket(withV6, SERVICE_TYPE)[0]?.addresses).toEqual(['192.168.1.142'])
  })
})
