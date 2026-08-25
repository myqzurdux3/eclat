import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore, defaultConfigPath, type StoredDevice } from './store'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nanoleaf-store-'))
  file = join(dir, 'nested', 'config.json')
})

const device: StoredDevice = {
  id: 'FAKE0001',
  name: 'Lounge',
  ip: '192.168.1.42',
  port: 16021,
  token: 'secret',
}

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME
})

describe('ConfigStore', () => {
  it('returns an empty configuration when the file does not exist', async () => {
    const store = new ConfigStore(file)

    expect(await store.load()).toEqual({ devices: {}, activeDeviceId: null })
  })

  it('creates the parent directory and reads back what it wrote', async () => {
    const store = new ConfigStore(file)

    await store.save({ devices: { [device.id]: device }, activeDeviceId: device.id })

    expect(await new ConfigStore(file).load()).toEqual({
      devices: { [device.id]: device },
      activeDeviceId: device.id,
    })
  })

  it('writes the file as 0600', async () => {
    const store = new ConfigStore(file)

    await store.save({ devices: {}, activeDeviceId: null })

    const stats = await stat(file)
    expect(stats.mode & 0o777).toBe(0o600)
  })

  it('resets an existing file with loosened permissions back to 0600', async () => {
    const store = new ConfigStore(file)

    // Create the file with loose permissions
    await store.save({ devices: {}, activeDeviceId: null })
    await chmod(file, 0o644)

    let stats = await stat(file)
    expect(stats.mode & 0o777).toBe(0o644)

    // Rewrite: the permission must return to 0o600
    await store.save({ devices: { [device.id]: device }, activeDeviceId: device.id })

    stats = await stat(file)
    expect(stats.mode & 0o777).toBe(0o600)
  })

  it('upsertDevice adds the device and makes it active if it is the first', async () => {
    const store = new ConfigStore(file)

    const config = await store.upsertDevice(device)

    expect(config.devices[device.id]).toEqual(device)
    expect(config.activeDeviceId).toBe(device.id)
  })

  it('upsertDevice updates without changing the active device', async () => {
    const store = new ConfigStore(file)
    await store.upsertDevice(device)
    await store.upsertDevice({ ...device, id: 'AUTRE0002', name: 'Study' })

    const config = await store.upsertDevice({ ...device, ip: '192.168.1.99' })

    expect(config.devices[device.id]!.ip).toBe('192.168.1.99')
    expect(config.activeDeviceId).toBe(device.id)
    expect(Object.keys(config.devices)).toHaveLength(2)
  })

  it('tolerates a corrupted file', async () => {
    const flat = join(dir, 'config.json')
    await writeFile(flat, '{ pas du json', 'utf8')

    expect(await new ConfigStore(flat).load()).toEqual({ devices: {}, activeDeviceId: null })
  })

  it('defaultConfigPath honours XDG_CONFIG_HOME', () => {
    process.env.XDG_CONFIG_HOME = '/tmp/xdg-test'

    expect(defaultConfigPath()).toBe('/tmp/xdg-test/eclat/config.json')
  })
})

describe('ConfigStore — legacy location', () => {
  it('reads the old file when the new one does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-legacy-'))
    const ancien = join(dir, 'ancien.json')
    const nouveau = join(dir, 'nouveau.json')
    await new ConfigStore(ancien).upsertDevice(device)

    const config = await new ConfigStore(nouveau, ancien).load()

    expect(config.devices[device.id]?.token).toBe(device.token)
  })

  it('prefers the new file when both exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-legacy-'))
    const ancien = join(dir, 'ancien.json')
    const nouveau = join(dir, 'nouveau.json')
    await new ConfigStore(ancien).upsertDevice({ ...device, token: 'ancien' })
    await new ConfigStore(nouveau).upsertDevice({ ...device, token: 'nouveau' })

    const config = await new ConfigStore(nouveau, ancien).load()

    expect(config.devices[device.id]?.token).toBe('nouveau')
  })

  it('always writes to the new location', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-legacy-'))
    const ancien = join(dir, 'ancien.json')
    const nouveau = join(dir, 'nouveau.json')
    await new ConfigStore(ancien).upsertDevice(device)

    const store = new ConfigStore(nouveau, ancien)
    await store.upsertDevice({ ...device, token: 'repris' })

    expect(JSON.parse(await readFile(nouveau, 'utf8')).devices[device.id].token).toBe('repris')
  })

  it('returns an empty configuration when neither exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-legacy-'))

    const config = await new ConfigStore(join(dir, 'a.json'), join(dir, 'b.json')).load()

    expect(config).toEqual({ devices: {}, activeDeviceId: null })
  })
})
