# Jalon 4 — Synchronisation écran : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire suivre aux panneaux ce qui s'affiche à l'écran — capture par le portail Wayland, analyse dans un Worker, et un pipeline couleur qui transforme chaque frame en une couleur par panneau.

**Architecture:** Le pipeline entier est fait de fonctions pures prenant une image, la géométrie du mur et des réglages, et rendant des couleurs. Il ne connaît ni le DOM, ni le GPU, ni le réseau : il se teste sur des images fabriquées à la main. Autour de ce noyau, une fine couche d'entrées-sorties — un Worker qui lit les `VideoFrame` et les réduit en 64×36, l'écran Sync qui règle les paramètres, et le canal `stream:frame` du jalon 2 qui envoie le résultat aux panneaux.

**Tech Stack:** Electron, React, TypeScript, `MediaStreamTrackProcessor`, `OffscreenCanvas`, Web Worker, Vitest. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/2026-08-20-nanoleaf-linux-design.md` — sections 6 (pipeline), 6.4 (réglages), 8 (arbitrage), 10.1 (tests).

> **Écart au format habituel.** Ce plan donne les interfaces, les décisions
> d'algorithme et les intentions de test, sans recopier chaque assertion :
> il est exécuté dans la foulée par son auteur, en TDD. Les jalons 1 à 3,
> écrits pour être repris par quelqu'un d'autre, portaient le code des tests
> en entier.

## Global Constraints

- Cible : Ubuntu 26.04, Wayland/GNOME, Node v26.
- Analyse sur un `OffscreenCanvas` **64×36** : le redimensionnement est fait par le GPU, l'analyse porte sur 2304 pixels.
- Le traitement pixel vit dans un **Worker dédié** : le thread UI n'est jamais bloqué par la capture.
- Ordre de traitement **imposé** : letterbox, moyenne en espace linéaire, mapping, correction, lissage.
- Le renderer n'ouvre aucune socket : les couleurs partent par `stream:frame`.
- Latence bout en bout visée : **< 80 ms**. Thread UI **jamais sous 60 fps**. CPU sous 10 % d'un cœur.
- Cadence plafonnée par le régulateur du jalon 2 (25-30 Hz).
- Aucun test ne dépend du DOM, du GPU, du réseau ni du matériel.

### Réglages, repris tels quels de la spec

| Réglage | Plage | Défaut |
|---|---|---|
| Mode de mapping | spatial / dominant / palette | spatial |
| Rayon d'échantillonnage | 0.05 – 0.5 | 0.18 |
| Saturation | 0.5 – 2.0 | 1.25 |
| Plancher de noir | 0 – 20 % | 4 % |
| Attaque EMA | 0.1 – 1.0 | 0.6 |
| Relâche EMA | 0.02 – 0.5 | 0.15 |
| Cadence | 10 – 30 Hz | 25 Hz |

### Décisions prises avant d'écrire

- **`Frame` plutôt qu'`ImageData`.** Le pipeline prend `{ width, height, data: Uint8ClampedArray }`, structurellement compatible avec `ImageData` mais disponible sous Node : les tests tournent sans DOM.
- **Le letterbox se mesure en luminance, pas en RGB brut.** Une bande noire compressée n'est jamais exactement à zéro.
- **La moyenne passe en linéaire.** Moyenner du sRGB donne du gris désaturé ; la conversion aller-retour est le cœur du rendu couleur.
- **L'EMA est asymétrique et porte sur le linéaire**, avant retour en sRGB : lisser des valeurs déjà encodées en gamma fait respirer les basses lumières de travers.

---

### Task 1: Réglages et espace colorimétrique

**Files:**
- Create: `src/shared/sync/settings.ts`, `src/shared/sync/settings.test.ts`
- Create: `src/shared/sync/srgb.ts`, `src/shared/sync/srgb.test.ts`

**Produces:**
- `MappingMode = 'spatial' | 'dominant' | 'palette'`
- `SyncSettings { mode; radius; saturation; blackFloor; attack; release; hz }`
- `DEFAULT_SYNC_SETTINGS: SyncSettings`
- `clampSettings(partial: Partial<SyncSettings>): SyncSettings`
- `Frame { width: number; height: number; data: Uint8ClampedArray }`
- `toLinear(channel: number): number` — sRGB 0-255 vers linéaire 0-1
- `toSrgb(linear: number): number` — retour, borné 0-255
- `LinearColor { r: number; g: number; b: number }`
- `averageLinear(frame, rect): LinearColor`

**Tests:** aller-retour idempotent sur les 256 valeurs ; le noir et le blanc restent exacts ; la moyenne linéaire de rouge pur et vert pur ne donne pas le même résultat qu'en sRGB ; `clampSettings` ramène chaque réglage dans sa plage et complète les manquants par le défaut.

- [x] Step 1 : écrire `settings.test.ts`, le voir échouer, écrire `settings.ts`, le voir passer
- [x] Step 2 : écrire `srgb.test.ts`, le voir échouer, écrire `srgb.ts`, le voir passer
- [x] Step 3 : `npx vitest run src/shared/sync` puis commit

---

### Task 2: Détection du letterbox

**Files:** `src/shared/sync/letterbox.ts`, `src/shared/sync/letterbox.test.ts`

**Consumes:** `Frame`, `toLinear` (tâche 1)

**Produces:**
- `Rect { x: number; y: number; width: number; height: number }`
- `detectLetterbox(frame: Frame, threshold?: number): Rect`

**Algorithme :** balayer les lignes depuis le haut puis le bas, les colonnes depuis la gauche puis la droite ; une bande est noire si la luminance linéaire moyenne de la ligne reste sous le seuil. On s'arrête à la première ligne qui dépasse. Garde-fou : si le crop retire plus de 45 % d'un axe, on rend l'image entière — c'est une scène sombre, pas un letterbox.

**Tests :** image 16:9 pleine → rectangle complet ; bandes horizontales de 20 % → crop vertical exact ; bandes verticales (pillarbox) ; image entièrement noire → image entière, jamais un rectangle vide ; bruit sombre non nul sous le seuil toujours détecté.

- [x] Step 1 : test, échec, implémentation, succès
- [x] Step 2 : commit

---

### Task 3: Mapping spatial

**Files:** `src/shared/sync/mapping-spatial.ts`, `+ .test.ts`

**Consumes:** `Frame`, `Rect`, `LinearColor`, `toLinear` (tâches 1-2), `PanelLayout`

**Produces:** `mapSpatial(frame, rect, layout, radius): LinearColor[]`

**Algorithme :** chaque panneau échantillonne autour de sa position normalisée, pondération gaussienne d'écart-type `radius`, en espace linéaire. Les zones se recouvrent, ce qui adoucit les transitions entre voisins. Le poids est calculé une fois par panneau sur la grille 64×36.

**Tests :** image moitié rouge / moitié bleue, panneau à gauche → rouge dominant ; panneau à droite → bleu ; un rayon large rapproche les deux couleurs, un rayon étroit les sépare ; un panneau hors cadre prend la couleur du bord la plus proche plutôt que du noir ; layout vide → tableau vide.

- [x] Step 1 : test, échec, implémentation, succès
- [x] Step 2 : commit

---

### Task 4: Mapping dominant et palette

**Files:** `src/shared/sync/mapping-clusters.ts`, `+ .test.ts`

**Produces:**
- `dominantColor(frame, rect): LinearColor`
- `paletteColors(frame, rect, count): LinearColor[]`

**Algorithme :** histogramme 3D de 16 bins par axe en espace linéaire, chaque pixel pondéré par sa saturation — un mur gris ne doit pas l'emporter sur une enseigne rouge. `dominantColor` rend le barycentre du bin le plus lourd. `paletteColors` rend les `count` bins les plus lourds, écartés les uns des autres pour éviter trois nuances du même bleu.

**Tests :** image à 90 % grise et 10 % rouge vif → dominante rouge, la pondération par saturation faisant son office ; image bicolore → palette de deux couleurs distinctes ; demander plus de clusters qu'il n'y a de couleurs ne duplique pas ; image unie → une seule couleur.

- [x] Step 1 : test, échec, implémentation, succès
- [x] Step 2 : commit

---

### Task 5: Correction et lissage temporel

**Files:** `src/shared/sync/correction.ts`, `src/shared/sync/smoothing.ts`, `+ tests`

**Produces:**
- `applyCorrection(color: LinearColor, settings): LinearColor` — boost de saturation, plancher de noir, gamma
- `class Smoother` : `push(colors: LinearColor[]): LinearColor[]`, `reset()`

**Algorithme :** la saturation est poussée autour de la luminance en espace linéaire. Le plancher de noir écrase à zéro ce qui passe sous le seuil, le device coupant de toute façon. Le lissage est un EMA par canal dont le coefficient dépend du sens : `attack` quand la valeur monte, `release` quand elle descend. Un EMA symétrique donne soit du strobe sur les coupes, soit une réactivité molle.

**Tests :** saturation à 1 ne change rien ; saturation à 2 écarte les canaux sans déplacer la luminance ; une valeur sous le plancher tombe à zéro, juste au-dessus survit ; réponse à un échelon montant plus rapide qu'à un échelon descendant, valeurs exactes vérifiées sur trois pas ; le premier `push` sort tel quel, sans amorçage ; `reset` oublie l'historique ; un changement du nombre de panneaux ne fait pas planter le lisseur.

- [x] Step 1 : `correction` — test, échec, implémentation, succès
- [x] Step 2 : `smoothing` — test, échec, implémentation, succès
- [x] Step 3 : commit

---

### Task 6: Assemblage du pipeline

**Files:** `src/shared/sync/pipeline.ts`, `+ .test.ts`

**Consumes:** tâches 1 à 5

**Produces:** `class SyncPipeline { constructor(layout, settings); update(settings): void; process(frame: Frame): Color[]; reset(): void }`

**Algorithme :** enchaîne l'ordre imposé — letterbox, mapping selon le mode, correction, lissage, retour en sRGB. Le lisseur vit dans l'instance : c'est la seule partie qui a une mémoire.

**Tests :** une image rouge unie rend des panneaux rouges pour les trois modes ; un letterbox n'éteint pas les panneaux hauts et bas ; `process` rend exactement un `Color` par panneau ; deux frames identiques convergent ; changer de mode en cours de route ne fait pas exploser le lisseur ; `reset` remet à zéro ; frame entièrement noire → panneaux noirs, pas `NaN`.

- [x] Step 1 : test, échec, implémentation, succès
- [x] Step 2 : commit

---

### Task 7: Capture, Worker et écran Sync

**Files:**
- Create: `src/renderer/worker/capture.worker.ts`
- Create: `src/renderer/screens/SyncScreen.tsx`
- Modify: `src/main/main.ts` (`setDisplayMediaRequestHandler`)
- Modify: `src/renderer/App.tsx`, `src/renderer/useNanoleaf.ts`, `src/renderer/styles.css`

**Algorithme :** le renderer demande `getDisplayMedia`, le main répond par `setDisplayMediaRequestHandler` en laissant le portail GNOME choisir. La piste vidéo est transférée au Worker, qui la lit par `MediaStreamTrackProcessor`, dessine chaque `VideoFrame` dans un `OffscreenCanvas` 64×36, passe le `ImageData` au pipeline et renvoie les couleurs. Le thread UI relaie vers `stream:frame`.

**À documenter dans l'UI**, la spec l'exige : pas de vignettes de fenêtres, et la fenêtre doit être re-sélectionnée à chaque lancement, le jeton de restauration du portail n'étant pas exposé par Electron. Le flux reste vivant tant que l'app tourne, donc basculer le sync ne redemande rien.

**Vérification :** manuelle, la capture Wayland ne s'automatisant pas raisonnablement. Checklist en fin de tâche.

- [x] Step 1 : `setDisplayMediaRequestHandler` côté main
- [x] Step 2 : Worker de capture
- [x] Step 3 : écran Sync, réglages et aperçu
- [x] Step 4 : compilation, suite complète, capture visuelle
- [ ] Step 5 : vérification manuelle contre le matériel — le sélecteur du portail GNOME demande un clic humain, cette étape ne s'automatise pas
- [x] Step 6 : commit

---

## Ce que ce jalon ne fait pas

- Capture et analyse audio, mode combiné (jalon 5)
- Empaquetage electron-builder
