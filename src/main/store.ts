import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface StoredDevice {
  id: string
  name: string
  ip: string
  port: number
  token: string
}

export interface AppConfig {
  devices: Record<string, StoredDevice>
  activeDeviceId: string | null
}

const EMPTY_CONFIG: AppConfig = { devices: {}, activeDeviceId: null }

/** Chemin du fichier de configuration, conforme à la spec XDG. */
export function defaultConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(base, 'nanoleaf-app', 'config.json')
}

/**
 * Configuration persistée. Contient les tokens d'authentification, donc le
 * fichier est écrit en 0600 et ne doit jamais transiter vers le renderer.
 */
export class ConfigStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<AppConfig> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch {
      return structuredClone(EMPTY_CONFIG)
    }

    try {
      const parsed = JSON.parse(raw) as Partial<AppConfig>
      return {
        devices: parsed.devices ?? {},
        activeDeviceId: parsed.activeDeviceId ?? null,
      }
    } catch {
      return structuredClone(EMPTY_CONFIG)
    }
  }

  async save(config: AppConfig): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
    await writeFile(this.filePath, JSON.stringify(config, null, 2), { mode: 0o600 })
    // writeFile n'applique le mode qu'à la création : forcer sur un fichier existant.
    await chmod(this.filePath, 0o600)
  }

  async upsertDevice(device: StoredDevice): Promise<AppConfig> {
    const config = await this.load()
    config.devices[device.id] = device
    if (config.activeDeviceId === null) {
      config.activeDeviceId = device.id
    }
    await this.save(config)
    return config
  }
}
