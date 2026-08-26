# Jalon 2 — Streaming : plan d'implémentation

> **Pour les agents :** SOUS-COMPÉTENCE REQUISE : utiliser superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour dérouler ce plan tâche par tâche. Les étapes se suivent par cases à cocher (`- [ ]`).

**Objectif :** Piloter les panneaux en temps réel — armer le mode External Control v2, encoder et émettre des trames UDP à cadence maîtrisée, arbitrer les sources concurrentes et rendre au device son effet d'origine à l'arrêt.

**Architecture :** Tout vit dans le processus main, dans la continuité du jalon 1. `frame.ts` est un encodeur pur, sans état ni E/S. `rate.ts` est un régulateur de cadence pur, piloté par une horloge injectée. `stream.ts` est le **seul writer** de la socket UDP : il possède l'armement, la sonde de réarmement, l'émission et la restauration d'état. `arbiter.ts` décide qui a le droit d'écrire, sans jamais toucher au réseau. Le renderer ne voit qu'un canal IPC `stream:frame` : il produit des couleurs, il n'ouvre aucune socket.

**Stack technique :** TypeScript, `node:dgram`, Vitest. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/2026-08-20-nanoleaf-linux-design.md` — sections 5.4 (streaming), 8 (arbitrage), 8.1 (restauration d'état), 10.1 et 10.2 (tests).

## Contraintes globales

- Cible : Ubuntu 26.04, Wayland/GNOME, Node v26.
- Port UDP de streaming : **60222**. Encodage **big-endian**.
- `transitionTime = 1` (100 ms) par défaut, jamais 0 : le device interpole lui-même, à 0 le rendu scintille.
- Cadence plafonnée à **25-30 Hz**, avec adaptation à la baisse si la cadence réelle dérive.
- Le mode extControl est **révocable** par l'app mobile ou le bouton physique : sonder l'état toutes les **10 s** pendant un sync et réarmer si nécessaire.
- `stream.ts` est le seul writer de la socket UDP. Toute source passe par `arbiter.ts`.
- Le renderer n'ouvre aucune socket réseau et ne reçoit jamais le token.
- L'effet courant et l'état on/off sont sauvegardés **avant** l'armement et réappliqués à l'arrêt manuel, à la fermeture de la fenêtre et sur `SIGTERM` / `SIGINT`.
- Aucun test ne dépend du matériel : tout passe par `FakeNanoleaf` (REST) et `FakeStreamReceiver` (UDP), ou par des doublures injectées.
- Priorité stricte des sources : `manual` (override 3 s) > `screen` > `audio` > effet du device.

---

### Task 1: Encodage de trame External Control v2

**Fichiers :**
- Créer : `src/main/device/frame.ts`
- Modifier : `src/shared/types.ts`
- Test : `src/main/device/frame.test.ts`

**Interfaces:**
- Consomme : `Color` (`src/shared/types.ts`, jalon 1)
- Produit :
  - `PanelColor { panelId: number; color: Color }`
  - `EXT_CONTROL_EFFECT = '*ExtControl*'` (dans `src/shared/types.ts`)
  - `encodeFrameV2(panels: PanelColor[], transitionTime?: number): Buffer`
  - `FRAME_HEADER_BYTES = 2`, `FRAME_PANEL_BYTES = 8`

- [x] **Step 1: Ajouter les constantes et types partagés**

Ajouter à la fin de `src/shared/types.ts` :

```ts
/**
 * Nom d'effet rapporté par le contrôleur quand le mode External Control est
 * armé. Sert de sonde : si l'effet courant n'est plus celui-ci, une autre
 * source (app mobile, bouton physique) a repris la main.
 */
export const EXT_CONTROL_EFFECT = '*ExtControl*'
```

- [x] **Step 2: Écrire le test qui échoue**

`src/main/device/frame.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { encodeFrameV2, FRAME_HEADER_BYTES, FRAME_PANEL_BYTES } from './frame'

const panel = (panelId: number, r: number, g: number, b: number) => ({
  panelId,
  color: { r, g, b },
})

describe('encodeFrameV2', () => {
  it('encode une trame vide sur deux octets', () => {
    expect(encodeFrameV2([])).toEqual(Buffer.from([0x00, 0x00]))
  })

  it('encode un panneau, big-endian, W à 0 et transitionTime à 1 par défaut', () => {
    expect(encodeFrameV2([panel(1, 255, 0, 128)])).toEqual(
      Buffer.from([0x00, 0x01, 0x00, 0x01, 0xff, 0x00, 0x80, 0x00, 0x00, 0x01]),
    )
  })

  it('encode un panelId au-delà de 255 sur deux octets', () => {
    expect(encodeFrameV2([panel(4660, 0, 0, 0)]).subarray(2, 4)).toEqual(
      Buffer.from([0x12, 0x34]),
    )
  })

  it('respecte la taille annoncée pour plusieurs panneaux', () => {
    const frame = encodeFrameV2([panel(1, 1, 2, 3), panel(2, 4, 5, 6), panel(3, 7, 8, 9)])

    expect(frame.readUInt16BE(0)).toBe(3)
    expect(frame).toHaveLength(FRAME_HEADER_BYTES + 3 * FRAME_PANEL_BYTES)
  })

  it('borne les canaux hors plage', () => {
    const frame = encodeFrameV2([panel(1, 300, -5, 12.7)])

    expect([...frame.subarray(4, 7)]).toEqual([255, 0, 13])
  })

  it('écrit le transitionTime demandé', () => {
    expect(encodeFrameV2([panel(1, 0, 0, 0)], 20).readUInt16BE(8)).toBe(20)
  })

  it('borne le transitionTime dans un uint16', () => {
    expect(encodeFrameV2([panel(1, 0, 0, 0)], 99999).readUInt16BE(8)).toBe(65535)
    expect(encodeFrameV2([panel(1, 0, 0, 0)], -3).readUInt16BE(8)).toBe(0)
  })
})
```

- [x] **Step 3: Lancer le test et vérifier qu'il échoue**

Lancer : `npx vitest run src/main/device/frame.test.ts`
Attendu : FAIL — `Failed to resolve import "./frame"`

- [x] **Step 4: Écrire l'encodeur**

`src/main/device/frame.ts` :

```ts
import type { Color } from '../../shared/types'

/** Couleur destinée à un panneau précis, identifié par son `panelId`. */
export interface PanelColor {
  panelId: number
  color: Color
}

/** `uint16 nPanels`. */
export const FRAME_HEADER_BYTES = 2
/** `uint16 panelId`, `uint8` R, G, B, W, `uint16 transitionTime`. */
export const FRAME_PANEL_BYTES = 8

const clampByte = (value: number): number =>
  Math.min(255, Math.max(0, Math.round(value)))

const clampUint16 = (value: number): number =>
  Math.min(65535, Math.max(0, Math.round(value)))

/**
 * Encode une trame External Control v2, en big-endian.
 *
 * `transitionTime` est exprimé en centaines de millisecondes et vaut 1 par
 * défaut : le contrôleur interpole lui-même entre deux trames, ce qui lisse
 * le rendu et absorbe le jitter réseau. À 0, les panneaux scintillent.
 *
 * Le canal W reste à 0 : les Shapes et les Lines n'ont pas de LED blanche
 * dédiée.
 */
export function encodeFrameV2(panels: PanelColor[], transitionTime = 1): Buffer {
  const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + panels.length * FRAME_PANEL_BYTES)
  const ticks = clampUint16(transitionTime)

  frame.writeUInt16BE(panels.length, 0)

  panels.forEach(({ panelId, color }, index) => {
    const at = FRAME_HEADER_BYTES + index * FRAME_PANEL_BYTES
    frame.writeUInt16BE(clampUint16(panelId), at)
    frame.writeUInt8(clampByte(color.r), at + 2)
    frame.writeUInt8(clampByte(color.g), at + 3)
    frame.writeUInt8(clampByte(color.b), at + 4)
    frame.writeUInt8(0, at + 5)
    frame.writeUInt16BE(ticks, at + 6)
  })

  return frame
}
```

- [x] **Step 5: Lancer le test et vérifier qu'il passe**

Lancer : `npx vitest run src/main/device/frame.test.ts`
Attendu : PASS — 7 tests

- [x] **Step 6: Commit**

```bash
git add src/main/device/frame.ts src/main/device/frame.test.ts src/shared/types.ts
git commit -m "feat: encodage de trame External Control v2"
```

---

### Task 2: Récepteur UDP factice

**Fichiers :**
- Créer : `src/test-support/fake-stream.ts`
- Test : `src/test-support/fake-stream.test.ts`

**Interfaces:**
- Consomme : `encodeFrameV2`, `PanelColor`, `FRAME_HEADER_BYTES`, `FRAME_PANEL_BYTES` (tâche 1)
- Produit :
  - `DecodedFrame { transitionTime: number; panels: PanelColor[] }`
  - `class FakeStreamReceiver` : `frames: DecodedFrame[]`, `port: number`, `start()`, `stop()`, `waitForFrames(count: number, timeoutMs?: number): Promise<DecodedFrame[]>`

- [x] **Step 1: Écrire le test qui échoue**

`src/test-support/fake-stream.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSocket } from 'node:dgram'
import { encodeFrameV2 } from '../main/device/frame'
import { FakeStreamReceiver } from './fake-stream'

let receiver: FakeStreamReceiver

beforeEach(async () => {
  receiver = new FakeStreamReceiver()
  await receiver.start()
})

afterEach(async () => {
  await receiver.stop()
})

const emit = (payload: Buffer): Promise<void> =>
  new Promise((resolve, reject) => {
    const socket = createSocket('udp4')
    socket.send(payload, receiver.port, '127.0.0.1', (err) => {
      socket.close()
      if (err) reject(err)
      else resolve()
    })
  })

describe('FakeStreamReceiver', () => {
  it('décode une trame émise', async () => {
    await emit(encodeFrameV2([{ panelId: 7, color: { r: 10, g: 20, b: 30 } }], 1))

    const [frame] = await receiver.waitForFrames(1)

    expect(frame).toEqual({
      transitionTime: 1,
      panels: [{ panelId: 7, color: { r: 10, g: 20, b: 30 } }],
    })
  })

  it('accumule les trames dans l ordre', async () => {
    await emit(encodeFrameV2([{ panelId: 1, color: { r: 1, g: 0, b: 0 } }]))
    await emit(encodeFrameV2([{ panelId: 2, color: { r: 2, g: 0, b: 0 } }]))

    const frames = await receiver.waitForFrames(2)

    expect(frames.map((f) => f.panels[0]!.panelId)).toEqual([1, 2])
  })

  it('décode une trame vide', async () => {
    await emit(encodeFrameV2([]))

    const [frame] = await receiver.waitForFrames(1)

    expect(frame!.panels).toEqual([])
  })

  it('ignore un datagramme tronqué', async () => {
    await emit(Buffer.from([0x00, 0x02, 0x00, 0x01]))
    await emit(encodeFrameV2([{ panelId: 9, color: { r: 0, g: 0, b: 0 } }]))

    const frames = await receiver.waitForFrames(1)

    expect(frames).toHaveLength(1)
    expect(frames[0]!.panels[0]!.panelId).toBe(9)
  })

  it('rejette si le compte attendu n arrive pas', async () => {
    await expect(receiver.waitForFrames(1, 50)).rejects.toThrow(/trame/i)
  })
})
```

- [x] **Step 2: Lancer le test et vérifier qu'il échoue**

Lancer : `npx vitest run src/test-support/fake-stream.test.ts`
Attendu : FAIL — `Failed to resolve import "./fake-stream"`

- [x] **Step 3: Écrire le récepteur factice**

`src/test-support/fake-stream.ts` :

```ts
import { createSocket, type Socket } from 'node:dgram'
import type { AddressInfo } from 'node:net'
import { FRAME_HEADER_BYTES, FRAME_PANEL_BYTES, type PanelColor } from '../main/device/frame'

export interface DecodedFrame {
  transitionTime: number
  panels: PanelColor[]
}

/**
 * Double de test du port de streaming : décode les trames External Control
 * v2 reçues en UDP, pour couvrir en CI le chemin complet sans matériel.
 */
export class FakeStreamReceiver {
  readonly frames: DecodedFrame[] = []

  private socket: Socket | undefined
  private waiters: Array<() => void> = []

  get port(): number {
    const address = this.socket?.address()
    if (!address || typeof address === 'string') {
      throw new Error('FakeStreamReceiver non démarré')
    }
    return (address as AddressInfo).port
  }

  async start(): Promise<void> {
    const socket = createSocket('udp4')
    socket.on('message', (message) => {
      const frame = decodeFrame(message)
      if (frame === null) return
      this.frames.push(frame)
      for (const notify of this.waiters.splice(0)) notify()
    })
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve))
    this.socket = socket
  }

  async stop(): Promise<void> {
    if (!this.socket) return
    await new Promise<void>((resolve) => this.socket!.close(resolve))
    this.socket = undefined
  }

  /** Attend d'avoir reçu au moins `count` trames, puis les renvoie toutes. */
  async waitForFrames(count: number, timeoutMs = 1000): Promise<DecodedFrame[]> {
    const deadline = Date.now() + timeoutMs

    while (this.frames.length < count) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new Error(`Seulement ${this.frames.length} trame(s) reçue(s) sur ${count} attendue(s)`)
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining)
        this.waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }

    return [...this.frames]
  }
}

/** Inverse de `encodeFrameV2`. Renvoie `null` si le datagramme est malformé. */
function decodeFrame(message: Buffer): DecodedFrame | null {
  if (message.length < FRAME_HEADER_BYTES) return null

  const count = message.readUInt16BE(0)
  if (message.length !== FRAME_HEADER_BYTES + count * FRAME_PANEL_BYTES) return null

  const panels: PanelColor[] = []
  let transitionTime = 0

  for (let index = 0; index < count; index += 1) {
    const at = FRAME_HEADER_BYTES + index * FRAME_PANEL_BYTES
    panels.push({
      panelId: message.readUInt16BE(at),
      color: {
        r: message.readUInt8(at + 2),
        g: message.readUInt8(at + 3),
        b: message.readUInt8(at + 4),
      },
    })
    transitionTime = message.readUInt16BE(at + 6)
  }

  return { transitionTime, panels }
}
```

- [x] **Step 4: Lancer le test et vérifier qu'il passe**

Lancer : `npx vitest run src/test-support/fake-stream.test.ts`
Attendu : PASS — 5 tests

- [x] **Step 5: Commit**

```bash
git add src/test-support/fake-stream.ts src/test-support/fake-stream.test.ts
git commit -m "test: récepteur UDP factice décodant les trames v2"
```

---

### Task 3: Régulateur de cadence

**Fichiers :**
- Créer : `src/main/device/rate.ts`
- Test : `src/main/device/rate.test.ts`

**Interfaces:**
- Consomme : rien
- Produit :
  - `RateGovernorOptions { targetHz?: number; minHz?: number; now?: () => number; driftRatio?: number; patience?: number }`
  - `class RateGovernor` : `shouldSend(): boolean`, `recordSent(): void`, `get hz(): number`, `get intervalMs(): number`

- [x] **Step 1: Écrire le test qui échoue**

`src/main/device/rate.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { RateGovernor } from './rate'

/** Horloge manuelle : le régulateur ne doit jamais lire l'heure système. */
function clock() {
  let value = 0
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms
    },
  }
}

describe('RateGovernor', () => {
  it('démarre à la cadence cible', () => {
    expect(new RateGovernor({ targetHz: 30 }).hz).toBe(30)
    expect(new RateGovernor({ targetHz: 25 }).intervalMs).toBe(40)
  })

  it('autorise le premier envoi', () => {
    expect(new RateGovernor({ now: clock().now }).shouldSend()).toBe(true)
  })

  it('refuse un envoi trop rapproché', () => {
    const time = clock()
    const governor = new RateGovernor({ targetHz: 30, now: time.now })

    governor.recordSent()
    time.advance(10)

    expect(governor.shouldSend()).toBe(false)
  })

  it('autorise l envoi une fois l intervalle écoulé', () => {
    const time = clock()
    const governor = new RateGovernor({ targetHz: 30, now: time.now })

    governor.recordSent()
    time.advance(34)

    expect(governor.shouldSend()).toBe(true)
  })

  it('baisse la cadence après des intervalles trop longs répétés', () => {
    const time = clock()
    const governor = new RateGovernor({ targetHz: 30, now: time.now, patience: 3 })

    governor.recordSent()
    for (let i = 0; i < 3; i += 1) {
      time.advance(120)
      governor.recordSent()
    }

    expect(governor.hz).toBeLessThan(30)
  })

  it('ne descend jamais sous la cadence plancher', () => {
    const time = clock()
    const governor = new RateGovernor({ targetHz: 30, minHz: 10, now: time.now, patience: 1 })

    governor.recordSent()
    for (let i = 0; i < 50; i += 1) {
      time.advance(5000)
      governor.recordSent()
    }

    expect(governor.hz).toBe(10)
  })

  it('remonte vers la cible quand la cadence redevient tenable', () => {
    const time = clock()
    const governor = new RateGovernor({ targetHz: 30, now: time.now, patience: 2 })

    governor.recordSent()
    for (let i = 0; i < 2; i += 1) {
      time.advance(200)
      governor.recordSent()
    }
    const degraded = governor.hz

    for (let i = 0; i < 40; i += 1) {
      time.advance(governor.intervalMs)
      governor.recordSent()
    }

    expect(governor.hz).toBeGreaterThan(degraded)
    expect(governor.hz).toBeLessThanOrEqual(30)
  })

  it('ne dépasse jamais la cadence cible', () => {
    const time = clock()
    const governor = new RateGovernor({ targetHz: 25, now: time.now })

    for (let i = 0; i < 100; i += 1) {
      time.advance(40)
      governor.recordSent()
    }

    expect(governor.hz).toBe(25)
  })
})
```

- [x] **Step 2: Lancer le test et vérifier qu'il échoue**

Lancer : `npx vitest run src/main/device/rate.test.ts`
Attendu : FAIL — `Failed to resolve import "./rate"`

- [x] **Step 3: Écrire le régulateur**

`src/main/device/rate.ts` :

```ts
export interface RateGovernorOptions {
  /** Cadence visée, plafonnée à 30 Hz par la spec. */
  targetHz?: number
  /** Cadence plancher, sous laquelle on ne descend jamais. */
  minHz?: number
  now?: () => number
  /** Au-delà de ce rapport intervalle réel / intervalle visé, ça dérive. */
  driftRatio?: number
  /** Nombre d'intervalles consécutifs avant de réagir. */
  patience?: number
}

const STEP_HZ = 5

/**
 * Régule la cadence d'émission.
 *
 * Au-delà de 25-30 Hz les panneaux droppent des trames de façon visible. Le
 * régulateur plafonne donc la cadence, et la baisse si les envois réels
 * traînent — c'est la boucle appelante qui dérive, pas le réseau, et
 * insister ne ferait qu'aggraver le retard.
 */
export class RateGovernor {
  private readonly targetHz: number
  private readonly minHz: number
  private readonly now: () => number
  private readonly driftRatio: number
  private readonly patience: number

  private currentHz: number
  private lastSentAt: number | null = null
  private drifting = 0
  private healthy = 0

  constructor(options: RateGovernorOptions = {}) {
    this.targetHz = options.targetHz ?? 30
    this.minHz = options.minHz ?? 10
    this.now = options.now ?? Date.now
    this.driftRatio = options.driftRatio ?? 1.25
    this.patience = options.patience ?? 3
    this.currentHz = this.targetHz
  }

  get hz(): number {
    return this.currentHz
  }

  get intervalMs(): number {
    return 1000 / this.currentHz
  }

  /** Vrai si l'intervalle minimal est écoulé depuis le dernier envoi. */
  shouldSend(): boolean {
    if (this.lastSentAt === null) return true
    return this.now() - this.lastSentAt >= this.intervalMs
  }

  /** À appeler juste après un envoi effectif. */
  recordSent(): void {
    const at = this.now()

    if (this.lastSentAt !== null) {
      const elapsed = at - this.lastSentAt
      if (elapsed > this.intervalMs * this.driftRatio) {
        this.drifting += 1
        this.healthy = 0
      } else {
        this.healthy += 1
        this.drifting = 0
      }

      if (this.drifting >= this.patience) {
        this.currentHz = Math.max(this.minHz, this.currentHz - STEP_HZ)
        this.drifting = 0
      } else if (this.healthy >= this.patience * 4) {
        this.currentHz = Math.min(this.targetHz, this.currentHz + STEP_HZ)
        this.healthy = 0
      }
    }

    this.lastSentAt = at
  }
}
```

- [x] **Step 4: Lancer le test et vérifier qu'il passe**

Lancer : `npx vitest run src/main/device/rate.test.ts`
Attendu : PASS — 8 tests

- [x] **Step 5: Commit**

```bash
git add src/main/device/rate.ts src/main/device/rate.test.ts
git commit -m "feat: régulateur de cadence adaptatif pour le streaming"
```

---

### Task 4: Armement, émission et restauration d'état

**Fichiers :**
- Créer : `src/main/device/stream.ts`
- Modifier : `src/main/device/client.ts` (ajout de `enableExternalControl`)
- Modifier : `src/test-support/fake-nanoleaf.ts` (prise en charge de `write.animType = extControl`)
- Test : `src/main/device/stream.test.ts`

**Interfaces:**
- Consomme : `encodeFrameV2`, `PanelColor` (tâche 1), `FakeStreamReceiver` (tâche 2), `RateGovernor` (tâche 3), `NanoleafClient` (jalon 1), `EXT_CONTROL_EFFECT`, `DeviceState` (`src/shared/types.ts`)
- Produit :
  - `UdpSocketLike { send(data, port, address, callback?): void; close(callback?): void }`
  - `SchedulerLike { setInterval(handler, ms): unknown; clearInterval(handle): void }`
  - `PanelStreamOptions { client, ip, port?, socketFactory?, governor?, probeIntervalMs?, scheduler? }`
  - `class PanelStream` : `get armed(): boolean`, `arm(): Promise<void>`, `send(panels: PanelColor[], transitionTime?: number): boolean`, `probe(): Promise<void>`, `stop(): Promise<void>`
  - `NanoleafClient.enableExternalControl(): Promise<void>`
  - `FakeNanoleaf.extControlVersion: string | null`

- [x] **Step 1: Ajouter l'armement au client REST**

Ajouter cette méthode à `NanoleafClient`, dans `src/main/device/client.ts`, juste après `selectEffect` :

```ts
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
```

- [x] **Step 2: Faire reconnaître l'armement au device factice**

Dans `src/test-support/fake-nanoleaf.ts`, ajouter l'import du sentinel en tête de fichier :

```ts
import { EXT_CONTROL_EFFECT, type RawPanel } from '../shared/types'
```

Ajouter le champ public, à côté de `pairingMode` :

```ts
  /** Version d'External Control armée, `null` tant que le mode est inactif. */
  extControlVersion: string | null = null
```

Remplacer le bloc `PUT /effects` de la méthode `handle` par :

```ts
    if (method === 'PUT' && route === '/effects') {
      const payload = (body ?? {}) as {
        select?: string
        write?: { command?: string; animType?: string; extControlVersion?: string }
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
```

- [x] **Step 3: Écrire le test qui échoue**

`src/main/device/stream.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { EXT_CONTROL_EFFECT } from '../../shared/types'
import { FakeNanoleaf } from '../../test-support/fake-nanoleaf'
import { FakeStreamReceiver } from '../../test-support/fake-stream'
import { NanoleafClient } from './client'
import { RateGovernor } from './rate'
import { PanelStream, type SchedulerLike } from './stream'

/** Ordonnanceur manuel : la sonde de réarmement se déclenche à la demande. */
function fakeScheduler(): SchedulerLike & { fire: () => void } {
  let handler: (() => void) | null = null
  return {
    setInterval(fn) {
      handler = fn
      return 1
    },
    clearInterval() {
      handler = null
    },
    fire() {
      handler?.()
    },
  }
}

function clock() {
  let value = 0
  return { now: () => value, advance: (ms: number) => { value += ms } }
}

/**
 * La sonde est déclenchée sans être attendue : elle enchaîne deux
 * allers-retours HTTP, il faut donc sonder le résultat plutôt que céder la
 * main une seule fois.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Condition jamais atteinte')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

let device: FakeNanoleaf
let receiver: FakeStreamReceiver
let scheduler: ReturnType<typeof fakeScheduler>
let stream: PanelStream

const red = [{ panelId: 1, color: { r: 255, g: 0, b: 0 } }]

beforeEach(async () => {
  device = new FakeNanoleaf({ token: 'tok' })
  await device.start()
  device.state.effect = 'Nemo'
  device.state.on = true

  receiver = new FakeStreamReceiver()
  await receiver.start()

  scheduler = fakeScheduler()
  stream = new PanelStream({
    client: new NanoleafClient({ ip: '127.0.0.1', token: 'tok', port: device.port }),
    ip: '127.0.0.1',
    port: receiver.port,
    scheduler,
  })

  return async () => {
    await stream.stop()
    await receiver.stop()
    await device.stop()
  }
})

describe('PanelStream', () => {
  it('arme le mode External Control v2', async () => {
    await stream.arm()

    expect(stream.armed).toBe(true)
    expect(device.extControlVersion).toBe('v2')
  })

  it('n émet rien tant que le mode n est pas armé', async () => {
    expect(stream.send(red)).toBe(false)
    expect(receiver.frames).toEqual([])
  })

  it('émet une trame décodable une fois armé', async () => {
    await stream.arm()

    expect(stream.send(red)).toBe(true)

    const [frame] = await receiver.waitForFrames(1)
    expect(frame).toEqual({ transitionTime: 1, panels: red })
  })

  it('refuse une trame trop rapprochée', async () => {
    const time = clock()
    stream = new PanelStream({
      client: new NanoleafClient({ ip: '127.0.0.1', token: 'tok', port: device.port }),
      ip: '127.0.0.1',
      port: receiver.port,
      scheduler,
      governor: new RateGovernor({ targetHz: 30, now: time.now }),
    })
    await stream.arm()

    expect(stream.send(red)).toBe(true)
    expect(stream.send(red)).toBe(false)

    time.advance(40)
    expect(stream.send(red)).toBe(true)
  })

  it('réarme quand une autre source a repris la main', async () => {
    await stream.arm()
    device.state.effect = 'Northern Lights'
    device.extControlVersion = null

    await stream.probe()

    expect(device.extControlVersion).toBe('v2')
    expect(device.state.effect).toBe(EXT_CONTROL_EFFECT)
  })

  it('ne réarme pas si le mode tient toujours', async () => {
    await stream.arm()
    const armCount = device.requests.filter((r) => r.path.endsWith('/effects')).length

    await stream.probe()

    expect(device.requests.filter((r) => r.path.endsWith('/effects'))).toHaveLength(armCount)
  })

  it('branche la sonde sur l ordonnanceur', async () => {
    await stream.arm()
    device.state.effect = 'Forest'
    device.extControlVersion = null

    scheduler.fire()
    await waitFor(() => device.extControlVersion === 'v2')

    expect(device.extControlVersion).toBe('v2')
  })

  it('restaure l effet et l état on/off à l arrêt', async () => {
    device.state.effect = 'Forest'
    device.state.on = true
    await stream.arm()
    expect(device.state.effect).toBe(EXT_CONTROL_EFFECT)

    await stream.stop()

    expect(stream.armed).toBe(false)
    expect(device.state.effect).toBe('Forest')
    expect(device.state.on).toBe(true)
  })

  it('rallume un device qui était allumé avant l armement', async () => {
    device.state.on = true
    await stream.arm()
    device.state.on = false

    await stream.stop()

    expect(device.state.on).toBe(true)
  })

  it('supporte un arrêt répété', async () => {
    await stream.arm()

    await stream.stop()
    await expect(stream.stop()).resolves.toBeUndefined()
  })

  it('ne réécrase pas l état sauvegardé si on arme deux fois', async () => {
    device.state.effect = 'Forest'
    await stream.arm()
    await stream.arm()

    await stream.stop()

    expect(device.state.effect).toBe('Forest')
  })
})
```

- [x] **Step 4: Lancer le test et vérifier qu'il échoue**

Lancer : `npx vitest run src/main/device/stream.test.ts`
Attendu : FAIL — `Failed to resolve import "./stream"`

- [x] **Step 5: Écrire le streamer**

`src/main/device/stream.ts` :

```ts
import { createSocket } from 'node:dgram'
import { EXT_CONTROL_EFFECT, type DeviceState } from '../../shared/types'
import type { NanoleafClient } from './client'
import { encodeFrameV2, type PanelColor } from './frame'
import { RateGovernor } from './rate'

/** Port UDP d'écoute du contrôleur en mode External Control. */
export const STREAM_PORT = 60222
/** Périodicité de la sonde de réarmement, imposée par la spec. */
export const PROBE_INTERVAL_MS = 10_000

export interface UdpSocketLike {
  send(
    data: Buffer,
    port: number,
    address: string,
    callback?: (error: Error | null) => void,
  ): void
  close(callback?: () => void): void
}

export interface SchedulerLike {
  setInterval(handler: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

export interface PanelStreamOptions {
  client: NanoleafClient
  ip: string
  port?: number
  socketFactory?: () => UdpSocketLike
  governor?: RateGovernor
  probeIntervalMs?: number
  scheduler?: SchedulerLike
}

const defaultScheduler: SchedulerLike = {
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}

/**
 * Seul writer de la socket UDP. Possède l'armement du mode External Control,
 * l'émission des trames, la sonde de réarmement et la restauration de
 * l'état d'origine.
 */
export class PanelStream {
  private readonly client: NanoleafClient
  private readonly ip: string
  private readonly port: number
  private readonly socketFactory: () => UdpSocketLike
  private readonly governor: RateGovernor
  private readonly probeIntervalMs: number
  private readonly scheduler: SchedulerLike

  private socket: UdpSocketLike | undefined
  private probeHandle: unknown = null
  private saved: DeviceState | null = null

  constructor(options: PanelStreamOptions) {
    this.client = options.client
    this.ip = options.ip
    this.port = options.port ?? STREAM_PORT
    this.socketFactory = options.socketFactory ?? (() => createSocket('udp4'))
    this.governor = options.governor ?? new RateGovernor()
    this.probeIntervalMs = options.probeIntervalMs ?? PROBE_INTERVAL_MS
    this.scheduler = options.scheduler ?? defaultScheduler
  }

  get armed(): boolean {
    return this.socket !== undefined
  }

  /**
   * Sauvegarde l'état courant, arme External Control et ouvre la socket.
   * Sans la sauvegarde préalable, les panneaux resteraient figés sur la
   * dernière trame diffusée à l'arrêt.
   */
  async arm(): Promise<void> {
    if (this.saved === null) {
      this.saved = await this.client.getState()
    }

    await this.client.enableExternalControl()

    if (this.socket === undefined) {
      this.socket = this.socketFactory()
    }

    if (this.probeHandle === null) {
      this.probeHandle = this.scheduler.setInterval(() => {
        void this.probe()
      }, this.probeIntervalMs)
    }
  }

  /**
   * Émet une trame. Renvoie `false` si le mode n'est pas armé ou si la
   * cadence maximale est déjà atteinte — l'appelant n'a rien à rattraper.
   */
  send(panels: PanelColor[], transitionTime = 1): boolean {
    if (this.socket === undefined) return false
    if (!this.governor.shouldSend()) return false

    this.socket.send(encodeFrameV2(panels, transitionTime), this.port, this.ip, () => {
      // Un datagramme perdu n'est pas rattrapable : la trame suivante corrige.
    })
    this.governor.recordSent()
    return true
  }

  /** Vérifie que le mode tient toujours, et le réarme sinon. */
  async probe(): Promise<void> {
    if (this.socket === undefined) return

    try {
      const state = await this.client.getState()
      if (state.effect !== EXT_CONTROL_EFFECT) {
        await this.client.enableExternalControl()
      }
    } catch {
      // Device momentanément injoignable : la sonde suivante retentera.
    }
  }

  /** Ferme la socket et rend au device l'effet qu'il affichait. */
  async stop(): Promise<void> {
    if (this.probeHandle !== null) {
      this.scheduler.clearInterval(this.probeHandle)
      this.probeHandle = null
    }

    if (this.socket !== undefined) {
      this.socket.close()
      this.socket = undefined
    }

    const saved = this.saved
    this.saved = null
    if (saved === null) return

    try {
      if (saved.effect !== EXT_CONTROL_EFFECT) {
        await this.client.selectEffect(saved.effect)
      }
      await this.client.setOn(saved.on)
    } catch {
      // Device injoignable à l'arrêt : rien de mieux à tenter.
    }
  }
}
```

- [x] **Step 6: Lancer le test et vérifier qu'il passe**

Lancer : `npx vitest run src/main/device/stream.test.ts`
Attendu : PASS — 11 tests

- [x] **Step 7: Vérifier que la suite complète passe toujours**

Lancer : `npx vitest run`
Attendu : PASS — le device factice modifié ne casse aucun test du jalon 1

- [x] **Step 8: Commit**

```bash
git add src/main/device/stream.ts src/main/device/stream.test.ts src/main/device/client.ts src/test-support/fake-nanoleaf.ts
git commit -m "feat: armement extControl v2, émission UDP et restauration d'état"
```

---

### Task 5: Arbitre de sources

**Fichiers :**
- Créer : `src/main/device/arbiter.ts`
- Modifier : `src/shared/types.ts`
- Test : `src/main/device/arbiter.test.ts`

**Interfaces:**
- Consomme : rien
- Produit :
  - `type SourceId = 'manual' | 'screen' | 'audio'` (dans `src/shared/types.ts`, car le contrat IPC en dépend et le renderer ne doit rien importer du processus main)
  - `MANUAL_HOLD_MS = 3000`
  - `ArbiterOptions { now?: () => number; manualHoldMs?: number }`
  - `class SourceArbiter` : `activate(source)`, `deactivate(source)`, `touchManual()`, `current(): SourceId | null`, `accepts(source): boolean`, `reset()`

- [x] **Step 1: Déclarer le type de source dans le contrat partagé**

Ajouter à la fin de `src/shared/types.ts` :

```ts
/**
 * Sources capables d'écrire sur les panneaux, par priorité décroissante.
 * Déclaré ici parce que le contrat IPC s'en sert : le renderer n'importe
 * jamais depuis le processus main.
 */
export type SourceId = 'manual' | 'screen' | 'audio'
```

- [x] **Step 2: Écrire le test qui échoue**

`src/main/device/arbiter.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { SourceArbiter } from './arbiter'

function clock() {
  let value = 0
  return { now: () => value, advance: (ms: number) => { value += ms } }
}

describe('SourceArbiter', () => {
  it('ne désigne personne quand aucune source n est active', () => {
    expect(new SourceArbiter().current()).toBeNull()
  })

  it('désigne la seule source active', () => {
    const arbiter = new SourceArbiter()
    arbiter.activate('audio')

    expect(arbiter.current()).toBe('audio')
  })

  it('donne l écran devant l audio', () => {
    const arbiter = new SourceArbiter()
    arbiter.activate('audio')
    arbiter.activate('screen')

    expect(arbiter.current()).toBe('screen')
  })

  it('rend la main à l audio quand l écran s arrête', () => {
    const arbiter = new SourceArbiter()
    arbiter.activate('audio')
    arbiter.activate('screen')

    arbiter.deactivate('screen')

    expect(arbiter.current()).toBe('audio')
  })

  it('donne la priorité à la peinture manuelle pendant 3 s', () => {
    const time = clock()
    const arbiter = new SourceArbiter({ now: time.now })
    arbiter.activate('screen')

    arbiter.touchManual()
    expect(arbiter.current()).toBe('manual')

    time.advance(2999)
    expect(arbiter.current()).toBe('manual')
  })

  it('relâche l override manuel passé le délai', () => {
    const time = clock()
    const arbiter = new SourceArbiter({ now: time.now })
    arbiter.activate('screen')
    arbiter.touchManual()

    time.advance(3000)

    expect(arbiter.current()).toBe('screen')
  })

  it('prolonge l override à chaque nouvelle peinture', () => {
    const time = clock()
    const arbiter = new SourceArbiter({ now: time.now })
    arbiter.activate('screen')

    arbiter.touchManual()
    time.advance(2000)
    arbiter.touchManual()
    time.advance(2000)

    expect(arbiter.current()).toBe('manual')
  })

  it('laisse le device à son effet quand l override manuel expire seul', () => {
    const time = clock()
    const arbiter = new SourceArbiter({ now: time.now })
    arbiter.touchManual()

    time.advance(3000)

    expect(arbiter.current()).toBeNull()
  })

  it('n accepte que la source élue', () => {
    const arbiter = new SourceArbiter()
    arbiter.activate('screen')
    arbiter.activate('audio')

    expect(arbiter.accepts('screen')).toBe(true)
    expect(arbiter.accepts('audio')).toBe(false)
    expect(arbiter.accepts('manual')).toBe(false)
  })

  it('oublie tout après reset', () => {
    const arbiter = new SourceArbiter()
    arbiter.activate('screen')
    arbiter.touchManual()

    arbiter.reset()

    expect(arbiter.current()).toBeNull()
  })
})
```

- [x] **Step 3: Lancer le test et vérifier qu'il échoue**

Lancer : `npx vitest run src/main/device/arbiter.test.ts`
Attendu : FAIL — `Failed to resolve import "./arbiter"`

- [x] **Step 4: Écrire l'arbitre**

`src/main/device/arbiter.ts` :

```ts
import type { SourceId } from '../../shared/types'

export type { SourceId }

/** Durée pendant laquelle une peinture manuelle garde la main. */
export const MANUAL_HOLD_MS = 3000

/** Plus le rang est bas, plus la source est prioritaire. */
const RANK: Record<Exclude<SourceId, 'manual'>, number> = {
  screen: 1,
  audio: 2,
}

export interface ArbiterOptions {
  now?: () => number
  manualHoldMs?: number
}

/**
 * Décide quelle source a le droit d'écrire. Ne touche jamais au réseau :
 * `stream.ts` reste le seul writer de la socket.
 *
 * Le mode combiné écran + audio n'apparaît pas ici : la spec en fait un
 * producteur unique lisant deux entrées, pas deux writers concurrents.
 */
export class SourceArbiter {
  private readonly now: () => number
  private readonly manualHoldMs: number
  private readonly active = new Set<Exclude<SourceId, 'manual'>>()
  private manualUntil = 0

  constructor(options: ArbiterOptions = {}) {
    this.now = options.now ?? Date.now
    this.manualHoldMs = options.manualHoldMs ?? MANUAL_HOLD_MS
  }

  activate(source: SourceId): void {
    if (source === 'manual') {
      this.touchManual()
      return
    }
    this.active.add(source)
  }

  deactivate(source: SourceId): void {
    if (source === 'manual') {
      this.manualUntil = 0
      return
    }
    this.active.delete(source)
  }

  /** Signale une peinture manuelle : prend la main pour `manualHoldMs`. */
  touchManual(): void {
    this.manualUntil = this.now() + this.manualHoldMs
  }

  /** Source autorisée à écrire, ou `null` si le device garde son effet. */
  current(): SourceId | null {
    if (this.now() < this.manualUntil) return 'manual'

    let elected: Exclude<SourceId, 'manual'> | null = null
    for (const source of this.active) {
      if (elected === null || RANK[source] < RANK[elected]) elected = source
    }
    return elected
  }

  accepts(source: SourceId): boolean {
    return this.current() === source
  }

  reset(): void {
    this.active.clear()
    this.manualUntil = 0
  }
}
```

- [x] **Step 5: Lancer le test et vérifier qu'il passe**

Lancer : `npx vitest run src/main/device/arbiter.test.ts`
Attendu : PASS — 10 tests

- [x] **Step 6: Commit**

```bash
git add src/main/device/arbiter.ts src/main/device/arbiter.test.ts src/shared/types.ts
git commit -m "feat: arbitrage des sources de streaming par priorité stricte"
```

---

### Task 6: Câblage IPC, arrêt propre et démonstration bout en bout

**Fichiers :**
- Modifier : `src/shared/ipc-contract.ts`
- Modifier : `src/main/ipc.ts`
- Modifier : `src/preload/preload.ts`
- Modifier : `src/main/main.ts`
- Modifier : `src/renderer/App.tsx`
- Test : `src/main/ipc.test.ts` (ajout d'un bloc `describe`)

**Interfaces:**
- Consomme : `PanelStream` (tâche 4), `SourceArbiter`, `SourceId` (tâche 5), `NanoleafClient`, `ConfigStore`, `StoredDevice`, `DeviceService` (jalon 1), `FakeStreamReceiver` (tâche 2)
- Produit :
  - `IPC_CHANNELS.startStream = 'stream:start'`, `IPC_CHANNELS.stopStream = 'stream:stop'`, `IPC_CHANNELS.frame = 'stream:frame'`
  - `NanoleafApi.startStream(deviceId, source)`, `.stopStream(deviceId, source)`, `.sendFrame(deviceId, source, colors, transitionTime?)`
  - `DeviceServiceOptions.arbiter?`, `DeviceServiceOptions.streamFactory?`
  - `DeviceService.startStream`, `.stopStream`, `.sendFrame`, `.shutdown`

- [x] **Step 1: Étendre le contrat IPC**

Dans `src/shared/ipc-contract.ts`, remplacer l'import de tête par :

```ts
import type { Color, DeviceState, PanelLayout, SourceId } from './types'
```

Ajouter ces trois méthodes à `NanoleafApi`, après `selectEffect` :

```ts
  startStream(deviceId: string, source: SourceId): Promise<void>
  stopStream(deviceId: string, source: SourceId): Promise<void>
  sendFrame(
    deviceId: string,
    source: SourceId,
    colors: Color[],
    transitionTime?: number,
  ): Promise<boolean>
```

Ajouter ces trois canaux à `IPC_CHANNELS`, avant la parenthèse fermante :

```ts
  startStream: 'stream:start',
  stopStream: 'stream:stop',
  frame: 'stream:frame',
```

- [x] **Step 2: Écrire le test qui échoue**

Ajouter en tête de `src/main/ipc.test.ts` les imports manquants :

```ts
import { EXT_CONTROL_EFFECT } from '../shared/types'
import { FakeStreamReceiver } from '../test-support/fake-stream'
import { PanelStream } from './device/stream'
```

Ajouter ce bloc à la fin du fichier :

```ts
describe('DeviceService — streaming', () => {
  let receiver: FakeStreamReceiver

  async function paired(): Promise<string> {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Salon')
    return 'Shapes Salon'
  }

  beforeEach(async () => {
    receiver = new FakeStreamReceiver()
    await receiver.start()

    const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-stream-'))
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
      // La sonde de réarmement est neutralisée : ces tests ne la couvrent pas,
      // c'est le rôle de `stream.test.ts`.
      streamFactory: ({ client }) =>
        new PanelStream({
          client,
          ip: '127.0.0.1',
          port: receiver.port,
          scheduler: { setInterval: () => 1, clearInterval: () => {} },
        }),
    })

    return async () => {
      await service.shutdown()
      await receiver.stop()
    }
  })

  it('arme le device au démarrage du stream', async () => {
    const id = await paired()

    await service.startStream(id, 'screen')

    expect(device.extControlVersion).toBe('v2')
    expect(device.state.effect).toBe(EXT_CONTROL_EFFECT)
  })

  it('émet une trame couvrant tous les panneaux du layout', async () => {
    const id = await paired()
    await service.startStream(id, 'screen')

    expect(await service.sendFrame(id, 'screen', [{ r: 255, g: 0, b: 0 }])).toBe(true)

    const [frame] = await receiver.waitForFrames(1)
    expect(frame!.panels.map((p) => p.panelId)).toEqual([1, 2, 3])
    expect(frame!.panels[2]!.color).toEqual({ r: 255, g: 0, b: 0 })
  })

  it('refuse la trame d une source non élue', async () => {
    const id = await paired()
    await service.startStream(id, 'screen')
    await service.startStream(id, 'audio')

    expect(await service.sendFrame(id, 'audio', [{ r: 1, g: 1, b: 1 }])).toBe(false)
  })

  it('donne la main à la peinture manuelle', async () => {
    const id = await paired()
    await service.startStream(id, 'screen')

    expect(await service.sendFrame(id, 'manual', [{ r: 0, g: 255, b: 0 }])).toBe(true)
    expect(await service.sendFrame(id, 'screen', [{ r: 255, g: 0, b: 0 }])).toBe(false)
  })

  it('refuse une trame sans stream armé', async () => {
    const id = await paired()

    expect(await service.sendFrame(id, 'screen', [{ r: 1, g: 1, b: 1 }])).toBe(false)
  })

  it('restaure l effet à l arrêt du stream', async () => {
    const id = await paired()
    device.state.effect = 'Forest'
    await service.startStream(id, 'screen')

    await service.stopStream(id, 'screen')

    expect(device.state.effect).toBe('Forest')
  })

  it('garde le stream armé tant qu une autre source écrit', async () => {
    const id = await paired()
    device.state.effect = 'Forest'
    await service.startStream(id, 'screen')
    await service.startStream(id, 'audio')

    await service.stopStream(id, 'screen')

    expect(device.state.effect).toBe(EXT_CONTROL_EFFECT)
    expect(await service.sendFrame(id, 'audio', [{ r: 1, g: 1, b: 1 }])).toBe(true)
  })

  it('restaure tout à l extinction de l application', async () => {
    const id = await paired()
    device.state.effect = 'Forest'
    await service.startStream(id, 'screen')

    await service.shutdown()

    expect(device.state.effect).toBe('Forest')
  })
})
```

- [x] **Step 3: Lancer le test et vérifier qu'il échoue**

Lancer : `npx vitest run src/main/ipc.test.ts`
Attendu : FAIL — `service.startStream is not a function`

- [x] **Step 4: Étendre `DeviceService`**

Dans `src/main/ipc.ts`, remplacer les imports de tête par :

```ts
import type { Color, DeviceState, PanelLayout, SourceId } from '../shared/types'
import { IPC_CHANNELS, type RendererDevice } from '../shared/ipc-contract'
import { SourceArbiter } from './device/arbiter'
import { NanoleafClient } from './device/client'
import { NanoleafError } from './device/errors'
import { discoverDevices, type MdnsFactory } from './device/discovery'
import { pairDevice } from './device/pairing'
import { PanelStream } from './device/stream'
import type { ConfigStore, StoredDevice } from './store'
```

Étendre `DeviceServiceOptions` :

```ts
export interface DeviceServiceOptions {
  store: ConfigStore
  mdnsFactory: MdnsFactory
  discoverTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  pairAttempts?: number
  arbiter?: SourceArbiter
  /** Injecté par les tests pour viser un récepteur UDP local. */
  streamFactory?: (options: { client: NanoleafClient; ip: string }) => PanelStream
}
```

Ajouter ces champs juste après la déclaration de `seen`, dans la classe :

```ts
  private readonly streams = new Map<string, PanelStream>()
  /** `panelId` dans l'ordre du layout, mémorisé à l'armement. */
  private readonly panelIds = new Map<string, number[]>()
  private readonly arbiter: SourceArbiter
```

Remplacer le constructeur par :

```ts
  constructor(private readonly options: DeviceServiceOptions) {
    this.arbiter = options.arbiter ?? new SourceArbiter()
  }
```

Ajouter ces méthodes après `selectEffect` :

```ts
  /** Arme le mode externe et déclare la source auprès de l'arbitre. */
  async startStream(deviceId: string, source: SourceId): Promise<void> {
    const stored = await this.stored(deviceId)
    const client = new NanoleafClient({
      ip: stored.ip,
      token: stored.token,
      port: stored.port,
    })

    let stream = this.streams.get(deviceId)
    if (stream === undefined) {
      stream =
        this.options.streamFactory?.({ client, ip: stored.ip }) ??
        new PanelStream({ client, ip: stored.ip })
      this.streams.set(deviceId, stream)
    }

    if (!this.panelIds.has(deviceId)) {
      const layout = await client.getLayout()
      this.panelIds.set(
        deviceId,
        layout.panels.map((panel) => panel.panelId),
      )
    }

    await stream.arm()
    this.arbiter.activate(source)
  }

  /** Retire la source ; ne désarme que si plus personne n'écrit. */
  async stopStream(deviceId: string, source: SourceId): Promise<void> {
    this.arbiter.deactivate(source)
    if (this.arbiter.current() !== null) return

    const stream = this.streams.get(deviceId)
    if (stream === undefined) return
    this.streams.delete(deviceId)
    this.panelIds.delete(deviceId)
    await stream.stop()
  }

  /**
   * Diffuse une frame produite par le renderer. Les couleurs sont réparties
   * sur les panneaux dans l'ordre du layout ; une liste plus courte est
   * cyclée. Renvoie `false` si la source n'a pas la main ou si la cadence
   * maximale est déjà atteinte.
   */
  async sendFrame(
    deviceId: string,
    source: SourceId,
    colors: Color[],
    transitionTime?: number,
  ): Promise<boolean> {
    if (source === 'manual') this.arbiter.touchManual()
    if (!this.arbiter.accepts(source)) return false

    const stream = this.streams.get(deviceId)
    const panelIds = this.panelIds.get(deviceId)
    if (stream === undefined || panelIds === undefined || colors.length === 0) return false

    return stream.send(
      panelIds.map((panelId, index) => ({ panelId, color: colors[index % colors.length]! })),
      transitionTime,
    )
  }

  /** Rend son effet à chaque device. Appelé à la fermeture et sur signal. */
  async shutdown(): Promise<void> {
    const streams = [...this.streams.values()]
    this.streams.clear()
    this.panelIds.clear()
    this.arbiter.reset()
    await Promise.all(streams.map((stream) => stream.stop()))
  }
```

Remplacer la méthode privée `client` par ces deux méthodes :

```ts
  private async stored(deviceId: string): Promise<StoredDevice> {
    const config = await this.options.store.load()
    const stored = config.devices[deviceId]
    if (stored === undefined) {
      throw new NanoleafError(`Device non appairé : ${deviceId}`, 401)
    }
    return stored
  }

  /** Construit un client authentifié ; le token reste dans le processus main. */
  private async client(deviceId: string): Promise<NanoleafClient> {
    const stored = await this.stored(deviceId)
    return new NanoleafClient({ ip: stored.ip, token: stored.token, port: stored.port })
  }
```

Ajouter les trois canaux dans `registerIpc`, avant la parenthèse fermante :

```ts
  ipcMain.handle(IPC_CHANNELS.startStream, (_event, id: string, source: SourceId) =>
    service.startStream(id, source),
  )
  ipcMain.handle(IPC_CHANNELS.stopStream, (_event, id: string, source: SourceId) =>
    service.stopStream(id, source),
  )
  ipcMain.handle(
    IPC_CHANNELS.frame,
    (_event, id: string, source: SourceId, colors: Color[], transitionTime?: number) =>
      service.sendFrame(id, source, colors, transitionTime),
  )
```

- [x] **Step 5: Lancer le test et vérifier qu'il passe**

Lancer : `npx vitest run src/main/ipc.test.ts`
Attendu : PASS — 15 tests

- [x] **Step 6: Exposer les canaux au renderer**

Dans `src/preload/preload.ts`, ajouter ces trois entrées à l'objet `api`, après `selectEffect` :

```ts
  startStream: (deviceId, source) => ipcRenderer.invoke(IPC_CHANNELS.startStream, deviceId, source),
  stopStream: (deviceId, source) => ipcRenderer.invoke(IPC_CHANNELS.stopStream, deviceId, source),
  sendFrame: (deviceId, source, colors, transitionTime) =>
    ipcRenderer.invoke(IPC_CHANNELS.frame, deviceId, source, colors, transitionTime),
```

- [x] **Step 7: Restaurer l'état à l'extinction du processus main**

Dans `src/main/main.ts`, remplacer le bloc `app.whenReady()` et le gestionnaire `window-all-closed` par :

```ts
let service: DeviceService | undefined
let quitting = false

async function shutdown(): Promise<void> {
  await service?.shutdown()
}

app.whenReady().then(() => {
  service = new DeviceService({
    store: new ConfigStore(defaultConfigPath()),
    mdnsFactory: createMdnsFactory(),
  })
  registerIpc(ipcMain, service)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Sans cette restauration, les panneaux resteraient figés sur la dernière
// trame diffusée.
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void shutdown().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  app.quit()
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void shutdown().finally(() => process.exit(0))
  })
}
```

- [x] **Step 8: Ajouter la démonstration au renderer**

Ce balayage n'est **pas** la fonctionnalité finale : il prouve le chemin complet renderer → IPC → UDP → panneaux, en attendant le sync écran du jalon 4.

Ajouter en tête de `src/renderer/App.tsx`, après les imports :

```tsx
/** Teinte [0,1] vers RGB saturé, pour la démonstration de balayage. */
function hueToRgb(hue: number): { r: number; g: number; b: number } {
  const sector = (((hue % 1) + 1) % 1) * 6
  const rising = Math.round((sector % 1) * 255)
  switch (Math.floor(sector)) {
    case 0:
      return { r: 255, g: rising, b: 0 }
    case 1:
      return { r: 255 - rising, g: 255, b: 0 }
    case 2:
      return { r: 0, g: 255, b: rising }
    case 3:
      return { r: 0, g: 255 - rising, b: 255 }
    case 4:
      return { r: rising, g: 0, b: 255 }
    default:
      return { r: 255, g: 0, b: 255 - rising }
  }
}
```

Ajouter cet état, à côté des autres `useState` :

```tsx
  const [streaming, setStreaming] = useState(false)
```

Ajouter cet effet, après le `useEffect` existant :

```tsx
  useEffect(() => {
    if (!streaming || active === undefined || layout === null) return

    const count = layout.panels.length
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const phase = (Date.now() - startedAt) / 4000
      const colors = Array.from({ length: count }, (_, index) =>
        hueToRgb(phase + index / count),
      )
      void window.nanoleaf.sendFrame(active.id, 'screen', colors)
    }, 40)

    return () => clearInterval(timer)
  }, [streaming, active, layout])
```

Ajouter ces deux boutons dans la barre d'actions, après « Basculer on/off » :

```tsx
        <button
          disabled={busy || streaming || active === undefined || !active.paired}
          onClick={() =>
            void run(async () => {
              setLayout(await window.nanoleaf.getLayout(active!.id))
              await window.nanoleaf.startStream(active!.id, 'screen')
              setStreaming(true)
            })
          }
        >
          Démarrer le balayage
        </button>
        <button
          disabled={busy || !streaming}
          onClick={() =>
            void run(async () => {
              setStreaming(false)
              await window.nanoleaf.stopStream(active!.id, 'screen')
            })
          }
        >
          Arrêter le balayage
        </button>
```

- [x] **Step 9: Vérifier la compilation et la suite complète**

Lancer : `npm run build:main && npx tsc -p tsconfig.json --noEmit && npm run build:renderer && npx vitest run`
Attendu : aucune erreur, tous les tests passent

- [ ] **Step 10: Vérification manuelle contre le matériel réel** — points 1, 3 et 4 déjà validés en tête-à-tête avec le matériel (armement, réarmement après reprise externe, restauration de l'effet) ; les points 2, 5, 6 et 7 demandent l'interface et un œil humain.

```bash
npm run dev:renderer
```

```bash
VITE_DEV_SERVER_URL=http://localhost:5173 npm run start
```

Checklist, à cocher une par une :

1. « Découvrir » puis « Lire l'état » → le nombre de panneaux réel s'affiche.
2. « Démarrer le balayage » → les panneaux défilent en arc-en-ciel, sans scintillement.
3. Pendant le balayage, sélectionner un effet depuis l'app mobile Nanoleaf → dans les 10 s, le balayage reprend la main (sonde de réarmement).
4. « Arrêter le balayage » → les panneaux retrouvent l'effet affiché avant le démarrage.
5. Relancer le balayage, puis fermer la fenêtre → les panneaux retrouvent leur effet.
6. Relancer le balayage, puis `Ctrl+C` dans le terminal `npm run start` → les panneaux retrouvent leur effet.
7. Mesurer la charge pendant un balayage : `top -p $(pgrep -f 'electron .' | head -1)` → objectif sous 10 % d'un cœur.

- [x] **Step 11: Commit**

```bash
git add src/shared/ipc-contract.ts src/main/ipc.ts src/main/ipc.test.ts src/preload/preload.ts src/main/main.ts src/renderer/App.tsx
git commit -m "feat: câblage IPC du streaming, arrêt propre et balayage de démonstration"
```

---

## Ce que ce jalon ne fait pas

Explicitement hors périmètre, traité dans les jalons suivants :

- Canvas WebGL2, roue chromatique, vignettes de scènes (jalon 3)
- Capture d'écran, Worker, pipeline couleur, détection de letterbox (jalon 4)
- Capture et analyse audio, mode combiné écran + audio (jalon 5)
- Empaquetage electron-builder
