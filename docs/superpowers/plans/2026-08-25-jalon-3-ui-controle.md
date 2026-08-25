# Jalon 3 — UI de contrôle : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à l'application sa première interface présentable — le mur de panneaux rendu en WebGL2 à sa géométrie réelle, une roue chromatique, la luminosité, l'allumage, la peinture d'un panneau au clic, et une grille de scènes bâtie sur les palettes réelles du device.

**Architecture:** Le processus main ne gagne qu'une chose : la lecture des palettes d'effets et la peinture d'un panneau, toutes deux derrière l'IPC existant. Tout le reste vit dans le renderer. La géométrie des panneaux et les conversions de couleur sont des fonctions pures placées dans `src/shared/`, testées sans DOM ni GPU ; le rendu WebGL2 se réduit à un module qui consomme ces fonctions, et seule sa partie non graphique est couverte par les tests. Les écrans sont deux composants React frères sous une navigation triviale.

**Tech Stack:** Electron, React, TypeScript, WebGL2 sans bibliothèque tierce, Vite, Vitest. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/2026-08-20-nanoleaf-linux-design.md` — sections 3 (stack), 5.3 (REST), 8 (arbitrage), 9 (interface).

## Global Constraints

- Cible : Ubuntu 26.04, Wayland/GNOME, Node v26.
- Rendu du layout en **WebGL2 sans bibliothèque tierce**.
- Fenêtre sombre, **frameless avec zone de drag**, une vue principale unique.
- Animations limitées à `transform` et `opacity` — **aucun recalcul de layout** pendant qu'un sync tourne à 30 Hz.
- Le renderer n'ouvre aucune socket réseau et ne reçoit jamais le token.
- Le clic sur un panneau déclenche l'override manuel du §8 : priorité `manual` pendant 3 s.
- Les vignettes de scènes sont bâties sur les **palettes réelles** du device, pas sur des couleurs inventées.
- Thread UI : **jamais sous 60 fps** pendant un sync.
- Aucun test ne dépend du matériel, du DOM ni d'un contexte GPU.

### Ce que le matériel dit, vérifié avant d'écrire ce plan

Réponse réelle de `GET /panelLayout/layout` sur le Shapes 83DC :

```json
{ "numPanels": 10, "sideLength": 134,
  "positionData": [
    { "panelId": 34992, "x": 81,  "y": 0,   "o": 0,   "shapeType": 8 },
    { "panelId": 55008, "x": 148, "y": 39,  "o": 300, "shapeType": 8 },
    { "panelId": 0,     "x": 56,  "y": 53,  "o": 60,  "shapeType": 12 }
  ] }
```

`shapeType 8` = triangle Shapes ; `shapeType 12` = contrôleur, déjà filtré par
`normalizeLayout` sur `panelId === 0`. `o` est en degrés, sens trigonométrique
dans le repère du device (axe Y vers le haut).

Réponse réelle de `PUT /effects` avec `{"write":{"command":"requestAll"}}` :

```json
{ "animations": [
    { "animName": "Blaze", "colorType": "HSB",
      "palette": [ { "hue": 36, "saturation": 92, "brightness": 92, "probability": 0.0 } ] }
  ] }
```

16 effets, 9 Ko, un seul aller-retour : c'est la source des vignettes.

---

### Task 1: Palettes des effets

**Files:**
- Create: `src/shared/color.ts`
- Test: `src/shared/color.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/device/client.ts`
- Modify: `src/test-support/fake-nanoleaf.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/preload/preload.ts`
- Test: `src/main/ipc.test.ts` (ajout d'un bloc `describe`)

**Interfaces:**
- Consumes: `Color`, `NanoleafClient`, `DeviceService`, `IPC_CHANNELS`, `NanoleafApi` (jalons 1-2)
- Produces:
  - `EffectPalette { name: string; colors: Color[] }` (dans `src/shared/types.ts`)
  - `hsbToRgb(hue: number, saturation: number, brightness: number): Color` (dans `src/shared/color.ts`)
  - `NanoleafClient.getEffectPalettes(): Promise<EffectPalette[]>`
  - `DeviceService.getEffectPalettes(deviceId: string): Promise<EffectPalette[]>`
  - `IPC_CHANNELS.effectPalettes = 'effects:palettes'`
  - `NanoleafApi.getEffectPalettes(deviceId: string): Promise<EffectPalette[]>`
  - `FakeNanoleaf.palettes: Record<string, Array<{ hue: number; saturation: number; brightness: number }>>`

- [ ] **Step 1: Déclarer le type partagé**

Ajouter à la fin de `src/shared/types.ts` :

```ts
/** Palette d'un effet du device, convertie en RGB pour l'affichage. */
export interface EffectPalette {
  name: string
  colors: Color[]
}
```

- [ ] **Step 2: Écrire le test de conversion qui échoue**

`src/shared/color.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { hsbToRgb } from './color'

describe('hsbToRgb', () => {
  it('convertit les primaires saturées', () => {
    expect(hsbToRgb(0, 100, 100)).toEqual({ r: 255, g: 0, b: 0 })
    expect(hsbToRgb(120, 100, 100)).toEqual({ r: 0, g: 255, b: 0 })
    expect(hsbToRgb(240, 100, 100)).toEqual({ r: 0, g: 0, b: 255 })
  })

  it('rend du blanc sans saturation et du noir sans luminosité', () => {
    expect(hsbToRgb(210, 0, 100)).toEqual({ r: 255, g: 255, b: 255 })
    expect(hsbToRgb(210, 80, 0)).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('convertit une entrée réelle de la palette Blaze', () => {
    expect(hsbToRgb(36, 92, 92)).toEqual({ r: 235, g: 148, b: 19 })
  })

  it('referme la roue : 360 équivaut à 0', () => {
    expect(hsbToRgb(360, 100, 100)).toEqual(hsbToRgb(0, 100, 100))
  })

  it('borne les entrées hors plage', () => {
    expect(hsbToRgb(0, 500, 500)).toEqual({ r: 255, g: 0, b: 0 })
    expect(hsbToRgb(0, -20, -20)).toEqual({ r: 0, g: 0, b: 0 })
  })
})
```

- [ ] **Step 3: Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run src/shared/color.test.ts`
Expected: FAIL — `Failed to resolve import "./color"`

- [ ] **Step 4: Écrire la conversion**

`src/shared/color.ts` :

```ts
import type { Color } from './types'

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * Convertit le HSB du device en RGB. Le device exprime la teinte en degrés
 * et la saturation comme la luminosité en pourcentage.
 */
export function hsbToRgb(hue: number, saturation: number, brightness: number): Color {
  const h = ((hue % 360) + 360) % 360
  const s = clamp(saturation, 0, 100) / 100
  const v = clamp(brightness, 0, 100) / 100

  const chroma = v * s
  const sector = h / 60
  const second = chroma * (1 - Math.abs((sector % 2) - 1))
  const floor = v - chroma

  const [r, g, b] =
    sector < 1 ? [chroma, second, 0]
    : sector < 2 ? [second, chroma, 0]
    : sector < 3 ? [0, chroma, second]
    : sector < 4 ? [0, second, chroma]
    : sector < 5 ? [second, 0, chroma]
    : [chroma, 0, second]

  return {
    r: Math.round((r + floor) * 255),
    g: Math.round((g + floor) * 255),
    b: Math.round((b + floor) * 255),
  }
}
```

- [ ] **Step 5: Lancer le test et vérifier qu'il passe**

Run: `npx vitest run src/shared/color.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 6: Faire servir les palettes par le device factice**

Dans `src/test-support/fake-nanoleaf.ts`, ajouter ce champ public à côté de `effects` :

```ts
  /** Palettes HSB renvoyées par `requestAll`, indexées par nom d'effet. */
  palettes: Record<string, Array<{ hue: number; saturation: number; brightness: number }>> = {
    Nemo: [
      { hue: 200, saturation: 90, brightness: 80 },
      { hue: 220, saturation: 70, brightness: 60 },
    ],
    'Northern Lights': [{ hue: 140, saturation: 100, brightness: 90 }],
    Forest: [{ hue: 100, saturation: 80, brightness: 50 }],
  }
```

Dans la méthode `handle`, à l'intérieur du bloc `PUT /effects`, insérer cette
branche **avant** le test sur `payload.write?.command === 'display'` :

```ts
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
```

Le type de `payload` déclaré dans ce bloc doit accepter la nouvelle commande :

```ts
      const payload = (body ?? {}) as {
        select?: string
        write?: {
          command?: string
          animName?: string
          animType?: string
          extControlVersion?: string
        }
      }
```

- [ ] **Step 7: Écrire le test du client et du service qui échoue**

Ajouter ce bloc à la fin de `src/main/ipc.test.ts` :

```ts
describe('DeviceService — palettes', () => {
  it('renvoie les palettes converties en RGB', async () => {
    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Salon')

    const palettes = await service.getEffectPalettes('Shapes Salon')

    expect(palettes).toHaveLength(3)
    expect(palettes[1]).toEqual({
      name: 'Northern Lights',
      colors: [{ r: 0, g: 230, b: 77 }],
    })
  })

  it('tolère un effet sans palette', async () => {
    device.pairingMode = true
    device.effects = ['Vide']
    device.palettes = {}
    await service.discover()
    await service.pair('Shapes Salon')

    expect(await service.getEffectPalettes('Shapes Salon')).toEqual([
      { name: 'Vide', colors: [] },
    ])
  })
})
```

- [ ] **Step 8: Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run src/main/ipc.test.ts`
Expected: FAIL — `service.getEffectPalettes is not a function`

- [ ] **Step 9: Lire les palettes depuis le client REST**

Dans `src/main/device/client.ts`, remplacer l'import de tête par :

```ts
import type { Color, DeviceState, EffectPalette, PanelLayout, RawPanel } from '../../shared/types'
```

et ajouter l'import de la conversion, juste en dessous des imports existants :

```ts
import { hsbToRgb } from '../../shared/color'
```

Ajouter cette interface à côté de `LayoutResponse` :

```ts
interface AnimationsResponse {
  animations?: Array<{
    animName?: string
    palette?: Array<{ hue?: number; saturation?: number; brightness?: number }>
  }>
}
```

Ajouter cette méthode juste après `selectEffect` :

```ts
  /**
   * Récupère toutes les palettes d'un coup. `requestAll` est un `PUT` qui ne
   * modifie rien : c'est la seule route qui expose les couleurs réelles des
   * effets, `effectsList` n'en donne que les noms.
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
```

- [ ] **Step 10: Exposer les palettes par l'IPC**

Dans `src/shared/ipc-contract.ts`, remplacer l'import de tête par :

```ts
import type { Color, DeviceState, EffectPalette, PanelLayout, SourceId } from './types'
```

Ajouter cette méthode à `NanoleafApi`, après `getEffects` :

```ts
  getEffectPalettes(deviceId: string): Promise<EffectPalette[]>
```

Ajouter ce canal à `IPC_CHANNELS`, après `getEffects` :

```ts
  effectPalettes: 'effects:palettes',
```

Dans `src/main/ipc.ts`, remplacer l'import de tête des types par :

```ts
import type { Color, DeviceState, EffectPalette, PanelLayout, SourceId } from '../shared/types'
```

Ajouter cette méthode juste après `getEffects` :

```ts
  async getEffectPalettes(deviceId: string): Promise<EffectPalette[]> {
    return (await this.client(deviceId)).getEffectPalettes()
  }
```

Ajouter ce handler dans `registerIpc`, après celui de `getEffects` :

```ts
  ipcMain.handle(IPC_CHANNELS.effectPalettes, (_event, id: string) =>
    service.getEffectPalettes(id),
  )
```

Dans `src/preload/preload.ts`, ajouter cette entrée à l'objet `api`, après `getEffects` :

```ts
  getEffectPalettes: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.effectPalettes, deviceId),
```

- [ ] **Step 11: Lancer les tests et vérifier qu'ils passent**

Run: `npx vitest run`
Expected: PASS — les 107 tests du jalon 2 plus 7 nouveaux

- [ ] **Step 12: Commit**

```bash
git add src/shared/color.ts src/shared/color.test.ts src/shared/types.ts src/main/device/client.ts src/test-support/fake-nanoleaf.ts src/main/ipc.ts src/main/ipc.test.ts src/shared/ipc-contract.ts src/preload/preload.ts
git commit -m "feat: lecture des palettes d'effets du device"
```

---

### Task 2: Géométrie de rendu des panneaux

**Files:**
- Create: `src/shared/geometry.ts`
- Test: `src/shared/geometry.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/device/layout.ts`
- Modify: `src/main/device/layout.test.ts`

**Interfaces:**
- Consumes: `NormalizedPanel`, `PanelLayout` (jalon 1)
- Produces:
  - `PanelLayout.nSideLength: number` — côté d'un panneau dans le même espace normalisé que `nx`/`ny`
  - `Point { x: number; y: number }` (dans `src/shared/geometry.ts`)
  - `SHAPE_GEOMETRY: Record<number, { sides: number; baseAngleDeg: number }>`
  - `panelPolygon(panel: NormalizedPanel, nSideLength: number): Point[]`
  - `circumradius(sides: number, sideLength: number): number`

- [ ] **Step 1: Écrire le test qui échoue**

`src/shared/geometry.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { circumradius, panelPolygon } from './geometry'
import type { NormalizedPanel } from './types'

const panel = (over: Partial<NormalizedPanel> = {}): NormalizedPanel => ({
  panelId: 1,
  x: 0,
  y: 0,
  o: 0,
  shapeType: 8,
  nx: 0.5,
  ny: 0.5,
  ...over,
})

const near = (value: number, expected: number) => expect(value).toBeCloseTo(expected, 6)

describe('circumradius', () => {
  it('vaut le côté divisé par racine de trois pour un triangle', () => {
    near(circumradius(3, 1), 1 / Math.sqrt(3))
  })

  it('vaut le côté pour un hexagone', () => {
    near(circumradius(6, 1), 1)
  })
})

describe('panelPolygon', () => {
  it('rend trois sommets pour un triangle Shapes', () => {
    expect(panelPolygon(panel({ shapeType: 8 }), 0.2)).toHaveLength(3)
  })

  it('rend six sommets pour un hexagone Shapes', () => {
    expect(panelPolygon(panel({ shapeType: 7 }), 0.2)).toHaveLength(6)
  })

  it('rend quatre sommets pour un carré Canvas', () => {
    expect(panelPolygon(panel({ shapeType: 2 }), 0.2)).toHaveLength(4)
  })

  it('retombe sur un carré pour une forme inconnue', () => {
    expect(panelPolygon(panel({ shapeType: 999 }), 0.2)).toHaveLength(4)
  })

  it('place chaque sommet à la distance du rayon circonscrit', () => {
    const points = panelPolygon(panel(), 0.3)

    for (const point of points) {
      near(Math.hypot(point.x - 0.5, point.y - 0.5), circumradius(3, 0.3))
    }
  })

  it('pointe un sommet vers le haut à orientation nulle', () => {
    const [first] = panelPolygon(panel({ o: 0 }), 0.3)

    near(first!.x, 0.5)
    expect(first!.y).toBeLessThan(0.5)
  })

  it('retourne le triangle à 180 degrés', () => {
    const [first] = panelPolygon(panel({ o: 180 }), 0.3)

    near(first!.x, 0.5)
    expect(first!.y).toBeGreaterThan(0.5)
  })

  it('tourne dans le sens des aiguilles, l axe Y étant inversé à l écran', () => {
    const [first] = panelPolygon(panel({ o: 90 }), 0.3)

    near(first!.y, 0.5)
    expect(first!.x).toBeLessThan(0.5)
  })

  it('centre le polygone sur la position normalisée du panneau', () => {
    const points = panelPolygon(panel({ nx: 0.25, ny: 0.75 }), 0.3)
    const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length
    const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length

    near(cx, 0.25)
    near(cy, 0.75)
  })
})
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run src/shared/geometry.test.ts`
Expected: FAIL — `Failed to resolve import "./geometry"`

- [ ] **Step 3: Écrire la géométrie**

`src/shared/geometry.ts` :

```ts
import type { NormalizedPanel } from './types'

export interface Point {
  x: number
  y: number
}

/**
 * Formes connues du device, indexées par `shapeType`.
 *
 * `baseAngleDeg` est l'angle du premier sommet à orientation nulle, mesuré
 * dans le repère écran (Y vers le bas) : -90° pointe vers le haut. Les
 * triangles Shapes ont une pointe en haut, les hexagones sont à sommet plat,
 * les carrés ont leurs arêtes parallèles aux axes.
 */
export const SHAPE_GEOMETRY: Record<number, { sides: number; baseAngleDeg: number }> = {
  0: { sides: 3, baseAngleDeg: -90 },  // triangle Aurora
  1: { sides: 3, baseAngleDeg: -90 },  // Rhythm
  2: { sides: 4, baseAngleDeg: -45 },  // carré Canvas
  3: { sides: 4, baseAngleDeg: -45 },  // carré de contrôle Canvas
  4: { sides: 4, baseAngleDeg: -45 },  // carré de contrôle passif
  7: { sides: 6, baseAngleDeg: 0 },    // hexagone Shapes
  8: { sides: 3, baseAngleDeg: -90 },  // triangle Shapes
  9: { sides: 3, baseAngleDeg: -90 },  // mini triangle Shapes
  14: { sides: 6, baseAngleDeg: 0 },   // hexagone Elements
  15: { sides: 6, baseAngleDeg: 0 },
  16: { sides: 6, baseAngleDeg: 0 },
}

const FALLBACK = { sides: 4, baseAngleDeg: -45 }

/** Rayon du cercle circonscrit d'un polygone régulier. */
export function circumradius(sides: number, sideLength: number): number {
  return sideLength / (2 * Math.sin(Math.PI / sides))
}

/**
 * Sommets d'un panneau dans l'espace normalisé, prêts pour le rendu.
 *
 * Le device mesure `o` dans le sens trigonométrique avec un axe Y vers le
 * haut ; `normalizeLayout` ayant inversé cet axe, la rotation devient
 * horaire ici, d'où le signe négatif.
 */
export function panelPolygon(panel: NormalizedPanel, nSideLength: number): Point[] {
  const shape = SHAPE_GEOMETRY[panel.shapeType] ?? FALLBACK
  const radius = circumradius(shape.sides, nSideLength)
  const step = 360 / shape.sides

  return Array.from({ length: shape.sides }, (_, index) => {
    const angle = ((shape.baseAngleDeg - panel.o + index * step) * Math.PI) / 180
    return {
      x: panel.nx + radius * Math.cos(angle),
      y: panel.ny + radius * Math.sin(angle),
    }
  })
}
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `npx vitest run src/shared/geometry.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Écrire le test du côté normalisé qui échoue**

Ajouter ce bloc à la fin de `src/main/device/layout.test.ts` :

```ts
describe('normalizeLayout — côté normalisé', () => {
  it('exprime le côté dans la même échelle que nx et ny', () => {
    const layout = normalizeLayout(
      [
        { panelId: 1, x: 0, y: 0, o: 0, shapeType: 8 },
        { panelId: 2, x: 200, y: 0, o: 0, shapeType: 8 },
      ],
      100,
    )

    expect(layout.nSideLength).toBeCloseTo(0.5, 6)
  })

  it('remplit le carré quand un seul panneau est présent', () => {
    const layout = normalizeLayout([{ panelId: 1, x: 5, y: 5, o: 0, shapeType: 8 }], 100)

    expect(layout.nSideLength).toBe(1)
  })

  it('renvoie un côté nul quand aucun panneau n est éclairable', () => {
    expect(normalizeLayout([{ panelId: 0, x: 0, y: 0, o: 0, shapeType: 12 }], 100).nSideLength)
      .toBe(0)
  })
})
```

- [ ] **Step 6: Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run src/main/device/layout.test.ts`
Expected: FAIL — `expected undefined to be close to 0.5`

- [ ] **Step 7: Publier le côté normalisé**

Dans `src/shared/types.ts`, ajouter ce champ à `PanelLayout`, après `sideLength` :

```ts
  /** Côté d'un panneau, dans la même échelle normalisée que `nx` et `ny`. */
  nSideLength: number
```

Dans `src/main/device/layout.ts`, remplacer les trois `return` de la fonction par :

```ts
  if (usable.length === 0) {
    return { sideLength, nSideLength: 0, aspect: 1, panels: [] }
  }
```

```ts
  if (scale === 0) {
    const panels: NormalizedPanel[] = usable.map((p) => ({ ...p, nx: 0.5, ny: 0.5 }))
    return { sideLength, nSideLength: 1, aspect, panels }
  }
```

```ts
  return {
    sideLength,
    nSideLength: sideLength / scale,
    aspect,
    panels,
  }
```

- [ ] **Step 8: Lancer la suite complète et vérifier qu'elle passe**

Run: `npx vitest run`
Expected: PASS — aucun test du jalon 1 ou 2 ne casse

- [ ] **Step 9: Commit**

```bash
git add src/shared/geometry.ts src/shared/geometry.test.ts src/shared/types.ts src/main/device/layout.ts src/main/device/layout.test.ts
git commit -m "feat: géométrie de rendu des panneaux"
```

---

### Task 3: Maillage du mur et rendu WebGL2

**Files:**
- Create: `src/renderer/gl/mesh.ts`
- Test: `src/renderer/gl/mesh.test.ts`
- Create: `src/renderer/gl/wall.ts`

**Interfaces:**
- Consumes: `panelPolygon`, `Point` (tâche 2), `PanelLayout`, `Color`
- Produces:
  - `WallMesh { positions: Float32Array; panelIndices: Float32Array; vertexCount: number }`
  - `buildPanelMesh(layout: PanelLayout): WallMesh`
  - `buildHaloMesh(layout: PanelLayout, spread?: number): WallMesh & { offsets: Float32Array }`
  - `MAX_PANELS = 128`
  - `createWallRenderer(canvas: HTMLCanvasElement, layout: PanelLayout): WallRenderer`
  - `WallRenderer { draw(colors: Map<number, Color>): void; resize(): void; dispose(): void }`

- [ ] **Step 1: Écrire le test qui échoue**

`src/renderer/gl/mesh.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { buildHaloMesh, buildPanelMesh } from './mesh'
import { normalizeLayout } from '../../main/device/layout'
import type { PanelLayout } from '../../shared/types'

const triangles = (count: number): PanelLayout =>
  normalizeLayout(
    Array.from({ length: count }, (_, index) => ({
      panelId: index + 1,
      x: index * 100,
      y: 0,
      o: 0,
      shapeType: 8,
    })),
    100,
  )

describe('buildPanelMesh', () => {
  it('triangule chaque panneau en éventail', () => {
    const mesh = buildPanelMesh(triangles(2))

    // Deux triangles : (3 - 2) triangles par panneau, 3 sommets chacun.
    expect(mesh.vertexCount).toBe(2 * 3)
    expect(mesh.positions).toHaveLength(2 * 3 * 2)
  })

  it('produit six sommets par hexagone', () => {
    const layout = normalizeLayout(
      [
        { panelId: 1, x: 0, y: 0, o: 0, shapeType: 7 },
        { panelId: 2, x: 200, y: 0, o: 0, shapeType: 7 },
      ],
      100,
    )

    // (6 - 2) triangles, 3 sommets chacun.
    expect(buildPanelMesh(layout).vertexCount).toBe(2 * 12)
  })

  it('associe chaque sommet à l indice de son panneau', () => {
    const mesh = buildPanelMesh(triangles(2))

    expect([...mesh.panelIndices]).toEqual([0, 0, 0, 1, 1, 1])
  })

  it('rend un maillage vide sans panneau', () => {
    const mesh = buildPanelMesh(normalizeLayout([], 100))

    expect(mesh.vertexCount).toBe(0)
    expect(mesh.positions).toHaveLength(0)
  })

  it('garde les sommets dans le carré normalisé, marges comprises', () => {
    const mesh = buildPanelMesh(triangles(3))

    for (const value of mesh.positions) {
      expect(value).toBeGreaterThan(-1)
      expect(value).toBeLessThan(2)
    }
  })
})

describe('buildHaloMesh', () => {
  it('rend deux triangles par panneau', () => {
    const mesh = buildHaloMesh(triangles(2))

    expect(mesh.vertexCount).toBe(2 * 6)
  })

  it('porte un décalage unitaire par sommet pour la décroissance radiale', () => {
    const mesh = buildHaloMesh(triangles(1))

    expect(mesh.offsets).toHaveLength(6 * 2)
    for (const value of mesh.offsets) {
      expect(Math.abs(value)).toBeCloseTo(1, 6)
    }
  })

  it('déborde du panneau proportionnellement à l étalement', () => {
    const serré = buildHaloMesh(triangles(1), 1)
    const large = buildHaloMesh(triangles(1), 3)
    const étendue = (m: { positions: Float32Array }) =>
      Math.max(...m.positions) - Math.min(...m.positions)

    expect(étendue(large)).toBeGreaterThan(étendue(serré))
  })
})
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run src/renderer/gl/mesh.test.ts`
Expected: FAIL — `Failed to resolve import "./mesh"`

- [ ] **Step 3: Écrire le maillage**

`src/renderer/gl/mesh.ts` :

```ts
import { panelPolygon } from '../../shared/geometry'
import type { PanelLayout } from '../../shared/types'

/** Nombre maximal de panneaux adressables par le tableau d'uniformes. */
export const MAX_PANELS = 128

export interface WallMesh {
  /** Paires x,y en espace normalisé. */
  positions: Float32Array
  /** Indice du panneau, un par sommet. */
  panelIndices: Float32Array
  vertexCount: number
}

/**
 * Triangule chaque panneau en éventail depuis son premier sommet. Les formes
 * du device sont toutes convexes, l'éventail suffit donc et évite d'avoir à
 * indexer les sommets.
 */
export function buildPanelMesh(layout: PanelLayout): WallMesh {
  const positions: number[] = []
  const panelIndices: number[] = []

  layout.panels.forEach((panel, panelIndex) => {
    const points = panelPolygon(panel, layout.nSideLength)

    for (let corner = 1; corner < points.length - 1; corner += 1) {
      for (const point of [points[0]!, points[corner]!, points[corner + 1]!]) {
        positions.push(point.x, point.y)
        panelIndices.push(panelIndex)
      }
    }
  })

  return {
    positions: new Float32Array(positions),
    panelIndices: new Float32Array(panelIndices),
    vertexCount: panelIndices.length,
  }
}

/**
 * Un quad centré sur chaque panneau, plus large que lui, porteur du halo.
 * `offsets` donne à chaque sommet sa position dans le carré unité centré, ce
 * qui laisse le fragment shader calculer la décroissance radiale sans avoir
 * besoin du centre du panneau.
 */
export function buildHaloMesh(
  layout: PanelLayout,
  spread = 2.2,
): WallMesh & { offsets: Float32Array } {
  const positions: number[] = []
  const panelIndices: number[] = []
  const offsets: number[] = []

  const corners: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, -1],
    [1, 1],
    [-1, 1],
  ]
  const reach = layout.nSideLength * spread

  layout.panels.forEach((panel, panelIndex) => {
    for (const [ox, oy] of corners) {
      positions.push(panel.nx + ox * reach, panel.ny + oy * reach)
      offsets.push(ox, oy)
      panelIndices.push(panelIndex)
    }
  })

  return {
    positions: new Float32Array(positions),
    panelIndices: new Float32Array(panelIndices),
    offsets: new Float32Array(offsets),
    vertexCount: panelIndices.length,
  }
}
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `npx vitest run src/renderer/gl/mesh.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Écrire le rendu WebGL2**

Ce module ouvre un contexte GPU : il n'est pas couvert par les tests, la CI
n'ayant pas de GPU. Sa logique testable vit dans `mesh.ts`.

`src/renderer/gl/wall.ts` :

```ts
import { buildHaloMesh, buildPanelMesh, MAX_PANELS, type WallMesh } from './mesh'
import type { Color, PanelLayout } from '../../shared/types'

export interface WallRenderer {
  draw(colors: Map<number, Color>): void
  resize(): void
  dispose(): void
}

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
in float aPanelIndex;
in vec2 aOffset;
uniform vec2 uScale;
out vec3 vColor;
out vec2 vOffset;
uniform vec3 uColors[${MAX_PANELS}];

void main() {
  vColor = uColors[int(aPanelIndex)];
  vOffset = aOffset;
  // [0,1] vers le repère de clip, en conservant le rapport d'aspect.
  vec2 centered = (aPosition - 0.5) * 2.0 * uScale;
  gl_Position = vec4(centered.x, -centered.y, 0.0, 1.0);
}`

const PANEL_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vColor;
in vec2 vOffset;
out vec4 outColor;

void main() {
  outColor = vec4(vColor, 1.0);
}`

const HALO_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vColor;
in vec2 vOffset;
out vec4 outColor;

void main() {
  float distance = length(vOffset);
  // Décroissance douce : opaque au centre, nulle au bord du quad.
  float falloff = pow(max(0.0, 1.0 - distance), 3.0);
  outColor = vec4(vColor * falloff, falloff);
}`

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (shader === null) throw new Error('Shader non alloué')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Compilation du shader : ${gl.getShaderInfoLog(shader) ?? 'inconnue'}`)
  }
  return shader
}

function link(gl: WebGL2RenderingContext, fragmentSource: string): WebGLProgram {
  const program = gl.createProgram()
  if (program === null) throw new Error('Programme non alloué')
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Édition de liens : ${gl.getProgramInfoLog(program) ?? 'inconnue'}`)
  }
  return program
}

function upload(gl: WebGL2RenderingContext, data: Float32Array): WebGLBuffer {
  const buffer = gl.createBuffer()
  if (buffer === null) throw new Error('Tampon non alloué')
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
  return buffer
}

function bindAttribute(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  buffer: WebGLBuffer,
  size: number,
): void {
  const location = gl.getAttribLocation(program, name)
  if (location < 0) return
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
}

/**
 * Dessine le mur : un halo diffus par panneau, puis le panneau lui-même.
 * Les couleurs passent par un tableau d'uniformes indexé par panneau, ce qui
 * évite de reconstruire le moindre tampon à chaque frame — seul l'uniforme
 * change, à 30 Hz.
 */
export function createWallRenderer(
  canvas: HTMLCanvasElement,
  layout: PanelLayout,
): WallRenderer {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true })
  if (gl === null) throw new Error('WebGL2 indisponible')

  const panelMesh = buildPanelMesh(layout)
  const haloMesh = buildHaloMesh(layout)

  const panelProgram = link(gl, PANEL_FRAGMENT_SHADER)
  const haloProgram = link(gl, HALO_FRAGMENT_SHADER)

  const zeros = new Float32Array(panelMesh.vertexCount * 2)
  const buffers = {
    panelPosition: upload(gl, panelMesh.positions),
    panelIndex: upload(gl, panelMesh.panelIndices),
    panelOffset: upload(gl, zeros),
    haloPosition: upload(gl, haloMesh.positions),
    haloIndex: upload(gl, haloMesh.panelIndices),
    haloOffset: upload(gl, haloMesh.offsets),
  }

  const flat = new Float32Array(MAX_PANELS * 3)

  const fillColors = (colors: Map<number, Color>): void => {
    layout.panels.forEach((panel, index) => {
      if (index >= MAX_PANELS) return
      const color = colors.get(panel.panelId) ?? { r: 0, g: 0, b: 0 }
      flat[index * 3] = color.r / 255
      flat[index * 3 + 1] = color.g / 255
      flat[index * 3 + 2] = color.b / 255
    })
  }

  /** Marges pour que le mur tienne dans le canvas quel que soit son ratio. */
  const scaleFor = (): [number, number] => {
    const canvasAspect = canvas.width / canvas.height
    return canvasAspect > layout.aspect
      ? [layout.aspect / canvasAspect, 1]
      : [1, canvasAspect / layout.aspect]
  }

  const drawMesh = (
    program: WebGLProgram,
    mesh: WallMesh,
    position: WebGLBuffer,
    index: WebGLBuffer,
    offset: WebGLBuffer,
  ): void => {
    if (mesh.vertexCount === 0) return
    gl.useProgram(program)
    bindAttribute(gl, program, 'aPosition', position, 2)
    bindAttribute(gl, program, 'aPanelIndex', index, 1)
    bindAttribute(gl, program, 'aOffset', offset, 2)
    gl.uniform2fv(gl.getUniformLocation(program, 'uScale'), scaleFor())
    gl.uniform3fv(gl.getUniformLocation(program, 'uColors'), flat)
    gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount)
  }

  return {
    draw(colors) {
      fillColors(colors)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
      drawMesh(haloProgram, haloMesh, buffers.haloPosition, buffers.haloIndex, buffers.haloOffset)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      drawMesh(
        panelProgram,
        panelMesh,
        buffers.panelPosition,
        buffers.panelIndex,
        buffers.panelOffset,
      )
    },

    resize() {
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(canvas.clientWidth * ratio)
      canvas.height = Math.round(canvas.clientHeight * ratio)
    },

    dispose() {
      for (const buffer of Object.values(buffers)) gl.deleteBuffer(buffer)
      gl.deleteProgram(panelProgram)
      gl.deleteProgram(haloProgram)
    },
  }
}
```

- [ ] **Step 6: Vérifier la compilation et la suite complète**

Run: `npx tsc -p tsconfig.json --noEmit && npx vitest run`
Expected: aucune erreur, tous les tests passent

- [ ] **Step 7: Commit**

```bash
git add src/renderer/gl/mesh.ts src/renderer/gl/mesh.test.ts src/renderer/gl/wall.ts
git commit -m "feat: maillage du mur et rendu WebGL2"
```

---

### Task 4: Roue chromatique

**Files:**
- Modify: `src/shared/color.ts`
- Modify: `src/shared/color.test.ts`
- Create: `src/renderer/components/ColorWheel.tsx`

**Interfaces:**
- Consumes: `hsbToRgb` (tâche 1)
- Produces:
  - `WheelPosition { hue: number; sat: number }`
  - `wheelToHsv(dx: number, dy: number, radius: number): WheelPosition | null`
  - `hsvToWheel(hue: number, sat: number, radius: number): { dx: number; dy: number }`
  - `<ColorWheel hue={number} sat={number} size={number} onPick={(p: WheelPosition) => void} />`

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter ce bloc à la fin de `src/shared/color.test.ts`, et compléter l'import de
tête en `import { hsbToRgb, hsvToWheel, wheelToHsv } from './color'` :

```ts
describe('wheelToHsv', () => {
  it('rend une saturation nulle au centre', () => {
    expect(wheelToHsv(0, 0, 100)?.sat).toBe(0)
  })

  it('rend une saturation pleine au bord', () => {
    expect(wheelToHsv(100, 0, 100)?.sat).toBe(100)
  })

  it('place le rouge à droite et fait tourner la teinte dans le sens horaire', () => {
    expect(wheelToHsv(100, 0, 100)?.hue).toBeCloseTo(0, 6)
    expect(wheelToHsv(0, 100, 100)?.hue).toBeCloseTo(90, 6)
    expect(wheelToHsv(-100, 0, 100)?.hue).toBeCloseTo(180, 6)
  })

  it('ignore un point hors du disque', () => {
    expect(wheelToHsv(101, 0, 100)).toBeNull()
  })

  it('accepte un rayon nul sans diviser par zéro', () => {
    expect(wheelToHsv(0, 0, 0)).toEqual({ hue: 0, sat: 0 })
  })
})

describe('hsvToWheel', () => {
  it('ramène le centre pour une saturation nulle', () => {
    expect(hsvToWheel(210, 0, 100)).toEqual({ dx: 0, dy: 0 })
  })

  it('fait l aller-retour sans perte', () => {
    const back = wheelToHsv(hsvToWheel(200, 60, 100).dx, hsvToWheel(200, 60, 100).dy, 100)

    expect(back?.hue).toBeCloseTo(200, 6)
    expect(back?.sat).toBeCloseTo(60, 6)
  })
})
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run src/shared/color.test.ts`
Expected: FAIL — `wheelToHsv is not a function`

- [ ] **Step 3: Écrire les conversions de la roue**

Ajouter à la fin de `src/shared/color.ts` :

```ts
export interface WheelPosition {
  hue: number
  sat: number
}

/**
 * Position dans la roue vers teinte et saturation.
 *
 * `dx`/`dy` sont relatifs au centre, en pixels, axe Y vers le bas comme à
 * l'écran. Le rouge est à droite et la teinte croît dans le sens horaire,
 * ce qui correspond à l'ordre visuel du dégradé dessiné par `ColorWheel`.
 * Renvoie `null` hors du disque : le clic n'a pas visé la roue.
 */
export function wheelToHsv(dx: number, dy: number, radius: number): WheelPosition | null {
  const distance = Math.hypot(dx, dy)
  if (radius <= 0) return { hue: 0, sat: 0 }
  if (distance > radius) return null

  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI
  return {
    hue: ((degrees % 360) + 360) % 360,
    sat: (distance / radius) * 100,
  }
}

/** Inverse de `wheelToHsv`, pour placer le curseur sur la roue. */
export function hsvToWheel(hue: number, sat: number, radius: number): { dx: number; dy: number } {
  const angle = (hue * Math.PI) / 180
  const distance = (clamp(sat, 0, 100) / 100) * radius
  return { dx: distance * Math.cos(angle), dy: distance * Math.sin(angle) }
}
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `npx vitest run src/shared/color.test.ts`
Expected: PASS — 12 tests

- [ ] **Step 5: Écrire le composant**

`src/renderer/components/ColorWheel.tsx` :

```tsx
import { useEffect, useRef } from 'react'
import { hsbToRgb, hsvToWheel, wheelToHsv, type WheelPosition } from '../../shared/color'

interface ColorWheelProps {
  hue: number
  sat: number
  size: number
  onPick: (position: WheelPosition) => void
}

/**
 * Roue teinte/saturation dessinée une fois en 2D, puis seulement recouverte
 * d'un curseur : rien ne se redessine pendant qu'un sync tourne.
 */
export function ColorWheel({ hue, sat, size, onPick }: ColorWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const radius = size / 2

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return

    const image = context.createImageData(size, size)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const position = wheelToHsv(x - radius + 0.5, y - radius + 0.5, radius)
        const at = (y * size + x) * 4
        if (position === null) {
          image.data[at + 3] = 0
          continue
        }
        const { r, g, b } = hsbToRgb(position.hue, position.sat, 100)
        image.data[at] = r
        image.data[at + 1] = g
        image.data[at + 2] = b
        image.data[at + 3] = 255
      }
    }
    context.putImageData(image, 0, 0)
  }, [size, radius])

  const pick = (event: React.PointerEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const position = wheelToHsv(
      event.clientX - bounds.left - radius,
      event.clientY - bounds.top - radius,
      radius,
    )
    if (position !== null) onPick(position)
  }

  const cursor = hsvToWheel(hue, sat, radius)

  return (
    <div
      style={{ position: 'relative', width: size, height: size, touchAction: 'none' }}
      onPointerDown={pick}
      onPointerMove={(event) => {
        if (event.buttons === 1) pick(event)
      }}
    >
      <canvas ref={canvasRef} width={size} height={size} style={{ borderRadius: '50%' }} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 14,
          height: 14,
          marginLeft: -7,
          marginTop: -7,
          borderRadius: '50%',
          border: '2px solid #fff',
          boxShadow: '0 0 6px rgba(0,0,0,0.6)',
          pointerEvents: 'none',
          transform: `translate(${radius + cursor.dx}px, ${radius + cursor.dy}px)`,
        }}
      />
    </div>
  )
}
```

- [ ] **Step 6: Vérifier la compilation**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: aucune erreur

- [ ] **Step 7: Commit**

```bash
git add src/shared/color.ts src/shared/color.test.ts src/renderer/components/ColorWheel.tsx
git commit -m "feat: roue chromatique teinte et saturation"
```

---

### Task 5: Peinture d'un panneau et réglage de couleur

**Files:**
- Modify: `src/shared/geometry.ts`
- Modify: `src/shared/geometry.test.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/preload/preload.ts`
- Test: `src/main/ipc.test.ts` (ajout d'un bloc `describe`)

**Interfaces:**
- Consumes: `panelPolygon`, `Point` (tâche 2), `DeviceService`, `SourceArbiter`, `PanelStream` (jalon 2)
- Produces:
  - `pointInPolygon(point: Point, polygon: Point[]): boolean`
  - `panelAt(layout: PanelLayout, point: Point): NormalizedPanel | null`
  - `DeviceService.paintPanel(deviceId: string, panelId: number, color: Color): Promise<boolean>`
  - `DeviceService.setColor(deviceId: string, hue: number, sat: number): Promise<void>`
  - `IPC_CHANNELS.paintPanel = 'devices:paintPanel'`, `IPC_CHANNELS.setColor = 'devices:setColor'`
  - `NanoleafApi.paintPanel(deviceId, panelId, color): Promise<boolean>`
  - `NanoleafApi.setColor(deviceId, hue, sat): Promise<void>`

- [ ] **Step 1: Écrire le test de désignation qui échoue**

Ajouter ce bloc à la fin de `src/shared/geometry.test.ts`, et compléter
l'import de tête en
`import { circumradius, panelAt, panelPolygon, pointInPolygon } from './geometry'` ;
ajouter `import { normalizeLayout } from '../main/device/layout'` :

```ts
describe('pointInPolygon', () => {
  const carré = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]

  it('accepte un point intérieur', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, carré)).toBe(true)
  })

  it('refuse un point extérieur', () => {
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, carré)).toBe(false)
  })

  it('refuse un polygone dégénéré', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBe(false)
  })
})

describe('panelAt', () => {
  const layout = normalizeLayout(
    [
      { panelId: 11, x: 0, y: 0, o: 0, shapeType: 8 },
      { panelId: 22, x: 300, y: 0, o: 0, shapeType: 8 },
    ],
    100,
  )

  it('désigne le panneau sous le point', () => {
    const cible = layout.panels[1]!

    expect(panelAt(layout, { x: cible.nx, y: cible.ny })?.panelId).toBe(22)
  })

  it('ne désigne rien dans le vide', () => {
    expect(panelAt(layout, { x: 0.5, y: 0.02 })).toBeNull()
  })
})
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run src/shared/geometry.test.ts`
Expected: FAIL — `pointInPolygon is not a function`

- [ ] **Step 3: Écrire la désignation**

Ajouter à la fin de `src/shared/geometry.ts`, et compléter l'import de tête en
`import type { NormalizedPanel, PanelLayout } from './types'` :

```ts
/** Test d'appartenance par lancer de rayon, valable pour tout polygone simple. */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false

  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!
    const b = polygon[j]!
    const crosses = a.y > point.y !== b.y > point.y
    if (!crosses) continue
    const cut = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (point.x < cut) inside = !inside
  }
  return inside
}

/**
 * Panneau situé sous un point, en espace normalisé. Le dernier panneau de la
 * liste l'emporte en cas de chevauchement : c'est celui dessiné par-dessus.
 */
export function panelAt(layout: PanelLayout, point: Point): NormalizedPanel | null {
  for (let index = layout.panels.length - 1; index >= 0; index -= 1) {
    const panel = layout.panels[index]!
    if (pointInPolygon(point, panelPolygon(panel, layout.nSideLength))) return panel
  }
  return null
}
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

Run: `npx vitest run src/shared/geometry.test.ts`
Expected: PASS — 16 tests

- [ ] **Step 5: Écrire le test de peinture qui échoue**

Ajouter ce bloc à la fin de `src/main/ipc.test.ts` :

```ts
describe('DeviceService — peinture manuelle', () => {
  let receiver: FakeStreamReceiver

  beforeEach(async () => {
    receiver = new FakeStreamReceiver()
    await receiver.start()

    const dir = await mkdtemp(join(tmpdir(), 'nanoleaf-paint-'))
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
      streamFactory: ({ client }) =>
        new PanelStream({
          client,
          ip: '127.0.0.1',
          port: receiver.port,
          scheduler: { setInterval: () => 1, clearInterval: () => {} },
        }),
    })

    device.pairingMode = true
    await service.discover()
    await service.pair('Shapes Salon')

    return async () => {
      await service.shutdown()
      await receiver.stop()
    }
  })

  it('arme le stream toute seule au premier clic', async () => {
    expect(await service.paintPanel('Shapes Salon', 2, { r: 255, g: 0, b: 0 })).toBe(true)

    expect(device.extControlVersion).toBe('v2')
  })

  it('ne peint que le panneau visé, les autres restent éteints', async () => {
    await service.paintPanel('Shapes Salon', 2, { r: 255, g: 0, b: 0 })

    const [frame] = await receiver.waitForFrames(1)
    expect(frame!.panels).toEqual([
      { panelId: 1, color: { r: 0, g: 0, b: 0 } },
      { panelId: 2, color: { r: 255, g: 0, b: 0 } },
      { panelId: 3, color: { r: 0, g: 0, b: 0 } },
    ])
  })

  it('conserve les panneaux déjà peints', async () => {
    await service.paintPanel('Shapes Salon', 1, { r: 255, g: 0, b: 0 })
    await new Promise((resolve) => setTimeout(resolve, 40))
    await service.paintPanel('Shapes Salon', 3, { r: 0, g: 0, b: 255 })

    const frames = await receiver.waitForFrames(2)
    expect(frames[1]!.panels[0]!.color).toEqual({ r: 255, g: 0, b: 0 })
    expect(frames[1]!.panels[2]!.color).toEqual({ r: 0, g: 0, b: 255 })
  })

  it('oublie la peinture à l extinction', async () => {
    await service.paintPanel('Shapes Salon', 1, { r: 255, g: 0, b: 0 })

    await service.shutdown()

    expect(device.state.effect).toBe('Nemo')
  })

  it('règle teinte et saturation par le REST', async () => {
    await service.setColor('Shapes Salon', 200, 80)

    expect(device.state.hue).toBe(200)
    expect(device.state.sat).toBe(80)
  })
})
```

- [ ] **Step 6: Lancer le test et vérifier qu'il échoue**

Run: `npx vitest run src/main/ipc.test.ts`
Expected: FAIL — `service.paintPanel is not a function`

- [ ] **Step 7: Écrire la peinture et le réglage de couleur**

Dans `src/main/ipc.ts`, ajouter ce champ à côté de `panelIds` :

```ts
  /** Dernière couleur posée sur chaque panneau, par device. */
  private readonly painted = new Map<string, Map<number, Color>>()
```

Ajouter ces deux méthodes juste après `sendFrame` :

```ts
  /**
   * Peint un panneau et rediffuse le mur entier : le protocole v2 n'a pas de
   * trame partielle. Les panneaux jamais peints restent noirs — leur couleur
   * d'avant l'armement n'est pas récupérable.
   *
   * Arme le stream au besoin : cliquer un panneau doit suffire, sans avoir à
   * démarrer un sync au préalable.
   */
  async paintPanel(deviceId: string, panelId: number, color: Color): Promise<boolean> {
    if (!this.streams.has(deviceId)) {
      await this.startStream(deviceId, 'manual')
    }

    const panelIds = this.panelIds.get(deviceId)
    if (panelIds === undefined) return false

    let painted = this.painted.get(deviceId)
    if (painted === undefined) {
      painted = new Map<number, Color>()
      this.painted.set(deviceId, painted)
    }
    painted.set(panelId, color)

    return this.sendFrame(
      deviceId,
      'manual',
      panelIds.map((id) => painted.get(id) ?? { r: 0, g: 0, b: 0 }),
    )
  }

  async setColor(deviceId: string, hue: number, sat: number): Promise<void> {
    const client = await this.client(deviceId)
    await client.setHue(hue)
    await client.setSat(sat)
  }
```

Dans `stopStream`, ajouter cette ligne juste après `this.panelIds.delete(deviceId)` :

```ts
    this.painted.delete(deviceId)
```

Dans `shutdown`, ajouter cette ligne juste après `this.panelIds.clear()` :

```ts
    this.painted.clear()
```

Dans `src/shared/ipc-contract.ts`, ajouter ces méthodes à `NanoleafApi`, après `sendFrame` :

```ts
  paintPanel(deviceId: string, panelId: number, color: Color): Promise<boolean>
  setColor(deviceId: string, hue: number, sat: number): Promise<void>
```

et ces canaux à `IPC_CHANNELS` :

```ts
  paintPanel: 'devices:paintPanel',
  setColor: 'devices:setColor',
```

Ajouter ces handlers dans `registerIpc` :

```ts
  ipcMain.handle(
    IPC_CHANNELS.paintPanel,
    (_event, id: string, panelId: number, color: Color) =>
      service.paintPanel(id, panelId, color),
  )
  ipcMain.handle(IPC_CHANNELS.setColor, (_event, id: string, hue: number, sat: number) =>
    service.setColor(id, hue, sat),
  )
```

Dans `src/preload/preload.ts`, ajouter ces entrées à l'objet `api` :

```ts
  paintPanel: (deviceId, panelId, color) =>
    ipcRenderer.invoke(IPC_CHANNELS.paintPanel, deviceId, panelId, color),
  setColor: (deviceId, hue, sat) => ipcRenderer.invoke(IPC_CHANNELS.setColor, deviceId, hue, sat),
```

- [ ] **Step 8: Lancer la suite complète et vérifier qu'elle passe**

Run: `npx vitest run`
Expected: PASS — tous les tests, y compris les 5 nouveaux

- [ ] **Step 9: Commit**

```bash
git add src/shared/geometry.ts src/shared/geometry.test.ts src/main/ipc.ts src/main/ipc.test.ts src/shared/ipc-contract.ts src/preload/preload.ts
git commit -m "feat: peinture d'un panneau au clic et réglage de couleur"
```

---

### Task 6: Coquille frameless et écran Contrôle

**Files:**
- Create: `src/renderer/styles.css`
- Create: `src/renderer/useNanoleaf.ts`
- Create: `src/renderer/components/WallCanvas.tsx`
- Create: `src/renderer/screens/ControlScreen.tsx`
- Modify: `src/renderer/main.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/main/main.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/shared/ipc-contract.ts`
- Modify: `src/preload/preload.ts`

**Interfaces:**
- Consumes: `createWallRenderer`, `WallRenderer` (tâche 3), `ColorWheel`, `WheelPosition` (tâche 4), `panelAt` (tâche 5), `NanoleafApi`, `RendererDevice`, `DeviceState`, `PanelLayout`, `Color`
- Produces:
  - `IPC_CHANNELS.windowMinimize = 'window:minimize'`, `IPC_CHANNELS.windowClose = 'window:close'`
  - `NanoleafApi.minimizeWindow(): Promise<void>`, `NanoleafApi.closeWindow(): Promise<void>`
  - `useNanoleaf(bridge: NanoleafApi): NanoleafSession`
  - `NanoleafSession { device, state, layout, palettes, colors, busy, error, discover, pair, refresh, setOn, setBrightness, setColor, paint, selectEffect }`
  - `<WallCanvas layout={PanelLayout} colors={Map<number, Color>} onPaint={(panelId: number) => void} />`
  - `<ControlScreen session={NanoleafSession} />`

- [ ] **Step 1: Ajouter les commandes de fenêtre**

La fenêtre étant sans décoration système, l'application doit fournir ses
propres boutons : sans eux, elle ne peut plus être fermée.

Dans `src/shared/ipc-contract.ts`, ajouter à `NanoleafApi` :

```ts
  minimizeWindow(): Promise<void>
  closeWindow(): Promise<void>
```

et à `IPC_CHANNELS` :

```ts
  windowMinimize: 'window:minimize',
  windowClose: 'window:close',
```

Dans `src/main/main.ts`, remplacer l'import de tête par :

```ts
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { createMdnsFactory } from './device/mdns'
import { DeviceService, registerIpc } from './ipc'
import { ConfigStore, defaultConfigPath } from './store'
import { IPC_CHANNELS } from '../shared/ipc-contract'
```

Remplacer la création de la fenêtre par :

```ts
function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    frame: false,
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
    void window.loadFile(join(__dirname, '../../renderer/index.html'))
  }
}
```

Dans le bloc `app.whenReady()`, juste après `registerIpc(ipcMain, service)`, ajouter :

```ts
  ipcMain.handle(IPC_CHANNELS.windowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle(IPC_CHANNELS.windowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
```

Dans `src/preload/preload.ts`, ajouter à l'objet `api` :

```ts
  minimizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowMinimize),
  closeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowClose),
```

- [ ] **Step 2: Écrire la feuille de style**

`src/renderer/styles.css` :

```css
:root {
  --fond: #0a0a0c;
  --texte: #f2f2f5;
  --discret: #9a9aa6;
  --verre: rgba(255, 255, 255, 0.06);
  --bord: rgba(255, 255, 255, 0.1);
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--fond);
  color: var(--texte);
  font-family: system-ui, sans-serif;
  overflow: hidden;
}

/* Dégradé lent dérivant vers la couleur dominante.
   Deux calques empilés au fond statique, dont seule l'opacité s'anime : un
   `transition: background` repeindrait un flou de 90 px plein écran à chaque
   frame, ce que la contrainte des 60 fps interdit. */
.derive {
  position: fixed;
  inset: -30%;
  z-index: 0;
  filter: blur(90px);
  pointer-events: none;
  opacity: 0;
  transition: opacity 1.6s linear;
  will-change: opacity;
}

.derive[data-visible='true'] {
  opacity: 0.5;
}

.coquille {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-rows: 38px 1fr;
  height: 100vh;
}

.barre {
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
}

.barre button,
.onglets button {
  -webkit-app-region: no-drag;
}

.onglets {
  display: flex;
  gap: 4px;
  margin-left: 12px;
}

.onglets button {
  background: transparent;
  border: 0;
  color: var(--discret);
  font-size: 13px;
  padding: 4px 10px;
  border-radius: 999px;
  cursor: pointer;
}

.onglets button[aria-selected='true'] {
  background: var(--verre);
  color: var(--texte);
}

.commandes-fenetre {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

.commandes-fenetre button {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--bord);
  background: var(--verre);
  color: var(--discret);
  cursor: pointer;
  line-height: 1;
  font-size: 12px;
}

.verre {
  background: var(--verre);
  border: 1px solid var(--bord);
  backdrop-filter: blur(18px);
  border-radius: 16px;
  padding: 20px;
}

.controle {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 20px;
  padding: 0 20px 20px;
  min-height: 0;
}

.mur {
  display: block;
  width: 100%;
  height: 100%;
}

.grille-scenes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 14px;
  padding: 0 20px 20px;
  overflow-y: auto;
}

.vignette {
  border: 1px solid var(--bord);
  border-radius: 14px;
  padding: 0;
  cursor: pointer;
  overflow: hidden;
  color: var(--texte);
  background: transparent;
  transition: transform 160ms ease;
}

.vignette:hover {
  transform: scale(1.03);
}

.vignette[aria-current='true'] {
  border-color: var(--texte);
}

.vignette span {
  display: block;
  padding: 8px 10px;
  font-size: 13px;
  text-align: left;
}
```

Dans `src/renderer/main.tsx`, ajouter l'import en première ligne :

```tsx
import './styles.css'
```

- [ ] **Step 3: Écrire le hook de session**

`src/renderer/useNanoleaf.ts` :

```ts
import { useCallback, useEffect, useState } from 'react'
import type { NanoleafApi, RendererDevice } from '../shared/ipc-contract'
import type { Color, DeviceState, EffectPalette, PanelLayout } from '../shared/types'

export interface NanoleafSession {
  device: RendererDevice | undefined
  state: DeviceState | null
  layout: PanelLayout | null
  palettes: EffectPalette[]
  colors: Map<number, Color>
  busy: boolean
  error: string | null
  discover: () => void
  pair: () => void
  refresh: () => void
  setOn: (on: boolean) => void
  setBrightness: (value: number) => void
  setColor: (hue: number, sat: number) => void
  paint: (panelId: number, color: Color) => void
  selectEffect: (name: string) => void
}

/**
 * Rassemble l'état du device côté renderer. Les couleurs peintes sont tenues
 * ici pour que le canvas les rende sans aller-retour IPC supplémentaire.
 */
export function useNanoleaf(bridge: NanoleafApi): NanoleafSession {
  const [devices, setDevices] = useState<RendererDevice[]>([])
  const [state, setState] = useState<DeviceState | null>(null)
  const [layout, setLayout] = useState<PanelLayout | null>(null)
  const [palettes, setPalettes] = useState<EffectPalette[]>([])
  const [colors, setColors] = useState<Map<number, Color>>(new Map())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const device = devices.find((entry) => entry.paired) ?? devices[0]

  const run = useCallback((fn: () => Promise<void>): void => {
    setBusy(true)
    setError(null)
    void fn()
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }, [])

  const load = useCallback(
    (id: string): void => {
      run(async () => {
        setState(await bridge.getState(id))
        setLayout(await bridge.getLayout(id))
        setPalettes(await bridge.getEffectPalettes(id))
      })
    },
    [bridge, run],
  )

  useEffect(() => {
    run(async () => setDevices(await bridge.listDevices()))
  }, [bridge, run])

  useEffect(() => {
    if (device?.paired === true) load(device.id)
  }, [device?.id, device?.paired, load])

  return {
    device,
    state,
    layout,
    palettes,
    colors,
    busy,
    error,
    discover: () => run(async () => setDevices(await bridge.discover())),
    pair: () =>
      run(async () => {
        if (device === undefined) return
        await bridge.pair(device.id)
        setDevices(await bridge.listDevices())
      }),
    refresh: () => {
      if (device !== undefined) load(device.id)
    },
    setOn: (on) =>
      run(async () => {
        if (device === undefined) return
        await bridge.setOn(device.id, on)
        setState(await bridge.getState(device.id))
      }),
    setBrightness: (value) =>
      run(async () => {
        if (device === undefined) return
        await bridge.setBrightness(device.id, value)
        setState((previous) => (previous === null ? previous : { ...previous, brightness: value }))
      }),
    setColor: (hue, sat) =>
      run(async () => {
        if (device === undefined) return
        await bridge.setColor(device.id, hue, sat)
        setState((previous) => (previous === null ? previous : { ...previous, hue, sat }))
      }),
    paint: (panelId, color) =>
      run(async () => {
        if (device === undefined) return
        await bridge.paintPanel(device.id, panelId, color)
        setColors((previous) => new Map(previous).set(panelId, color))
      }),
    selectEffect: (name) =>
      run(async () => {
        if (device === undefined) return
        await bridge.selectEffect(device.id, name)
        setColors(new Map())
        setState(await bridge.getState(device.id))
      }),
  }
}
```

- [ ] **Step 4: Écrire le canvas du mur**

`src/renderer/components/WallCanvas.tsx` :

```tsx
import { useEffect, useRef } from 'react'
import { createWallRenderer, type WallRenderer } from '../gl/wall'
import { panelAt } from '../../shared/geometry'
import type { Color, PanelLayout } from '../../shared/types'

interface WallCanvasProps {
  layout: PanelLayout
  colors: Map<number, Color>
  onPaint: (panelId: number) => void
}

/**
 * Rend le mur et traduit un clic en panneau. Le renderer est recréé quand la
 * géométrie change, jamais quand les couleurs changent : redessiner ne coûte
 * qu'un uniforme.
 */
export function WallCanvas({ layout, colors, onPaint }: WallCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WallRenderer | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return

    let renderer: WallRenderer
    try {
      renderer = createWallRenderer(canvas, layout)
    } catch {
      return
    }
    rendererRef.current = renderer
    renderer.resize()
    renderer.draw(colors)

    const observer = new ResizeObserver(() => {
      renderer.resize()
      renderer.draw(colors)
    })
    observer.observe(canvas)

    return () => {
      observer.disconnect()
      renderer.dispose()
      rendererRef.current = null
    }
    // Les couleurs sont volontairement absentes : elles sont rendues par
    // l'effet suivant, sans reconstruire le contexte GPU.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout])

  useEffect(() => {
    rendererRef.current?.draw(colors)
  }, [colors])

  /**
   * Le canvas dessine le mur centré avec les mêmes marges que le shader :
   * l'inverse de cette mise à l'échelle ramène le clic en espace normalisé.
   */
  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const canvasAspect = bounds.width / bounds.height
    const [scaleX, scaleY] =
      canvasAspect > layout.aspect
        ? [layout.aspect / canvasAspect, 1]
        : [1, canvasAspect / layout.aspect]

    const panel = panelAt(layout, {
      x: (event.clientX - bounds.left) / bounds.width / scaleX - (0.5 / scaleX - 0.5),
      y: (event.clientY - bounds.top) / bounds.height / scaleY - (0.5 / scaleY - 0.5),
    })
    if (panel !== null) onPaint(panel.panelId)
  }

  return <canvas ref={canvasRef} className="mur" onClick={handleClick} />
}
```

- [ ] **Step 5: Écrire l'écran Contrôle**

`src/renderer/screens/ControlScreen.tsx` :

```tsx
import { ColorWheel } from '../components/ColorWheel'
import { WallCanvas } from '../components/WallCanvas'
import { hsbToRgb } from '../../shared/color'
import type { NanoleafSession } from '../useNanoleaf'

export function ControlScreen({ session }: { session: NanoleafSession }) {
  const { device, state, layout } = session

  if (device === undefined) {
    return (
      <section className="controle">
        <div className="verre">
          <p>Aucun device connu.</p>
          <button disabled={session.busy} onClick={session.discover}>
            Découvrir
          </button>
        </div>
      </section>
    )
  }

  if (!device.paired) {
    return (
      <section className="controle">
        <div className="verre">
          <p>{device.name} trouvé, pas encore appairé.</p>
          <p style={{ color: 'var(--discret)' }}>
            Maintiens le bouton power du panneau 5 à 7 secondes, puis lance l&apos;appairage.
          </p>
          <button disabled={session.busy} onClick={session.pair}>
            Appairer
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="controle">
      {layout === null ? <div /> : (
        <WallCanvas
          layout={layout}
          colors={session.colors}
          onPaint={(panelId) =>
            session.paint(panelId, hsbToRgb(state?.hue ?? 0, state?.sat ?? 100, 100))
          }
        />
      )}

      <aside className="verre" style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <strong style={{ fontSize: 15 }}>{device.name}</strong>
          <span style={{ color: 'var(--discret)', fontSize: 12 }}>
            {layout?.panels.length ?? 0} panneaux
          </span>
        </div>

        <button
          disabled={session.busy || state === null}
          onClick={() => session.setOn(!(state?.on ?? false))}
        >
          {state?.on === true ? 'Éteindre' : 'Allumer'}
        </button>

        <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          Luminosité {state?.brightness ?? 0} %
          <input
            type="range"
            min={0}
            max={100}
            value={state?.brightness ?? 0}
            onChange={(event) => session.setBrightness(Number(event.target.value))}
          />
        </label>

        <ColorWheel
          hue={state?.hue ?? 0}
          sat={state?.sat ?? 0}
          size={220}
          onPick={({ hue, sat }) => session.setColor(Math.round(hue), Math.round(sat))}
        />

        <p style={{ margin: 0, color: 'var(--discret)', fontSize: 12, lineHeight: 1.5 }}>
          Clique un panneau pour le peindre de la couleur choisie. La peinture garde la main
          pendant 3 secondes, puis le device reprend son effet.
        </p>

        {session.error !== null && <p style={{ color: '#ff6b6b' }}>{session.error}</p>}
      </aside>
    </section>
  )
}
```

- [ ] **Step 6: Réécrire la coquille**

Remplacer entièrement `src/renderer/App.tsx` par :

```tsx
import { useEffect, useMemo, useState } from 'react'
import type { NanoleafApi } from '../shared/ipc-contract'
import { ControlScreen } from './screens/ControlScreen'
import { useNanoleaf } from './useNanoleaf'

declare global {
  interface Window {
    /**
     * Injecté par le preload d'Electron. Absent quand la page est ouverte
     * directement dans un navigateur : le serveur Vite ne sert que le
     * renderer, il n'apporte aucun pont IPC.
     */
    nanoleaf?: NanoleafApi
  }
}

/** Affiché quand la page tourne hors d'Electron, sans pont IPC. */
function MissingBridge() {
  return (
    <main style={{ padding: 24, display: 'grid', gap: 16, maxWidth: 620 }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Nanoleaf — pont IPC absent</h1>
      <p style={{ margin: 0, lineHeight: 1.5 }}>
        Cette page est servie par Vite, qui ne fournit que l&apos;interface. Le dialogue
        avec les panneaux passe par le processus main d&apos;Electron : le token
        d&apos;authentification ne doit jamais atteindre le navigateur.
      </p>
      <pre style={{ margin: 0, padding: 12, background: '#17171c', borderRadius: 6 }}>
        VITE_DEV_SERVER_URL=http://localhost:5173 npm run start
      </pre>
    </main>
  )
}

function Shell({ bridge }: { bridge: NanoleafApi }) {
  const session = useNanoleaf(bridge)
  const [screen, setScreen] = useState<'controle' | 'scenes'>('controle')

  /** Le fond dérive vers la moyenne des couleurs posées sur le mur. */
  const derive = useMemo(() => {
    const posees = [...session.colors.values()]
    if (posees.length === 0) return 'radial-gradient(circle at 30% 30%, #16161c, #0a0a0c)'
    const moyenne = posees.reduce(
      (sum, color) => ({ r: sum.r + color.r, g: sum.g + color.g, b: sum.b + color.b }),
      { r: 0, g: 0, b: 0 },
    )
    const n = posees.length
    const teinte = `rgb(${Math.round(moyenne.r / n)}, ${Math.round(moyenne.g / n)}, ${Math.round(moyenne.b / n)})`
    return `radial-gradient(circle at 30% 30%, ${teinte}, #0a0a0c)`
  }, [session.colors])

  // Fondu croisé : le calque sortant garde son fond, seule l'opacité bouge.
  const [calques, setCalques] = useState<[string, string]>([derive, derive])
  const [actif, setActif] = useState(0)

  useEffect(() => {
    if (calques[actif] === derive) return
    const suivant = actif === 0 ? 1 : 0
    setCalques((precedents) => {
      const copie: [string, string] = [...precedents]
      copie[suivant] = derive
      return copie
    })
    setActif(suivant)
  }, [derive, actif, calques])

  return (
    <>
      {calques.map((fond, index) => (
        <div
          key={index}
          className="derive"
          data-visible={index === actif}
          style={{ background: fond }}
        />
      ))}
      <div className="coquille">
        <header className="barre">
          <nav className="onglets">
            <button
              aria-selected={screen === 'controle'}
              onClick={() => setScreen('controle')}
            >
              Contrôle
            </button>
            <button aria-selected={screen === 'scenes'} onClick={() => setScreen('scenes')}>
              Scènes
            </button>
          </nav>
          <div className="commandes-fenetre">
            <button title="Réduire" onClick={() => void bridge.minimizeWindow()}>
              –
            </button>
            <button title="Fermer" onClick={() => void bridge.closeWindow()}>
              ×
            </button>
          </div>
        </header>

        {screen === 'controle' ? <ControlScreen session={session} /> : <ControlScreen session={session} />}
      </div>
    </>
  )
}

export function App() {
  const bridge = typeof window === 'undefined' ? undefined : window.nanoleaf
  if (bridge === undefined) return <MissingBridge />
  return <Shell bridge={bridge} />
}
```

L'onglet Scènes rend provisoirement l'écran Contrôle ; la tâche 7 le remplace.

- [ ] **Step 7: Vérifier la compilation et la suite complète**

Run: `npm run build:main && npx tsc -p tsconfig.json --noEmit && npm run build:renderer && npx vitest run`
Expected: aucune erreur, tous les tests passent

- [ ] **Step 8: Vérification manuelle contre le matériel réel**

Run: `npm start`

Checklist :

1. La fenêtre s'ouvre sans décoration système, et se déplace en tirant la barre du haut.
2. Le bouton × ferme la fenêtre, le bouton – la réduit.
3. Le mur affiche 9 triangles à leur position et orientation réelles, halo compris.
4. Le curseur de luminosité change la luminosité physique des panneaux.
5. « Éteindre » puis « Allumer » agissent sur les panneaux.
6. Choisir une couleur sur la roue, puis cliquer un triangle du canvas : ce panneau-là s&apos;allume de cette couleur, et lui seul.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/styles.css src/renderer/useNanoleaf.ts src/renderer/components/WallCanvas.tsx src/renderer/screens/ControlScreen.tsx src/renderer/main.tsx src/renderer/App.tsx src/main/main.ts src/shared/ipc-contract.ts src/preload/preload.ts
git commit -m "feat: coquille frameless et écran de contrôle"
```

---

### Task 7: Écran Scènes

**Files:**
- Create: `src/renderer/screens/ScenesScreen.tsx`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `EffectPalette` (tâche 1), `NanoleafSession` (tâche 6)
- Produces: `<ScenesScreen session={NanoleafSession} />`

- [ ] **Step 1: Écrire l'écran**

`src/renderer/screens/ScenesScreen.tsx` :

```tsx
import type { EffectPalette } from '../../shared/types'
import type { NanoleafSession } from '../useNanoleaf'

/** Dégradé horizontal bâti sur la palette réelle de l'effet. */
function degrade(palette: EffectPalette): string {
  if (palette.colors.length === 0) return '#17171c'
  if (palette.colors.length === 1) {
    const { r, g, b } = palette.colors[0]!
    return `rgb(${r}, ${g}, ${b})`
  }

  const arrets = palette.colors.map((color, index) => {
    const position = (index / (palette.colors.length - 1)) * 100
    return `rgb(${color.r}, ${color.g}, ${color.b}) ${position.toFixed(1)}%`
  })
  return `linear-gradient(120deg, ${arrets.join(', ')})`
}

export function ScenesScreen({ session }: { session: NanoleafSession }) {
  if (session.palettes.length === 0) {
    return (
      <section className="grille-scenes">
        <p style={{ color: 'var(--discret)' }}>
          {session.device?.paired === true
            ? 'Aucune scène lue pour le moment.'
            : 'Appaire un device pour voir ses scènes.'}
        </p>
      </section>
    )
  }

  return (
    <section className="grille-scenes">
      {session.palettes.map((palette) => (
        <button
          key={palette.name}
          className="vignette"
          aria-current={session.state?.effect === palette.name}
          disabled={session.busy}
          onClick={() => session.selectEffect(palette.name)}
        >
          <div style={{ height: 90, background: degrade(palette) }} />
          <span>{palette.name}</span>
        </button>
      ))}
    </section>
  )
}
```

- [ ] **Step 2: Brancher l'onglet**

Dans `src/renderer/App.tsx`, ajouter l'import :

```tsx
import { ScenesScreen } from './screens/ScenesScreen'
```

et remplacer la ligne de rendu conditionnel par :

```tsx
        {screen === 'controle' ? (
          <ControlScreen session={session} />
        ) : (
          <ScenesScreen session={session} />
        )}
```

- [ ] **Step 3: Vérifier la compilation et la suite complète**

Run: `npx tsc -p tsconfig.json --noEmit && npm run build:renderer && npx vitest run`
Expected: aucune erreur, tous les tests passent

- [ ] **Step 4: Vérification manuelle contre le matériel réel**

Run: `npm start`

Checklist :

1. L&apos;onglet Scènes affiche 16 vignettes, chacune dans les couleurs de son effet — Blaze en oranges, Northern Lights en verts.
2. La vignette de l&apos;effet courant est entourée.
3. Cliquer une vignette change l&apos;effet affiché par les panneaux physiques.
4. Revenir à Contrôle, cliquer un panneau, revenir à Scènes : aucune vignette n&apos;est plus entourée, le device étant passé en mode externe.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/screens/ScenesScreen.tsx src/renderer/App.tsx
git commit -m "feat: écran des scènes bâti sur les palettes réelles"
```

---

## Ce que ce jalon ne fait pas

Explicitement hors périmètre, traité dans les jalons suivants :

- Écran Sync, aperçu live de la capture, réglages du §6.4 (jalons 4 et 5)
- Capture d'écran, Worker, pipeline couleur (jalon 4)
- Capture et analyse audio, mode combiné (jalon 5)
- Empaquetage electron-builder
