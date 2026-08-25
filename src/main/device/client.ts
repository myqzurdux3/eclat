import type { DeviceState, PanelLayout, RawPanel } from '../../shared/types'
import { NanoleafError } from './errors'
import { normalizeLayout } from './layout'

export interface NanoleafClientOptions {
  ip: string
  token: string
  port?: number
  timeoutMs?: number
}

interface FullStateResponse {
  name: string
  serialNo: string
  firmwareVersion: string
  model: string
  effects: { select: string; effectsList: string[] }
  state: {
    on: { value: boolean }
    brightness: { value: number }
    hue: { value: number }
    sat: { value: number }
    ct: { value: number }
    colorMode: string
  }
}

interface LayoutResponse {
  numPanels: number
  sideLength: number
  positionData: RawPanel[]
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** Client REST du contrôleur Nanoleaf (port 16021, API v1). */
export class NanoleafClient {
  private readonly ip: string
  private readonly token: string
  private readonly port: number
  private readonly timeoutMs: number

  constructor(options: NanoleafClientOptions) {
    this.ip = options.ip
    this.token = options.token
    this.port = options.port ?? 16021
    this.timeoutMs = options.timeoutMs ?? 4000
  }

  async getState(): Promise<DeviceState> {
    const body = await this.request<FullStateResponse>('GET', '/')
    return {
      on: body.state.on.value,
      brightness: body.state.brightness.value,
      hue: body.state.hue.value,
      sat: body.state.sat.value,
      ct: body.state.ct.value,
      colorMode: body.state.colorMode,
      effect: body.effects.select,
    }
  }

  async getInfo(): Promise<{ name: string; model: string; firmware: string; serial: string }> {
    const body = await this.request<FullStateResponse>('GET', '/')
    return {
      name: body.name,
      model: body.model,
      firmware: body.firmwareVersion,
      serial: body.serialNo,
    }
  }

  async setOn(on: boolean): Promise<void> {
    await this.request('PUT', '/state', { on: { value: on } })
  }

  async setBrightness(value: number, durationSec = 0): Promise<void> {
    const payload: Record<string, unknown> = { value: clamp(Math.round(value), 0, 100) }
    if (durationSec > 0) payload.duration = durationSec
    await this.request('PUT', '/state', { brightness: payload })
  }

  async setHue(value: number): Promise<void> {
    await this.request('PUT', '/state', { hue: { value: clamp(Math.round(value), 0, 360) } })
  }

  async setSat(value: number): Promise<void> {
    await this.request('PUT', '/state', { sat: { value: clamp(Math.round(value), 0, 100) } })
  }

  async setColorTemp(value: number): Promise<void> {
    await this.request('PUT', '/state', { ct: { value: clamp(Math.round(value), 1200, 6500) } })
  }

  async getEffects(): Promise<string[]> {
    return this.request<string[]>('GET', '/effects/effectsList')
  }

  async selectEffect(name: string): Promise<void> {
    await this.request('PUT', '/effects', { select: name })
  }

  /**
   * Bascule le contrôleur en mode External Control v2. Il écoute ensuite en
   * UDP sur le port 60222. Toute autre commande (app mobile, bouton
   * physique) révoque ce mode : il faut le sonder et le réarmer.
   */
  async enableExternalControl(): Promise<void> {
    await this.request('PUT', '/effects', {
      write: { command: 'display', animType: 'extControl', extControlVersion: 'v2' },
    })
  }

  async getLayout(): Promise<PanelLayout> {
    const body = await this.request<LayoutResponse>('GET', '/panelLayout/layout')
    return normalizeLayout(body.positionData, body.sideLength)
  }

  private async request<T>(method: string, route: string, body?: unknown): Promise<T> {
    const url = `http://${this.ip}:${this.port}/api/v1/${this.token}${route === '/' ? '/' : route}`

    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (cause) {
      throw new NanoleafError(
        `Device injoignable : ${this.ip}:${this.port} (${String(cause)})`,
        0,
      )
    }

    if (!response.ok) {
      throw new NanoleafError(`${method} ${route} a répondu ${response.status}`, response.status)
    }

    if (response.status === 204) return undefined as T
    const text = await response.text()
    return (text.length === 0 ? undefined : JSON.parse(text)) as T
  }
}
