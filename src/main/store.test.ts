import { chmod, mkdtemp, stat, writeFile } from 'node:fs/promises'
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
  name: 'Salon',
  ip: '192.168.1.42',
  port: 16021,
  token: 'secret',
}

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME
})

describe('ConfigStore', () => {
  it('renvoie une configuration vide quand le fichier n existe pas', async () => {
    const store = new ConfigStore(file)

    expect(await store.load()).toEqual({ devices: {}, activeDeviceId: null })
  })

  it('crée le répertoire parent et relit ce qu il a écrit', async () => {
    const store = new ConfigStore(file)

    await store.save({ devices: { [device.id]: device }, activeDeviceId: device.id })

    expect(await new ConfigStore(file).load()).toEqual({
      devices: { [device.id]: device },
      activeDeviceId: device.id,
    })
  })

  it('écrit le fichier en 0600', async () => {
    const store = new ConfigStore(file)

    await store.save({ devices: {}, activeDeviceId: null })

    const stats = await stat(file)
    expect(stats.mode & 0o777).toBe(0o600)
  })

  it('remet en 0600 un fichier existant avec des permissions relâchées', async () => {
    const store = new ConfigStore(file)

    // Créer le fichier avec permissions lâches
    await store.save({ devices: {}, activeDeviceId: null })
    await chmod(file, 0o644)

    let stats = await stat(file)
    expect(stats.mode & 0o777).toBe(0o644)

    // Réécrire : la permission doit revenir à 0o600
    await store.save({ devices: { [device.id]: device }, activeDeviceId: device.id })

    stats = await stat(file)
    expect(stats.mode & 0o777).toBe(0o600)
  })

  it('upsertDevice ajoute le device et le rend actif s il est le premier', async () => {
    const store = new ConfigStore(file)

    const config = await store.upsertDevice(device)

    expect(config.devices[device.id]).toEqual(device)
    expect(config.activeDeviceId).toBe(device.id)
  })

  it('upsertDevice met à jour sans changer le device actif', async () => {
    const store = new ConfigStore(file)
    await store.upsertDevice(device)
    await store.upsertDevice({ ...device, id: 'AUTRE0002', name: 'Bureau' })

    const config = await store.upsertDevice({ ...device, ip: '192.168.1.99' })

    expect(config.devices[device.id]!.ip).toBe('192.168.1.99')
    expect(config.activeDeviceId).toBe(device.id)
    expect(Object.keys(config.devices)).toHaveLength(2)
  })

  it('tolère un fichier corrompu', async () => {
    const flat = join(dir, 'config.json')
    await writeFile(flat, '{ pas du json', 'utf8')

    expect(await new ConfigStore(flat).load()).toEqual({ devices: {}, activeDeviceId: null })
  })

  it('defaultConfigPath respecte XDG_CONFIG_HOME', () => {
    process.env.XDG_CONFIG_HOME = '/tmp/xdg-test'

    expect(defaultConfigPath()).toBe('/tmp/xdg-test/nanoleaf-app/config.json')
  })
})
