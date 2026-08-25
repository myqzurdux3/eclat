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

const xdgBase = (): string => process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')

/** Path to the configuration file, following the XDG spec. */
export function defaultConfigPath(): string {
  return join(xdgBase(), 'eclat', 'config.json')
}

/**
 * The location used before the project had a name.
 *
 * Read as a last resort so an existing user does not lose their pairing; the
 * first write replaces it.
 */
export function legacyConfigPath(): string {
  return join(xdgBase(), 'nanoleaf-app', 'config.json')
}

/**
 * The persisted configuration. It holds the authentication tokens, so the
 * file is written 0600 and must never travel to the renderer.
 */
export class ConfigStore {
  constructor(
    private readonly filePath: string,
    private readonly legacyPath?: string,
  ) {}

  async load(): Promise<AppConfig> {
    const raw = await this.lire()
    if (raw === null) return structuredClone(EMPTY_CONFIG)

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

  /** The current file, otherwise the one at the legacy location. */
  private async lire(): Promise<string | null> {
    for (const path of [this.filePath, this.legacyPath]) {
      if (path === undefined) continue
      try {
        return await readFile(path, 'utf8')
      } catch {
        // File missing: try the next location.
      }
    }
    return null
  }

  async save(config: AppConfig): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
    await writeFile(this.filePath, JSON.stringify(config, null, 2), { mode: 0o600 })
    // writeFile only applies the mode on creation: force it on an existing file.
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
