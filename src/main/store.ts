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

const baseXdg = (): string => process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')

/** Chemin du fichier de configuration, conforme à la spec XDG. */
export function defaultConfigPath(): string {
  return join(baseXdg(), 'eclat', 'config.json')
}

/**
 * Emplacement d'avant le nom du projet.
 *
 * Lu en dernier recours pour ne pas perdre l'appairage de quelqu'un qui
 * utilisait déjà l'application ; la première écriture le remplace.
 */
export function legacyConfigPath(): string {
  return join(baseXdg(), 'nanoleaf-app', 'config.json')
}

/**
 * Configuration persistée. Contient les tokens d'authentification, donc le
 * fichier est écrit en 0600 et ne doit jamais transiter vers le renderer.
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

  /** Le fichier courant, sinon celui de l'ancien emplacement. */
  private async lire(): Promise<string | null> {
    for (const chemin of [this.filePath, this.legacyPath]) {
      if (chemin === undefined) continue
      try {
        return await readFile(chemin, 'utf8')
      } catch {
        // Fichier absent : on essaie l'emplacement suivant.
      }
    }
    return null
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
