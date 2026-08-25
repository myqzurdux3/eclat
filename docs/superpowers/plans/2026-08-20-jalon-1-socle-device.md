# Jalon 1 — Socle device : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser la couche de communication avec les panneaux Nanoleaf — découverte mDNS, appairage, client REST, normalisation de la géométrie, persistance de la configuration — vérifiable en CI contre un device factice et manuellement contre le matériel réel.

**Architecture:** Tout le code de ce jalon vit dans le processus main d'Electron et n'a aucune dépendance à React ni au DOM. Chaque module est une unité pure ou injectable : le client REST prend une IP et un token, la découverte prend une fabrique mDNS, l'appairage prend une fonction de temporisation. Les seules E/S non simulables (mDNS réel, matériel réel) sont isolées derrière une interface pour que le reste soit testé sans réseau. La tâche 7 relie l'ensemble à une fenêtre Electron minimale qui n'a d'autre but que de prouver le chemin complet.

**Tech Stack:** Electron, TypeScript, React (minimal en tâche 7), Vite, Vitest, bonjour-service, module `node:http` pour le device factice.

**Spec:** `docs/superpowers/specs/2026-08-20-nanoleaf-linux-design.md`

## Global Constraints

- Cible : Ubuntu 26.04, Wayland/GNOME, Node v26.
- Matériel cible : Nanoleaf Shapes / Elements / Lines, firmware 4.x+.
- Port REST du device : **16021**. Base d'URL : `http://<ip>:16021/api/v1/<token>/`.
- Port UDP de streaming : **60222** (protocole v2) — hors périmètre de ce jalon, ne pas l'implémenter ici.
- Le token d'authentification ne quitte jamais le processus main. Le renderer ne le reçoit dans aucun message IPC.
- Le fichier de configuration est écrit avec les permissions `0600`, dans `~/.config/nanoleaf-app/config.json` (répertoire surchargeable par `XDG_CONFIG_HOME`).
- Aucun test ne doit dépendre d'un device physique ni du réseau : tout passe par le device factice de la tâche 2 ou par des doublures injectées.
- Les coordonnées de panneaux sont normalisées dans `[0,1]²`, origine en haut à gauche, rapport d'aspect préservé.
- Le paquet npm n'a pas de champ `"type"` : le code du main et du preload est compilé en CommonJS, le renderer est bâti par Vite.

---

### Task 1: Échafaudage du projet et normalisation de la géométrie

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.main.json`
- Create: `vitest.config.ts`
- Create: `.gitignore` (modifier l'existant)
- Create: `src/shared/types.ts`
- Create: `src/main/device/layout.ts`
- Test: `src/main/device/layout.test.ts`

**Interfaces:**
- Consumes: rien (première tâche)
- Produces:
  - `RawPanel { panelId: number; x: number; y: number; o: number; shapeType: number }`
  - `NormalizedPanel extends RawPanel { nx: number; ny: number }`
  - `PanelLayout { sideLength: number; aspect: number; panels: NormalizedPanel[] }`
  - `DeviceInfo { id: string; name: string; ip: string; port: number; model?: string; firmware?: string }`
  - `DeviceState { on: boolean; brightness: number; hue: number; sat: number; ct: number; colorMode: string; effect: string }`
  - `Color { r: number; g: number; b: number }`
  - `normalizeLayout(raw: RawPanel[], sideLength: number): PanelLayout`

- [x] **Step 1: Initialiser le paquet et installer les dépendances**

```bash
cd /home/user/Documents/nanoleaf
npm init -y
npm pkg delete type
npm pkg set private=true
npm pkg set name=nanoleaf-linux
npm pkg set version=0.1.0
npm pkg set main=dist/main/main.js
npm install react react-dom bonjour-service
npm install --save-dev electron typescript vite @vitejs/plugin-react vitest @types/react @types/react-dom @types/node
npm pkg set scripts.test="vitest run"
npm pkg set scripts.build:main="tsc -p tsconfig.main.json"
npm pkg set scripts.dev:renderer="vite"
npm pkg set scripts.start="npm run build:main && electron ."
```

- [x] **Step 2: Écrire les fichiers de configuration**

`tsconfig.json` (base, sert au renderer et à Vitest) :

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src"]
}
```

`tsconfig.main.json` (compile main + preload en CommonJS) :

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "CommonJS",
    "moduleResolution": "node",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist/main",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/main", "src/shared", "src/preload"],
  "exclude": ["**/*.test.ts"]
}
```

`vitest.config.ts` :

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
```

Ajouter à `.gitignore` :

```
node_modules/
dist/
```

- [x] **Step 3: Écrire les types partagés**

`src/shared/types.ts` :

```ts
export interface RawPanel {
  panelId: number
  x: number
  y: number
  o: number
  shapeType: number
}

export interface NormalizedPanel extends RawPanel {
  /** Position horizontale normalisée dans [0,1], 0 = bord gauche du mur. */
  nx: number
  /** Position verticale normalisée dans [0,1], 0 = haut du mur. */
  ny: number
}

export interface PanelLayout {
  sideLength: number
  /** largeur / hauteur de l'enveloppe des panneaux ; 1 si un seul panneau. */
  aspect: number
  panels: NormalizedPanel[]
}

export interface DeviceInfo {
  id: string
  name: string
  ip: string
  port: number
  model?: string
  firmware?: string
}

export interface DeviceState {
  on: boolean
  brightness: number
  hue: number
  sat: number
  ct: number
  colorMode: string
  effect: string
}

export interface Color {
  r: number
  g: number
  b: number
}
```

- [x] **Step 4: Écrire le test qui échoue**

`src/main/device/layout.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { normalizeLayout } from './layout'
import type { RawPanel } from '../../shared/types'

const panel = (panelId: number, x: number, y: number, shapeType = 7): RawPanel => ({
  panelId,
  x,
  y,
  o: 0,
  shapeType,
})

describe('normalizeLayout', () => {
  it('centre un panneau unique', () => {
    const layout = normalizeLayout([panel(1, 120, 340)], 67)
    expect(layout.panels).toHaveLength(1)
    expect(layout.panels[0]!.nx).toBeCloseTo(0.5)
    expect(layout.panels[0]!.ny).toBeCloseTo(0.5)
    expect(layout.aspect).toBe(1)
    expect(layout.sideLength).toBe(67)
  })

  it('étale deux panneaux horizontaux sur toute la largeur et les centre verticalement', () => {
    const layout = normalizeLayout([panel(1, 0, 50), panel(2, 100, 50)], 67)
    expect(layout.panels[0]!.nx).toBeCloseTo(0)
    expect(layout.panels[1]!.nx).toBeCloseTo(1)
    expect(layout.panels[0]!.ny).toBeCloseTo(0.5)
    expect(layout.panels[1]!.ny).toBeCloseTo(0.5)
  })

  it('inverse l axe vertical : un y device élevé donne un ny faible', () => {
    const layout = normalizeLayout([panel(1, 0, 0), panel(2, 0, 100)], 67)
    expect(layout.panels[0]!.ny).toBeCloseTo(1)
    expect(layout.panels[1]!.ny).toBeCloseTo(0)
  })

  it('préserve le rapport d aspect : une disposition large ne remplit pas la hauteur', () => {
    const layout = normalizeLayout(
      [panel(1, 0, 0), panel(2, 200, 0), panel(3, 100, 50)],
      67,
    )
    expect(layout.aspect).toBeCloseTo(4)
    // hauteur totale 50 sur une échelle de 200 : la bande occupée fait 0.25,
    // donc centrée entre 0.375 et 0.625
    expect(layout.panels[0]!.ny).toBeCloseTo(0.625)
    expect(layout.panels[2]!.ny).toBeCloseTo(0.375)
  })

  it('écarte le panneau contrôleur (panelId 0) présent sur Lines et Elements', () => {
    const layout = normalizeLayout([panel(0, 999, 999, 12), panel(1, 0, 0), panel(2, 100, 0)], 67)
    expect(layout.panels.map((p) => p.panelId)).toEqual([1, 2])
    expect(layout.panels[1]!.nx).toBeCloseTo(1)
  })

  it('renvoie une disposition vide sans planter', () => {
    const layout = normalizeLayout([], 67)
    expect(layout.panels).toEqual([])
    expect(layout.aspect).toBe(1)
  })
})
```

- [x] **Step 5: Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run src/main/device/layout.test.ts`
Expected: FAIL — `Failed to resolve import "./layout"`

- [x] **Step 6: Écrire l'implémentation minimale**

`src/main/device/layout.ts` :

```ts
import type { NormalizedPanel, PanelLayout, RawPanel } from '../../shared/types'

/** Identifiant du panneau contrôleur, présent dans la layout mais non éclairable. */
const CONTROLLER_PANEL_ID = 0

/**
 * Convertit les coordonnées brutes du device en positions normalisées dans
 * [0,1]², origine en haut à gauche, rapport d'aspect préservé.
 *
 * Le device exprime ses coordonnées en millimètres avec un axe Y orienté vers
 * le haut ; l'axe est inversé ici pour correspondre aux conventions écran.
 */
export function normalizeLayout(raw: RawPanel[], sideLength: number): PanelLayout {
  const usable = raw.filter((p) => p.panelId !== CONTROLLER_PANEL_ID)

  if (usable.length === 0) {
    return { sideLength, aspect: 1, panels: [] }
  }

  const xs = usable.map((p) => p.x)
  const ys = usable.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const width = maxX - minX
  const height = maxY - minY
  const scale = Math.max(width, height)

  if (scale === 0) {
    const panels: NormalizedPanel[] = usable.map((p) => ({ ...p, nx: 0.5, ny: 0.5 }))
    return { sideLength, aspect: 1, panels }
  }

  const offsetX = (1 - width / scale) / 2
  const offsetY = (1 - height / scale) / 2

  const panels: NormalizedPanel[] = usable.map((p) => ({
    ...p,
    nx: (p.x - minX) / scale + offsetX,
    ny: 1 - ((p.y - minY) / scale + offsetY),
  }))

  const aspect = height === 0 ? Number.POSITIVE_INFINITY : width / height

  return {
    sideLength,
    aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : 1,
    panels,
  }
}
```

- [x] **Step 7: Lancer le test et vérifier qu'il passe**

Run: `npx vitest run src/main/device/layout.test.ts`
Expected: PASS — 6 tests

- [x] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.main.json vitest.config.ts .gitignore src/shared/types.ts src/main/device/layout.ts src/main/device/layout.test.ts
git commit -m "feat: échafaudage du projet et normalisation de la géométrie des panneaux"
```

---

### Task 2: Device Nanoleaf factice

**Files:**
- Create: `src/test-support/fake-nanoleaf.ts`
- Test: `src/test-support/fake-nanoleaf.test.ts`

**Interfaces:**
- Consumes: `RawPanel` de `src/shared/types.ts`
- Produces:
  - `class FakeNanoleaf`
  - `new FakeNanoleaf(options?: { token?: string; positionData?: RawPanel[] })`
  - `start(): Promise<void>` — écoute sur `127.0.0.1`, port éphémère
  - `stop(): Promise<void>`
  - `readonly port: number`
  - `readonly token: string`
  - `pairingMode: boolean` — quand `false`, `POST /api/v1/new` répond `403`
  - `state: { on: boolean; brightness: number; hue: number; sat: number; ct: number; effect: string }`
  - `effects: string[]`
  - `requests: Array<{ method: string; path: string; body: unknown }>` — journal pour les assertions

- [x] **Step 1: Écrire le test qui échoue**

`src/test-support/fake-nanoleaf.test.ts` :

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { FakeNanoleaf } from './fake-nanoleaf'

let device: FakeNanoleaf | undefined

afterEach(async () => {
  await device?.stop()
  device = undefined
})

const base = (d: FakeNanoleaf) => `http://127.0.0.1:${d.port}`

describe('FakeNanoleaf', () => {
  it('refuse l appairage hors mode appairage', async () => {
    device = new FakeNanoleaf()
    await device.start()

    const res = await fetch(`${base(device)}/api/v1/new`, { method: 'POST' })

    expect(res.status).toBe(403)
  })

  it('délivre un token en mode appairage', async () => {
    device = new FakeNanoleaf({ token: 'tok-123' })
    await device.start()
    device.pairingMode = true

    const res = await fetch(`${base(device)}/api/v1/new`, { method: 'POST' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ auth_token: 'tok-123' })
  })

  it('rejette un token inconnu', async () => {
    device = new FakeNanoleaf({ token: 'bon' })
    await device.start()

    const res = await fetch(`${base(device)}/api/v1/mauvais/`)

    expect(res.status).toBe(401)
  })

  it('sert l état complet', async () => {
    device = new FakeNanoleaf({ token: 'tok' })
    await device.start()

    const res = await fetch(`${base(device)}/api/v1/tok/`)
    const body = (await res.json()) as any

    expect(res.status).toBe(200)
    expect(body.state.on.value).toBe(true)
    expect(body.state.brightness.value).toBe(50)
    expect(body.panelLayout.layout.numPanels).toBeGreaterThan(0)
  })

  it('applique un PUT /state et journalise la requête', async () => {
    device = new FakeNanoleaf({ token: 'tok' })
    await device.start()

    const res = await fetch(`${base(device)}/api/v1/tok/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brightness: { value: 80 } }),
    })

    expect(res.status).toBe(204)
    expect(device.state.brightness).toBe(80)
    expect(device.requests.at(-1)).toEqual({
      method: 'PUT',
      path: '/api/v1/tok/state',
      body: { brightness: { value: 80 } },
    })
  })

  it('sert la liste des effets et applique une sélection', async () => {
    device = new FakeNanoleaf({ token: 'tok' })
    await device.start()
    device.effects = ['Nemo', 'Northern Lights']

    const list = await fetch(`${base(device)}/api/v1/tok/effects/effectsList`)
    expect(await list.json()).toEqual(['Nemo', 'Northern Lights'])

    await fetch(`${base(device)}/api/v1/tok/effects`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ select: 'Nemo' }),
    })
    expect(device.state.effect).toBe('Nemo')
  })

  it('sert la layout des panneaux', async () => {
    device = new FakeNanoleaf({
      token: 'tok',
      positionData: [{ panelId: 42, x: 0, y: 0, o: 0, shapeType: 7 }],
    })
    await device.start()

    const res = await fetch(`${base(device)}/api/v1/tok/panelLayout/layout`)
    const body = (await res.json()) as any

    expect(body.numPanels).toBe(1)
    expect(body.positionData[0].panelId).toBe(42)
  })
})
```

- [x] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run src/test-support/fake-nanoleaf.test.ts`
Expected: FAIL — `Failed to resolve import "./fake-nanoleaf"`

- [x] **Step 3: Écrire l'implémentation**

`src/test-support/fake-nanoleaf.ts` :

```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { RawPanel } from '../shared/types'

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
  effects: string[] = ['Nemo', 'Northern Lights', 'Forest']
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
      const select = (body as { select?: string } | null)?.select
      if (typeof select === 'string') this.state.effect = select
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
```

- [x] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `npx vitest run src/test-support/fake-nanoleaf.test.ts`
Expected: PASS — 7 tests

- [x] **Step 5: Commit**

```bash
git add src/test-support/fake-nanoleaf.ts src/test-support/fake-nanoleaf.test.ts
git commit -m "test: device Nanoleaf factice pour les tests d intégration"
```

---

### Task 3: Client REST

**Files:**
- Create: `src/main/device/errors.ts`
- Create: `src/main/device/client.ts`
- Test: `src/main/device/client.test.ts`

**Interfaces:**
- Consumes: `FakeNanoleaf` (tâche 2), `normalizeLayout` (tâche 1), types partagés (tâche 1)
- Produces:
  - `class NanoleafError extends Error { readonly status: number }`
  - `class NanoleafClient`
  - `new NanoleafClient(options: { ip: string; token: string; port?: number; timeoutMs?: number })`
  - `getState(): Promise<DeviceState>`
  - `getInfo(): Promise<{ name: string; model: string; firmware: string; serial: string }>`
  - `setOn(on: boolean): Promise<void>`
  - `setBrightness(value: number, durationSec?: number): Promise<void>`
  - `setHue(value: number): Promise<void>`
  - `setSat(value: number): Promise<void>`
  - `setColorTemp(value: number): Promise<void>`
  - `getEffects(): Promise<string[]>`
  - `selectEffect(name: string): Promise<void>`
  - `getLayout(): Promise<PanelLayout>`

- [x] **Step 1: Écrire le test qui échoue**

`src/main/device/client.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeNanoleaf } from '../../test-support/fake-nanoleaf'
import { NanoleafClient } from './client'
import { NanoleafError } from './errors'

let device: FakeNanoleaf
let client: NanoleafClient

beforeEach(async () => {
  device = new FakeNanoleaf({ token: 'tok' })
  await device.start()
  client = new NanoleafClient({ ip: '127.0.0.1', token: 'tok', port: device.port })
})

afterEach(async () => {
  await device.stop()
})

describe('NanoleafClient', () => {
  it('lit l état et l aplatit', async () => {
    const state = await client.getState()

    expect(state).toEqual({
      on: true,
      brightness: 50,
      hue: 120,
      sat: 80,
      ct: 4000,
      colorMode: 'effect',
      effect: 'Nemo',
    })
  })

  it('lit les informations du device', async () => {
    const info = await client.getInfo()

    expect(info).toEqual({
      name: 'Fake Shapes',
      model: 'NL42',
      firmware: '4.6.2',
      serial: 'FAKE0001',
    })
  })

  it('éteint le device', async () => {
    await client.setOn(false)

    expect(device.state.on).toBe(false)
    expect(device.requests.at(-1)!.body).toEqual({ on: { value: false } })
  })

  it('règle la luminosité avec une durée de transition', async () => {
    await client.setBrightness(80, 2)

    expect(device.state.brightness).toBe(80)
    expect(device.requests.at(-1)!.body).toEqual({ brightness: { value: 80, duration: 2 } })
  })

  it('borne la luminosité dans [0,100]', async () => {
    await client.setBrightness(150)

    expect(device.state.brightness).toBe(100)
  })

  it('règle teinte, saturation et température', async () => {
    await client.setHue(200)
    await client.setSat(65)
    await client.setColorTemp(3000)

    expect(device.state.hue).toBe(200)
    expect(device.state.sat).toBe(65)
    expect(device.state.ct).toBe(3000)
  })

  it('liste et sélectionne un effet', async () => {
    const effects = await client.getEffects()
    expect(effects).toContain('Northern Lights')

    await client.selectEffect('Northern Lights')
    expect(device.state.effect).toBe('Northern Lights')
  })

  it('renvoie une layout normalisée', async () => {
    const layout = await client.getLayout()

    expect(layout.sideLength).toBe(67)
    expect(layout.panels).toHaveLength(3)
    for (const panel of layout.panels) {
      expect(panel.nx).toBeGreaterThanOrEqual(0)
      expect(panel.nx).toBeLessThanOrEqual(1)
      expect(panel.ny).toBeGreaterThanOrEqual(0)
      expect(panel.ny).toBeLessThanOrEqual(1)
    }
  })

  it('lève une NanoleafError sur token invalide', async () => {
    const wrong = new NanoleafClient({ ip: '127.0.0.1', token: 'faux', port: device.port })

    await expect(wrong.getState()).rejects.toBeInstanceOf(NanoleafError)
    await expect(wrong.getState()).rejects.toMatchObject({ status: 401 })
  })
})
```

- [x] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run src/main/device/client.test.ts`
Expected: FAIL — `Failed to resolve import "./client"`

- [x] **Step 3: Écrire les erreurs**

`src/main/device/errors.ts` :

```ts
/** Erreur renvoyée par le contrôleur Nanoleaf, porteuse du code HTTP. */
export class NanoleafError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'NanoleafError'
  }
}
```

- [x] **Step 4: Écrire le client**

`src/main/device/client.ts` :

```ts
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
```

- [x] **Step 5: Lancer le test et vérifier qu'il passe**

Run: `npx vitest run src/main/device/client.test.ts`
Expected: PASS — 9 tests

- [x] **Step 6: Vérifier la compilation du main**

Run: `npm run build:main`
Expected: aucune erreur TypeScript

- [x] **Step 7: Commit**

```bash
git add src/main/device/client.ts src/main/device/errors.ts src/main/device/client.test.ts
git commit -m "feat: client REST Nanoleaf"
```

---

### Task 4: Appairage

**Files:**
- Create: `src/main/device/pairing.ts`
- Test: `src/main/device/pairing.test.ts`

**Interfaces:**
- Consumes: `NanoleafError` (tâche 3), `FakeNanoleaf` (tâche 2)
- Produces:
  - `pairDevice(options: PairOptions): Promise<string>` — renvoie le token
  - `interface PairOptions { ip: string; port?: number; attempts?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void>; signal?: AbortSignal }`
  - Valeurs par défaut : `port = 16021`, `attempts = 15`, `intervalMs = 2000` (soit 30 s de fenêtre)

- [x] **Step 1: Écrire le test qui échoue**

`src/main/device/pairing.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeNanoleaf } from '../../test-support/fake-nanoleaf'
import { NanoleafError } from './errors'
import { pairDevice } from './pairing'

let device: FakeNanoleaf

beforeEach(async () => {
  device = new FakeNanoleaf({ token: 'tok-abc' })
  await device.start()
})

afterEach(async () => {
  await device.stop()
})

/** Temporisation instantanée : les tests ne doivent pas attendre réellement. */
const noSleep = () => Promise.resolve()

describe('pairDevice', () => {
  it('renvoie le token quand le device est en mode appairage', async () => {
    device.pairingMode = true

    const token = await pairDevice({
      ip: '127.0.0.1',
      port: device.port,
      sleep: noSleep,
    })

    expect(token).toBe('tok-abc')
  })

  it('réessaie jusqu à ce que le bouton soit maintenu', async () => {
    const sleep = vi.fn(async () => {
      if (device.requests.length >= 3) device.pairingMode = true
    })

    const token = await pairDevice({
      ip: '127.0.0.1',
      port: device.port,
      attempts: 10,
      sleep,
    })

    expect(token).toBe('tok-abc')
    expect(sleep).toHaveBeenCalled()
  })

  it('abandonne après le nombre d essais imparti', async () => {
    await expect(
      pairDevice({ ip: '127.0.0.1', port: device.port, attempts: 3, sleep: noSleep }),
    ).rejects.toBeInstanceOf(NanoleafError)

    const pairingCalls = device.requests.filter((r) => r.path === '/api/v1/new')
    expect(pairingCalls).toHaveLength(3)
  })

  it('s interrompt sur signal d annulation', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      pairDevice({
        ip: '127.0.0.1',
        port: device.port,
        attempts: 10,
        sleep: noSleep,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/annul/i)
  })
})
```

- [x] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run src/main/device/pairing.test.ts`
Expected: FAIL — `Failed to resolve import "./pairing"`

- [x] **Step 3: Écrire l'implémentation**

`src/main/device/pairing.ts` :

```ts
import { NanoleafError } from './errors'

export interface PairOptions {
  ip: string
  port?: number
  /** Nombre de tentatives ; 15 tentatives à 2 s couvrent la fenêtre de 30 s. */
  attempts?: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Sollicite le device jusqu'à obtention d'un token.
 *
 * Le contrôleur n'accepte `POST /api/v1/new` que pendant les quelques
 * secondes qui suivent un appui long sur le bouton power ; il répond 403 le
 * reste du temps. La boucle est donc inoffensive hors fenêtre d'appairage.
 */
export async function pairDevice(options: PairOptions): Promise<string> {
  const port = options.port ?? 16021
  const attempts = options.attempts ?? 15
  const intervalMs = options.intervalMs ?? 2000
  const sleep = options.sleep ?? defaultSleep
  const url = `http://${options.ip}:${port}/api/v1/new`

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new NanoleafError('Appairage annulé', 0)
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(4000),
      })

      if (response.ok) {
        const body = (await response.json()) as { auth_token?: string }
        if (typeof body.auth_token === 'string' && body.auth_token.length > 0) {
          return body.auth_token
        }
        throw new NanoleafError('Réponse d appairage sans auth_token', response.status)
      }
    } catch (error) {
      if (error instanceof NanoleafError) throw error
      // Device injoignable sur cette tentative : on retente.
    }

    if (attempt < attempts - 1) {
      await sleep(intervalMs)
    }
  }

  throw new NanoleafError(
    'Appairage échoué : maintiens le bouton power 5-7 s jusqu au clignotement, puis réessaie',
    403,
  )
}
```

- [x] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `npx vitest run src/main/device/pairing.test.ts`
Expected: PASS — 4 tests

- [x] **Step 5: Commit**

```bash
git add src/main/device/pairing.ts src/main/device/pairing.test.ts
git commit -m "feat: appairage du device avec boucle de sollicitation"
```

---

### Task 5: Persistance de la configuration

**Files:**
- Create: `src/main/store.ts`
- Test: `src/main/store.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `interface StoredDevice { id: string; name: string; ip: string; port: number; token: string }`
  - `interface AppConfig { devices: Record<string, StoredDevice>; activeDeviceId: string | null }`
  - `defaultConfigPath(): string` — `$XDG_CONFIG_HOME/nanoleaf-app/config.json`, repli `~/.config/...`
  - `class ConfigStore { constructor(filePath: string); load(): Promise<AppConfig>; save(config: AppConfig): Promise<void>; upsertDevice(device: StoredDevice): Promise<AppConfig>; }`

- [x] **Step 1: Écrire le test qui échoue**

`src/main/store.test.ts` :

```ts
import { mkdtemp, stat, writeFile } from 'node:fs/promises'
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
```

- [x] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run src/main/store.test.ts`
Expected: FAIL — `Failed to resolve import "./store"`

- [x] **Step 3: Écrire l'implémentation**

`src/main/store.ts` :

```ts
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
```

- [x] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `npx vitest run src/main/store.test.ts`
Expected: PASS — 7 tests

- [x] **Step 5: Commit**

```bash
git add src/main/store.ts src/main/store.test.ts
git commit -m "feat: persistance de la configuration en 0600"
```

---

### Task 6: Découverte mDNS

**Files:**
- Create: `src/main/device/discovery.ts`
- Test: `src/main/device/discovery.test.ts`

**Interfaces:**
- Consumes: `DeviceInfo` (tâche 1)
- Produces:
  - `interface MdnsService { name: string; host: string; addresses?: string[]; port: number; txt?: Record<string, string> }`
  - `interface MdnsBrowser { on(event: 'up', listener: (service: MdnsService) => void): void; stop(): void }`
  - `interface MdnsFactory { browse(): MdnsBrowser }`
  - `discoverDevices(factory: MdnsFactory, options?: { timeoutMs?: number; sleep?: (ms: number) => Promise<void> }): Promise<DeviceInfo[]>`
  - `createBonjourFactory(): MdnsFactory` — implémentation réelle sur `bonjour-service`, non couverte par les tests unitaires

- [x] **Step 1: Écrire le test qui échoue**

`src/main/device/discovery.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { discoverDevices, type MdnsBrowser, type MdnsFactory, type MdnsService } from './discovery'

/** Fabrique mDNS de test : rejoue une liste de services à l abonnement. */
function fakeFactory(services: MdnsService[]): MdnsFactory & { stopped: () => boolean } {
  let stopped = false
  return {
    stopped: () => stopped,
    browse(): MdnsBrowser {
      return {
        on(_event, listener) {
          for (const service of services) listener(service)
        },
        stop() {
          stopped = true
        },
      }
    },
  }
}

const service = (over: Partial<MdnsService> = {}): MdnsService => ({
  name: 'Shapes Salon',
  host: 'shapes.local',
  addresses: ['fe80::1', '192.168.1.42'],
  port: 16021,
  txt: { md: 'NL42', srcvers: '4.6.2' },
  ...over,
})

describe('discoverDevices', () => {
  it('convertit un service en DeviceInfo en retenant l adresse IPv4', async () => {
    const factory = fakeFactory([service()])

    const devices = await discoverDevices(factory, { timeoutMs: 0, sleep: () => Promise.resolve() })

    expect(devices).toEqual([
      {
        id: 'Shapes Salon',
        name: 'Shapes Salon',
        ip: '192.168.1.42',
        port: 16021,
        model: 'NL42',
        firmware: '4.6.2',
      },
    ])
  })

  it('déduplique les annonces répétées', async () => {
    const factory = fakeFactory([service(), service(), service({ name: 'Autre' })])

    const devices = await discoverDevices(factory, { timeoutMs: 0, sleep: () => Promise.resolve() })

    expect(devices).toHaveLength(2)
  })

  it('ignore un service sans adresse IPv4', async () => {
    const factory = fakeFactory([service({ addresses: ['fe80::1'] })])

    const devices = await discoverDevices(factory, { timeoutMs: 0, sleep: () => Promise.resolve() })

    expect(devices).toEqual([])
  })

  it('tolère l absence de TXT records', async () => {
    const factory = fakeFactory([service({ txt: undefined })])

    const devices = await discoverDevices(factory, { timeoutMs: 0, sleep: () => Promise.resolve() })

    expect(devices[0]!.model).toBeUndefined()
    expect(devices[0]!.firmware).toBeUndefined()
  })

  it('arrête le browser à la fin', async () => {
    const factory = fakeFactory([service()])

    await discoverDevices(factory, { timeoutMs: 0, sleep: () => Promise.resolve() })

    expect(factory.stopped()).toBe(true)
  })
})
```

- [x] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run src/main/device/discovery.test.ts`
Expected: FAIL — `Failed to resolve import "./discovery"`

- [x] **Step 3: Écrire l'implémentation**

`src/main/device/discovery.ts` :

```ts
import type { DeviceInfo } from '../../shared/types'

export interface MdnsService {
  name: string
  host: string
  addresses?: string[]
  port: number
  txt?: Record<string, string>
}

export interface MdnsBrowser {
  on(event: 'up', listener: (service: MdnsService) => void): void
  stop(): void
}

export interface MdnsFactory {
  browse(): MdnsBrowser
}

export interface DiscoverOptions {
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Collecte les contrôleurs Nanoleaf annoncés en mDNS pendant la fenêtre
 * indiquée, puis arrête le browser.
 */
export async function discoverDevices(
  factory: MdnsFactory,
  options: DiscoverOptions = {},
): Promise<DeviceInfo[]> {
  const timeoutMs = options.timeoutMs ?? 3000
  const sleep = options.sleep ?? defaultSleep

  const found = new Map<string, DeviceInfo>()
  const browser = factory.browse()

  browser.on('up', (service) => {
    const ip = service.addresses?.find((address) => IPV4.test(address))
    if (ip === undefined) return

    found.set(service.name, {
      id: service.name,
      name: service.name,
      ip,
      port: service.port,
      model: service.txt?.md,
      firmware: service.txt?.srcvers,
    })
  })

  try {
    await sleep(timeoutMs)
  } finally {
    browser.stop()
  }

  return [...found.values()]
}

/** Fabrique réelle, adossée à bonjour-service. Non couverte par les tests. */
export function createBonjourFactory(): MdnsFactory {
  // Import paresseux : évite d'ouvrir une socket mDNS dans les tests unitaires.
  const { Bonjour } = require('bonjour-service') as typeof import('bonjour-service')
  const bonjour = new Bonjour()

  return {
    browse(): MdnsBrowser {
      const browser = bonjour.find({ type: 'nanoleafapi', protocol: 'tcp' })
      return {
        on(event, listener) {
          browser.on(event, (service) => {
            listener({
              name: service.name,
              host: service.host,
              addresses: service.addresses,
              port: service.port,
              txt: service.txt as Record<string, string> | undefined,
            })
          })
        },
        stop() {
          browser.stop()
          bonjour.destroy()
        },
      }
    },
  }
}
```

- [x] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `npx vitest run src/main/device/discovery.test.ts`
Expected: PASS — 5 tests

- [x] **Step 5: Commit**

```bash
git add src/main/device/discovery.ts src/main/device/discovery.test.ts
git commit -m "feat: découverte mDNS des contrôleurs Nanoleaf"
```

---

### Task 7: Coquille Electron et câblage IPC

**Files:**
- Create: `src/main/main.ts`
- Create: `src/main/ipc.ts`
- Create: `src/preload/preload.ts`
- Create: `src/shared/ipc-contract.ts`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Test: `src/main/ipc.test.ts`

**Interfaces:**
- Consumes: `NanoleafClient` (tâche 3), `pairDevice` (tâche 4), `ConfigStore`, `defaultConfigPath`, `StoredDevice` (tâche 5), `discoverDevices`, `createMdnsFactory` (tâche 6), `normalizeLayout` (tâche 1)
- Produces:
  - `interface RendererDevice { id: string; name: string; ip: string; port: number; model?: string; firmware?: string; paired: boolean }` — **sans token**
  - `class DeviceService` — logique des handlers, testable sans Electron
  - `registerIpc(ipcMain: IpcMainLike, service: DeviceService): void`
  - `window.nanoleaf` côté renderer : `{ discover, pair, listDevices, getState, setOn, setBrightness, getLayout, getEffects, selectEffect }`

- [x] **Step 1: Écrire le contrat IPC partagé**

`src/shared/ipc-contract.ts` :

```ts
import type { DeviceState, PanelLayout } from './types'

/** Vue d'un device exposée au renderer. Ne contient jamais le token. */
export interface RendererDevice {
  id: string
  name: string
  ip: string
  port: number
  model?: string
  firmware?: string
  paired: boolean
}

export interface NanoleafApi {
  discover(): Promise<RendererDevice[]>
  pair(deviceId: string): Promise<RendererDevice>
  listDevices(): Promise<RendererDevice[]>
  getState(deviceId: string): Promise<DeviceState>
  setOn(deviceId: string, on: boolean): Promise<void>
  setBrightness(deviceId: string, value: number): Promise<void>
  getLayout(deviceId: string): Promise<PanelLayout>
  getEffects(deviceId: string): Promise<string[]>
  selectEffect(deviceId: string, name: string): Promise<void>
}

export const IPC_CHANNELS = {
  discover: 'devices:discover',
  pair: 'devices:pair',
  list: 'devices:list',
  getState: 'devices:getState',
  setOn: 'devices:setOn',
  setBrightness: 'devices:setBrightness',
  getLayout: 'devices:layout',
  getEffects: 'effects:list',
  selectEffect: 'effects:select',
} as const
```

- [x] **Step 2: Écrire le test qui échoue**

`src/main/ipc.test.ts` :

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { FakeNanoleaf } from '../test-support/fake-nanoleaf'
import { DeviceService } from './ipc'
import { ConfigStore } from './store'
import type { MdnsFactory, MdnsService } from './device/discovery'

let device: FakeNanoleaf
let service: DeviceService

function fakeFactory(services: MdnsService[]): MdnsFactory {
  return {
    browse() {
      return {
        on(_event, listener) {
          for (const s of services) listener(s)
        },
        stop() {},
      }
    },
  }
}

beforeEach(async () => {
  device = new FakeNanoleaf({ token: 'tok' })
  await device.start()

  const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-ipc-'))
  service = new DeviceService({
    store: new ConfigStore(join(dir, 'config.json')),
    mdnsFactory: fakeFactory([
      {
        name: 'Shapes Salon',
        host: 'shapes.local',
        addresses: ['127.0.0.1'],
        port: device.port,
        txt: { md: 'NL42', srcvers: '4.6.2' },
      },
    ]),
    discoverTimeoutMs: 0,
    sleep: () => Promise.resolve(),
    pairAttempts: 2,
  })

  return async () => {
    await device.stop()
  }
})

describe('DeviceService', () => {
  it('découvre un device non appairé', async () => {
    const devices = await service.discover()

    expect(devices).toEqual([
      {
        id: 'Shapes Salon',
        name: 'Shapes Salon',
        ip: '127.0.0.1',
        port: device.port,
        model: 'NL42',
        firmware: '4.6.2',
        paired: false,
      },
    ])
  })

  it('n expose jamais le token au renderer', async () => {
    device.pairingMode = true
    await service.discover()

    const paired = await service.pair('Shapes Salon')

    expect(paired.paired).toBe(true)
    expect(JSON.stringify(paired)).not.toContain('tok')
  })

  it('appaire puis lit l état', async () => {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Salon')

    const state = await service.getState('Shapes Salon')

    expect(state.brightness).toBe(50)
    expect(state.on).toBe(true)
  })

  it('pilote on/off et luminosité après appairage', async () => {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Salon')

    await service.setOn('Shapes Salon', false)
    await service.setBrightness('Shapes Salon', 30)

    expect(device.state.on).toBe(false)
    expect(device.state.brightness).toBe(30)
  })

  it('renvoie une layout normalisée', async () => {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Salon')

    const layout = await service.getLayout('Shapes Salon')

    expect(layout.panels).toHaveLength(3)
  })

  it('refuse une opération sur un device non appairé', async () => {
    await service.discover()

    await expect(service.getState('Shapes Salon')).rejects.toThrow(/non appairé/i)
  })

  it('liste les devices persistés au démarrage suivant', async () => {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Salon')

    const listed = await service.listDevices()

    expect(listed).toHaveLength(1)
    expect(listed[0]!.paired).toBe(true)
  })
})
```

- [x] **Step 3: Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run src/main/ipc.test.ts`
Expected: FAIL — `Failed to resolve import "./ipc"`

- [x] **Step 4: Écrire le service et l'enregistrement IPC**

`src/main/ipc.ts` :

```ts
import type { DeviceState, PanelLayout } from '../shared/types'
import { IPC_CHANNELS, type RendererDevice } from '../shared/ipc-contract'
import { NanoleafClient } from './device/client'
import { NanoleafError } from './device/errors'
import { discoverDevices, type MdnsFactory } from './device/discovery'
import { pairDevice } from './device/pairing'
import type { ConfigStore, StoredDevice } from './store'

export interface DeviceServiceOptions {
  store: ConfigStore
  mdnsFactory: MdnsFactory
  discoverTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  pairAttempts?: number
}

/**
 * Logique métier derrière les canaux IPC. Sans dépendance à Electron pour
 * rester testable hors application.
 */
export class DeviceService {
  /** Devices vus en mDNS mais pas encore appairés, indexés par id. */
  private readonly seen = new Map<string, { name: string; ip: string; port: number; model?: string; firmware?: string }>()

  constructor(private readonly options: DeviceServiceOptions) {}

  async discover(): Promise<RendererDevice[]> {
    const found = await discoverDevices(this.options.mdnsFactory, {
      timeoutMs: this.options.discoverTimeoutMs ?? 3000,
      sleep: this.options.sleep,
    })

    for (const device of found) {
      this.seen.set(device.id, {
        name: device.name,
        ip: device.ip,
        port: device.port,
        model: device.model,
        firmware: device.firmware,
      })
    }

    return this.listDevices()
  }

  async listDevices(): Promise<RendererDevice[]> {
    const config = await this.options.store.load()
    const merged = new Map<string, RendererDevice>()

    for (const [id, entry] of this.seen) {
      merged.set(id, { id, ...entry, paired: false })
    }

    for (const stored of Object.values(config.devices)) {
      merged.set(stored.id, {
        id: stored.id,
        name: stored.name,
        ip: stored.ip,
        port: stored.port,
        model: merged.get(stored.id)?.model,
        firmware: merged.get(stored.id)?.firmware,
        paired: true,
      })
    }

    return [...merged.values()]
  }

  async pair(deviceId: string): Promise<RendererDevice> {
    const candidate = this.seen.get(deviceId)
    if (candidate === undefined) {
      throw new NanoleafError(`Device inconnu : ${deviceId}`, 404)
    }

    const token = await pairDevice({
      ip: candidate.ip,
      port: candidate.port,
      attempts: this.options.pairAttempts,
      sleep: this.options.sleep,
    })

    const stored: StoredDevice = {
      id: deviceId,
      name: candidate.name,
      ip: candidate.ip,
      port: candidate.port,
      token,
    }
    await this.options.store.upsertDevice(stored)

    return {
      id: stored.id,
      name: stored.name,
      ip: stored.ip,
      port: stored.port,
      model: candidate.model,
      firmware: candidate.firmware,
      paired: true,
    }
  }

  async getState(deviceId: string): Promise<DeviceState> {
    return (await this.client(deviceId)).getState()
  }

  async setOn(deviceId: string, on: boolean): Promise<void> {
    await (await this.client(deviceId)).setOn(on)
  }

  async setBrightness(deviceId: string, value: number): Promise<void> {
    await (await this.client(deviceId)).setBrightness(value)
  }

  async getLayout(deviceId: string): Promise<PanelLayout> {
    return (await this.client(deviceId)).getLayout()
  }

  async getEffects(deviceId: string): Promise<string[]> {
    return (await this.client(deviceId)).getEffects()
  }

  async selectEffect(deviceId: string, name: string): Promise<void> {
    await (await this.client(deviceId)).selectEffect(name)
  }

  /** Construit un client authentifié ; le token reste dans le processus main. */
  private async client(deviceId: string): Promise<NanoleafClient> {
    const config = await this.options.store.load()
    const stored = config.devices[deviceId]
    if (stored === undefined) {
      throw new NanoleafError(`Device non appairé : ${deviceId}`, 401)
    }
    return new NanoleafClient({ ip: stored.ip, token: stored.token, port: stored.port })
  }
}

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: never[]) => unknown): void
}

export function registerIpc(ipcMain: IpcMainLike, service: DeviceService): void {
  ipcMain.handle(IPC_CHANNELS.discover, () => service.discover())
  ipcMain.handle(IPC_CHANNELS.list, () => service.listDevices())
  ipcMain.handle(IPC_CHANNELS.pair, ((_e: unknown, id: string) => service.pair(id)) as never)
  ipcMain.handle(IPC_CHANNELS.getState, ((_e: unknown, id: string) => service.getState(id)) as never)
  ipcMain.handle(
    IPC_CHANNELS.setOn,
    ((_e: unknown, id: string, on: boolean) => service.setOn(id, on)) as never,
  )
  ipcMain.handle(
    IPC_CHANNELS.setBrightness,
    ((_e: unknown, id: string, value: number) => service.setBrightness(id, value)) as never,
  )
  ipcMain.handle(IPC_CHANNELS.getLayout, ((_e: unknown, id: string) => service.getLayout(id)) as never)
  ipcMain.handle(
    IPC_CHANNELS.getEffects,
    ((_e: unknown, id: string) => service.getEffects(id)) as never,
  )
  ipcMain.handle(
    IPC_CHANNELS.selectEffect,
    ((_e: unknown, id: string, name: string) => service.selectEffect(id, name)) as never,
  )
}
```

- [x] **Step 5: Lancer le test et vérifier qu'il passe**

Run: `npx vitest run src/main/ipc.test.ts`
Expected: PASS — 7 tests

- [x] **Step 6: Écrire le processus main et le preload**

`src/main/main.ts` :

```ts
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { createBonjourFactory } from './device/discovery'
import { DeviceService, registerIpc } from './ipc'
import { ConfigStore, defaultConfigPath } from './store'

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    backgroundColor: '#0a0a0c',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (DEV_SERVER_URL !== undefined) {
    void window.loadURL(DEV_SERVER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const service = new DeviceService({
    store: new ConfigStore(defaultConfigPath()),
    mdnsFactory: createBonjourFactory(),
  })
  registerIpc(ipcMain, service)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
```

`src/preload/preload.ts` :

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type NanoleafApi } from '../shared/ipc-contract'

const api: NanoleafApi = {
  discover: () => ipcRenderer.invoke(IPC_CHANNELS.discover),
  pair: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.pair, deviceId),
  listDevices: () => ipcRenderer.invoke(IPC_CHANNELS.list),
  getState: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.getState, deviceId),
  setOn: (deviceId, on) => ipcRenderer.invoke(IPC_CHANNELS.setOn, deviceId, on),
  setBrightness: (deviceId, value) => ipcRenderer.invoke(IPC_CHANNELS.setBrightness, deviceId, value),
  getLayout: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.getLayout, deviceId),
  getEffects: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.getEffects, deviceId),
  selectEffect: (deviceId, name) => ipcRenderer.invoke(IPC_CHANNELS.selectEffect, deviceId, name),
}

contextBridge.exposeInMainWorld('nanoleaf', api)
```

- [x] **Step 7: Écrire le renderer minimal**

Ce renderer n'est **pas** l'interface finale : il ne sert qu'à prouver le chemin complet. Le design du jalon 3 le remplacera.

`vite.config.ts` :

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  base: './',
  build: { outDir: 'dist/renderer', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
})
```

`index.html` :

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Nanoleaf</title>
  </head>
  <body style="margin: 0; background: #0a0a0c; color: #f2f2f5; font-family: system-ui">
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

`src/renderer/main.tsx` :

```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

`src/renderer/App.tsx` :

```tsx
import { useEffect, useState } from 'react'
import type { NanoleafApi, RendererDevice } from '../shared/ipc-contract'
import type { DeviceState, PanelLayout } from '../shared/types'

declare global {
  interface Window {
    nanoleaf: NanoleafApi
  }
}

export function App() {
  const [devices, setDevices] = useState<RendererDevice[]>([])
  const [state, setState] = useState<DeviceState | null>(null)
  const [layout, setLayout] = useState<PanelLayout | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = devices.find((d) => d.paired) ?? devices[0]

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void run(async () => setDevices(await window.nanoleaf.listDevices()))
  }, [])

  return (
    <main style={{ padding: 24, display: 'grid', gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Nanoleaf — socle device</h1>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          disabled={busy}
          onClick={() => void run(async () => setDevices(await window.nanoleaf.discover()))}
        >
          Découvrir
        </button>
        <button
          disabled={busy || active === undefined || active.paired}
          onClick={() =>
            void run(async () => {
              await window.nanoleaf.pair(active!.id)
              setDevices(await window.nanoleaf.listDevices())
            })
          }
        >
          Appairer (maintiens le bouton power 5-7 s)
        </button>
        <button
          disabled={busy || active === undefined || !active.paired}
          onClick={() =>
            void run(async () => {
              setState(await window.nanoleaf.getState(active!.id))
              setLayout(await window.nanoleaf.getLayout(active!.id))
            })
          }
        >
          Lire l'état
        </button>
        <button
          disabled={busy || state === null}
          onClick={() =>
            void run(async () => {
              await window.nanoleaf.setOn(active!.id, !state!.on)
              setState(await window.nanoleaf.getState(active!.id))
            })
          }
        >
          Basculer on/off
        </button>
      </div>

      {error !== null && <p style={{ color: '#ff6b6b' }}>{error}</p>}

      <ul>
        {devices.map((device) => (
          <li key={device.id}>
            {device.name} — {device.ip}:{device.port} — {device.paired ? 'appairé' : 'non appairé'}
          </li>
        ))}
      </ul>

      {state !== null && <pre>{JSON.stringify(state, null, 2)}</pre>}
      {layout !== null && <p>{layout.panels.length} panneaux, aspect {layout.aspect.toFixed(2)}</p>}
    </main>
  )
}
```

- [x] **Step 8: Vérifier la compilation et la suite complète**

Run: `npm run build:main && npx tsc -p tsconfig.json --noEmit && npx vitest run`
Expected: aucune erreur, tous les tests passent (45 au total : 6 + 7 + 9 + 4 + 7 + 5 + 7)

- [x] **Step 9: Vérification manuelle contre le matériel réel**

Lancer, en deux terminaux :

```bash
npm run dev:renderer
```

```bash
VITE_DEV_SERVER_URL=http://localhost:5173 npm run start
```

Checklist, à cocher une par une :

1. « Découvrir » liste les panneaux réels, avec la bonne IP.
2. « Appairer » sans toucher au bouton → l'erreur d'appairage s'affiche après la fenêtre d'essais, l'application reste utilisable.
3. Maintenir le bouton power 5-7 s puis « Appairer » → le device passe à « appairé ».
4. « Lire l'état » affiche la luminosité réelle et le nombre de panneaux réel.
5. « Basculer on/off » éteint puis rallume physiquement les panneaux.
6. Vérifier les permissions du fichier de configuration :
   ```bash
   stat -c '%a %n' ~/.config/nanoleaf-app/config.json
   ```
   Attendu : `600`
7. Relancer l'application → le device apparaît « appairé » sans redécouverte.

- [x] **Step 10: Commit**

```bash
git add src/main/main.ts src/main/ipc.ts src/main/ipc.test.ts src/preload/preload.ts src/shared/ipc-contract.ts src/renderer/main.tsx src/renderer/App.tsx index.html vite.config.ts package.json
git commit -m "feat: coquille Electron et câblage IPC du socle device"
```

---

## Ce que ce jalon ne fait pas

Explicitement hors périmètre, traité dans les jalons suivants :

- Streaming UDP v2 et armement extControl (jalon 2)
- Arbitrage des sources et restauration d'état (jalon 2)
- Canvas WebGL2, roue chromatique, vignettes de scènes (jalon 3)
- Capture d'écran, Worker, pipeline couleur (jalon 4)
- Capture et analyse audio (jalon 5)
- Empaquetage electron-builder
