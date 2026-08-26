import type { Color, DeviceState, EffectPalette, PanelLayout, RawPanel } from '../../shared/types'
import { hsbToRgb } from '../../shared/color'
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

interface AnimationsResponse {
  animations?: Array<{
    animName?: string
    palette?: Array<{ hue?: number; saturation?: number; brightness?: number }>
  }>
}

interface LayoutResponse {
  numPanels: number
  sideLength: number
  positionData: RawPanel[]
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** REST client for the Nanoleaf controller (port 16021, API v1). */
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

  /**
   * Whether the device answers, without reading its whole state.
   *
   * `GET /` returns the full document — every effect, the whole layout —
   * about 1.3 kB where 14 bytes will do. The round trip dominates either
   * way, but there is no reason to pay for the rest.
   */
  async isReachable(): Promise<boolean> {
    try {
      await this.request('GET', '/state/on')
      return true
    } catch {
      return false
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

  /**
   * Hue and saturation in a single write. The device accepts both fields in
   * the same `PUT /state`, which avoids chaining two 60-to-340 ms round
   * trips while a slider is being dragged.
   */
  async setHueSat(hue: number, sat: number): Promise<void> {
    await this.request('PUT', '/state', {
      hue: { value: clamp(Math.round(hue), 0, 360) },
      sat: { value: clamp(Math.round(sat), 0, 100) },
    })
  }

  async setColorTemp(value: number): Promise<void> {
    await this.request('PUT', '/state', { ct: { value: clamp(Math.round(value), 1200, 6500) } })
  }



  async selectEffect(name: string): Promise<void> {
    await this.request('PUT', '/effects', { select: name })
  }

  /**
   * Fetches every palette in one go. `requestAll` is a `PUT` that changes
   * nothing: it is the only route exposing the effects' real colours, since
   * `effectsList` only gives their names.
   */
  async getEffectPalettes(): Promise<EffectPalette[]> {
    const body = await this.request<AnimationsResponse>('PUT', '/effects', {
      write: { command: 'requestAll' },
    })

    return (body.animations ?? []).map((animation) => ({
      name: animation.animName ?? '',
      colors: (animation.palette ?? []).map(
        (entry): Color =>
          hsbToRgb(entry.hue ?? 0, entry.saturation ?? 0, entry.brightness ?? 0),
      ),
    }))
  }

  /**
   * Switches the controller into External Control v2. It then listens on UDP
   * port 60222. Any other command (mobile app, physical button) revokes the
   * mode, so it has to be probed and re-armed.
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
        `Device unreachable: ${this.ip}:${this.port} (${String(cause)})`,
        0,
        'error.unreachable',
      )
    }

    if (!response.ok) {
      throw new NanoleafError(`${method} ${route} answered ${response.status}`, response.status)
    }

    if (response.status === 204) return undefined as T
    const text = await response.text()
    return (text.length === 0 ? undefined : JSON.parse(text)) as T
  }
}
