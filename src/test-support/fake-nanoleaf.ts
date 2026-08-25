import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EXT_CONTROL_EFFECT, type RawPanel } from '../shared/types'

export interface FakeNanoleafOptions {
  token?: string
  positionData?: RawPanel[]
}

const DEFAULT_POSITION_DATA: RawPanel[] = [
  { panelId: 1, x: 0, y: 0, o: 0, shapeType: 7 },
  { panelId: 2, x: 100, y: 0, o: 60, shapeType: 7 },
  { panelId: 3, x: 50, y: 87, o: 120, shapeType: 7 },
]

/**
 * Double de test du contrôleur Nanoleaf : reproduit les routes REST utilisées
 * par l'application, sans matériel ni réseau externe.
 */
export class FakeNanoleaf {
  readonly token: string
  pairingMode = false
  /** Version d'External Control armée, `null` tant que le mode est inactif. */
  extControlVersion: string | null = null
  effects: string[] = ['Nemo', 'Northern Lights', 'Forest']
  /** Palettes HSB renvoyées par `requestAll`, indexées par nom d'effet. */
  palettes: Record<string, Array<{ hue: number; saturation: number; brightness: number }>> = {
    Nemo: [
      { hue: 200, saturation: 90, brightness: 80 },
      { hue: 220, saturation: 70, brightness: 60 },
    ],
    'Northern Lights': [{ hue: 140, saturation: 100, brightness: 90 }],
    Forest: [{ hue: 100, saturation: 80, brightness: 50 }],
  }
  state = { on: true, brightness: 50, hue: 120, sat: 80, ct: 4000, effect: 'Nemo' }
  requests: Array<{ method: string; path: string; body: unknown }> = []

  private readonly positionData: RawPanel[]
  private server: Server | undefined

  constructor(options: FakeNanoleafOptions = {}) {
    this.token = options.token ?? 'fake-token'
    this.positionData = options.positionData ?? DEFAULT_POSITION_DATA
  }

  get port(): number {
    const address = this.server?.address()
    if (!address || typeof address === 'string') {
      throw new Error('FakeNanoleaf non démarré')
    }
    return (address as AddressInfo).port
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req, res)
    })
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
  }

  async stop(): Promise<void> {
    if (!this.server) return
    await new Promise<void>((resolve, reject) =>
      this.server!.close((err) => (err ? reject(err) : resolve())),
    )
    this.server = undefined
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = req.url ?? ''
    const method = req.method ?? 'GET'
    const body = await readJson(req)
    this.requests.push({ method, path, body })

    if (method === 'POST' && path === '/api/v1/new') {
      if (!this.pairingMode) return send(res, 403)
      return sendJson(res, 200, { auth_token: this.token })
    }

    const prefix = `/api/v1/${this.token}`
    if (!path.startsWith('/api/v1/')) return send(res, 404)
    if (!path.startsWith(prefix)) return send(res, 401)

    const route = path.slice(prefix.length) || '/'

    if (method === 'GET' && route === '/') return sendJson(res, 200, this.fullState())
    if (method === 'GET' && route === '/panelLayout/layout') {
      return sendJson(res, 200, this.layout())
    }
    if (method === 'GET' && route === '/effects/effectsList') {
      return sendJson(res, 200, this.effects)
    }
    if (method === 'PUT' && route === '/state') {
      this.applyState(body)
      return send(res, 204)
    }
    if (method === 'PUT' && route === '/effects') {
      const payload = (body ?? {}) as {
        select?: string
        write?: {
          command?: string
          animName?: string
          animType?: string
          extControlVersion?: string
        }
      }
      if (payload.write?.command === 'requestAll') {
        return sendJson(res, 200, {
          animations: this.effects.map((name) => ({
            animName: name,
            colorType: 'HSB',
            palette: (this.palettes[name] ?? []).map((entry) => ({
              ...entry,
              probability: 0,
            })),
          })),
        })
      }
      if (payload.write?.command === 'display' && payload.write.animType === 'extControl') {
        this.extControlVersion = payload.write.extControlVersion ?? 'v1'
        this.state.effect = EXT_CONTROL_EFFECT
      } else if (typeof payload.select === 'string') {
        this.state.effect = payload.select
        this.extControlVersion = null
      }
      return send(res, 204)
    }

    return send(res, 404)
  }

  private applyState(body: unknown): void {
    const patch = (body ?? {}) as Record<string, { value?: unknown }>
    if (typeof patch.on?.value === 'boolean') this.state.on = patch.on.value
    if (typeof patch.brightness?.value === 'number') this.state.brightness = patch.brightness.value
    if (typeof patch.hue?.value === 'number') this.state.hue = patch.hue.value
    if (typeof patch.sat?.value === 'number') this.state.sat = patch.sat.value
    if (typeof patch.ct?.value === 'number') this.state.ct = patch.ct.value
  }

  private layout() {
    return {
      numPanels: this.positionData.length,
      sideLength: 67,
      positionData: this.positionData,
    }
  }

  private fullState() {
    return {
      name: 'Fake Shapes',
      serialNo: 'FAKE0001',
      firmwareVersion: '4.6.2',
      model: 'NL42',
      effects: { select: this.state.effect, effectsList: this.effects },
      state: {
        on: { value: this.state.on },
        brightness: { value: this.state.brightness, max: 100, min: 0 },
        hue: { value: this.state.hue, max: 360, min: 0 },
        sat: { value: this.state.sat, max: 100, min: 0 },
        ct: { value: this.state.ct, max: 6500, min: 1200 },
        colorMode: 'effect',
      },
      panelLayout: { layout: this.layout() },
    }
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

function send(res: ServerResponse, status: number): void {
  res.writeHead(status)
  res.end()
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body)
}
