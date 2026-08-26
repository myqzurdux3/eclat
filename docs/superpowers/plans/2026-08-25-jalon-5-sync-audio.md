# Jalon 5 — Synchronisation audio : plan d'implémentation

> **Pour les agents :** SOUS-COMPÉTENCE REQUISE : utiliser superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour dérouler ce plan tâche par tâche. Les étapes se suivent par cases à cocher (`- [ ]`).

**Objectif :** Faire réagir les panneaux au son qui sort des enceintes — capture du monitor PipeWire, analyse spectrale, et une couleur par panneau qui suit graves, médiums, aigus et battements.

**Architecture :** L'analyse est faite de fonctions pures prenant un bloc de PCM et rendant des grandeurs normalisées : FFT, bandes logarithmiques, détection de battement à seuil adaptatif. Elles se testent sur des signaux fabriqués, sans carte son. Autour, une fine couche d'entrées-sorties : le processus main lance `pw-record`, découpe le flux en blocs, et pousse les grandeurs vers le renderer, qui les transforme en couleurs et les envoie par le canal `stream:frame` du jalon 2 — source `audio`, déjà connue de l'arbitre.

**Stack technique :** Electron, TypeScript, `pw-record` (PipeWire), Vitest. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/2026-08-20-nanoleaf-linux-design.md` — sections 7 (audio), 8 (arbitrage), 10.1 (tests).

## Contraintes globales

- Cible : Ubuntu 26.04, Wayland/GNOME, PipeWire.
- Analyse par blocs de **1024 échantillons**, bandes espacées **logarithmiquement**.
- Détection de battement par **seuil adaptatif** (moyenne glissante et variance) : un seuil fixe ne marche que sur un morceau donné.
- Sortie normalisée : `{ bass, mid, treble, beat }`.
- Le renderer n'ouvre aucune socket et ne lit aucun périphérique : la capture vit dans le processus main.
- L'audio passe par `arbiter.ts` comme les autres sources, derrière la peinture manuelle et le sync écran.
- Aucun test ne dépend d'une carte son : tout se vérifie sur des signaux synthétiques.

### Ce que la machine dit, mesuré avant d'écrire ce plan

- **`enumerateDevices()` n'expose aucune source *monitor*.** Le chemin
  principal de la spec ne fonctionne pas ici : Chromium ne voit que
  « Default » et « Built-in Audio Analog Stereo ». C'est donc le repli prévu
  par la spec qui devient le chemin unique.
- **`pw-record` fonctionne** : 190 464 échantillons stéréo en 4 s à 48 kHz,
  format et cadence exacts.
- **Le sink est à `vol: 0.00 MUTED`**, et PipeWire applique le volume avant
  la prise du monitor : la capture ne rend que du silence tant que le son est
  coupé. Ce n'est pas un défaut du code, et cela laisse une vérification
  finale à faire par un humain, son allumé.
- Le sink porte l'identifiant `51`, nom
  `alsa_output.pci-0000_00_1f.3.analog-stereo`. Les identifiants changent
  d'une session à l'autre : la liste doit être relue, jamais mémorisée.

---

### Task 1: Transformée de Fourier

**Fichiers :** `src/shared/audio/fft.ts`, `+ .test.ts`

**Produit :**
- `nextPowerOfTwo(value: number): number`
- `hannWindow(size: number): Float32Array`
- `magnitudeSpectrum(samples: Float32Array): Float32Array` — rend `size / 2` amplitudes

**Algorithme :** FFT radix-2 en place, sur des tableaux réels/imaginaires séparés, précédée d'une fenêtre de Hann. Sans fenêtrage, un bloc découpé au milieu d'une période fabrique des fréquences qui n'existent pas.

**Tests :** un sinus pur à une fréquence de bin exacte concentre l'énergie sur ce bin et pas ailleurs ; deux sinus donnent deux pics ; le silence donne un spectre nul ; l'amplitude d'un signal doublé double ; une taille qui n'est pas une puissance de deux est refusée ; la fenêtre de Hann vaut zéro aux bords et un au centre.

- [x] Step 1 : test, échec, implémentation, succès
- [x] Step 2 : commit

---

### Task 2: Bandes logarithmiques

**Fichiers :** `src/shared/audio/bands.ts`, `+ .test.ts`

**Consomme :** `magnitudeSpectrum` (tâche 1)

**Produit :**
- `BandEnergies { bass: number; mid: number; treble: number }`
- `bandEnergies(spectrum: Float32Array, sampleRate: number): BandEnergies`
- `BAND_EDGES_HZ = [20, 250, 2000, 16000]`

**Algorithme :** somme des amplitudes des bins tombant dans chaque bande, divisée par le nombre de bins — sans cette division, les aigus l'emporteraient toujours, une octave haute couvrant bien plus de bins qu'une basse. La normalisation, elle, est faite plus loin par l'analyseur, contre une référence fixe (`REFERENCE = 0.05`) : une référence glissante remonte le silence au bout de quelques secondes.

**Tests :** un sinus à 100 Hz remplit les graves et laisse médiums et aigus près de zéro ; à 1 kHz, les médiums ; à 8 kHz, les aigus ; le silence rend trois zéros ; un bruit blanc remplit les trois de façon comparable, ce qui vaut vérification de la division par le nombre de bins.

- [x] Step 1 : test, échec, implémentation, succès
- [x] Step 2 : commit

---

### Task 3: Détection de battement

**Fichiers :** `src/shared/audio/beat.ts`, `+ .test.ts`

**Produit :** `class BeatDetector { push(bassEnergy: number): boolean; reset(): void }`

**Algorithme :** historique glissant de l'énergie des graves ; un battement est déclaré quand l'énergie courante dépasse la moyenne de plus de `k` écarts-types, avec une période réfractaire pour ne pas compter deux fois le même coup. Le seuil suit le morceau : un passage calme abaisse la barre, un passage dense la relève.

**Tests :** un signal constant ne déclenche jamais ; un pic isolé après du calme déclenche une fois ; deux pics rapprochés ne comptent que pour un, la période réfractaire jouant ; un morceau uniformément fort finit par ne plus déclencher, le seuil s'étant adapté ; `reset` oublie l'historique ; les premières valeurs, faute d'historique, ne déclenchent pas.

- [x] Step 1 : test, échec, implémentation, succès
- [x] Step 2 : commit

---

### Task 4: Analyseur

**Fichiers :** `src/shared/audio/analyser.ts`, `+ .test.ts`

**Consomme :** tâches 1 à 3

**Produit :**
- `AudioFeatures { bass: number; mid: number; treble: number; beat: boolean; level: number }`
- `class AudioAnalyser { constructor(sampleRate: number); push(block: Float32Array): AudioFeatures; reset(): void }`
- `pcmToMono(buffer: Buffer, channels: number): Float32Array` — s16 entrelacé vers mono `[-1,1]`

**Algorithme :** conversion en mono, fenêtrage, FFT, bandes, battement, puis lissage léger des trois bandes pour que les couleurs ne tremblent pas. `level` est le RMS du bloc, utile pour éteindre le mur quand rien ne joue.

**Tests :** le silence rend des grandeurs nulles et `beat` faux ; un sinus grave donne `bass` nettement supérieur aux deux autres ; `pcmToMono` moyenne bien les deux canaux et borne dans `[-1,1]` ; un buffer de taille impaire ne fait pas planter ; `level` suit l'amplitude.

- [x] Step 1 : test, échec, implémentation, succès
- [x] Step 2 : commit

---

### Task 5: Couleurs depuis le son

**Fichiers :** `src/shared/audio/palette.ts`, `src/shared/audio/modes.ts`, `src/shared/audio/painter.ts`, `+ modes.test.ts` et `painter.test.ts`

**Consomme :** `AudioFeatures` (tâche 4), `PanelLayout`, `Color`

**Produit :** `class AudioPainter { paint(features: AudioFeatures, layout: PanelLayout, settings: AudioSettings): Color[]; reset(): void }`, `AudioSettings { mode: AudioMode; sensitivity: number; beatFlash: number; gate: number }`

**Algorithme :** les trois bandes pilotent une teinte, la position du panneau décale la phase — les graves en bas, les aigus en haut, ce que l'oreille attend. Un battement pousse brièvement la luminosité de tous les panneaux. `level` sous le seuil `gate` éteint le mur plutôt que d'afficher du bruit.

> **Écart assumé, 26 août 2026.** Une seule façon de répondre au son n'a pas
> suffi : le champ de couleur dit bien l'ambiance et très mal le morceau.
> Quatre modes ont été livrés — champ de couleur, vu-mètre à crête qui
> retombe, axe de fréquences, pulsation renouvelée à chaque battement — et
> `settings.mode` choisit. Les modes restent purs : ils prennent la mémoire
> d'un bloc et rendent la suivante, et c'est `AudioPainter` qui la porte.
> Voir `d0f1ab5`.

**Tests :** une couleur par panneau ; le silence rend du noir ; un battement rend le mur plus clair que la même frame sans battement ; la sensibilité change l'amplitude sans changer la teinte ; un mur sans panneau rend un tableau vide.

- [x] Step 1 : test, échec, implémentation, succès
- [x] Step 2 : commit

---

### Task 6: Capture PipeWire

**Fichiers :** `src/main/audio/sources.ts`, `src/main/audio/capture.ts`, `+ tests`

**Produit :**
- `AudioSource { id: number; name: string; description: string }`
- `parsePipewireDump(json: string): AudioSource[]` — pur, donc testable
- `listAudioSources(): Promise<AudioSource[]>` — appelle `pw-dump`
- `class AudioCapture { start(sourceId: number): void; stop(): void }` — `onFeatures` est passé au constructeur, la capture n'ayant qu'un seul consommateur

**Algorithme :** `pw-dump` rend l'inventaire PipeWire en JSON ; on en retient les nœuds `Audio/Sink`, dont le monitor porte le son qui sort. `pw-record -P '{ stream.capture.sink=true }' --target <id> --format s16 --rate 48000 --channels 2 -` écrit le PCM brut sur la sortie standard ; les blocs sont accumulés jusqu'à 1024 échantillons puis passés à l'analyseur.

**Tests :** `parsePipewireDump` sur un extrait réel de `pw-dump` retient les sinks et écarte le reste ; un JSON illisible rend un tableau vide ; un nœud sans nom est ignoré. La capture elle-même n'est pas testée automatiquement — elle dépend d'un binaire externe et d'une carte son.

- [x] Step 1 : test de `parsePipewireDump`, échec, implémentation, succès
- [x] Step 2 : écrire `capture.ts`
- [x] Step 3 : commit

---

### Task 7: IPC et interface

**Fichiers :** `src/main/ipc.ts`, `src/shared/ipc-contract.ts`, `src/preload/preload.ts`, `src/renderer/useAudioSync.ts`, `src/renderer/screens/SyncScreen.tsx`, dictionnaires

**Algorithme :** l'écran Sync gagne un choix de source — écran ou audio — et, pour l'audio, la liste des sorties PipeWire. Les grandeurs remontent par un canal poussé, comme les événements du device, et le renderer les transforme en couleurs qu'il envoie par `sendFrame(deviceId, 'audio', colors)`.

> **Écart assumé, 26 août 2026.** L'audio a pris son propre onglet plutôt
> qu'une ligne dans Sync : `src/renderer/screens/AudioScreen.tsx`, quatrième
> écran. La source, les quatre modes, la sensibilité, le flash de battement,
> le seuil et les niveaux par bande ne tenaient pas à côté des réglages de la
> synchro écran, et mélanger les deux laissait croire qu'elles marchent
> ensemble — elles ne le font pas. Voir `96632de`.

**Vérification manuelle**, la carte son ne s'automatisant pas :

```bash
wpctl set-mute @DEFAULT_AUDIO_SINK@ 0
wpctl set-volume @DEFAULT_AUDIO_SINK@ 0.3
npm start   # onglet Sync, source Audio, puis lancer de la musique
```

- [x] Step 1 : contrat IPC et service
- [x] Step 2 : hook et interface
- [x] Step 3 : compilation, suite complète, capture visuelle
- [ ] Step 4 : vérification manuelle, son allumé — le sink est muet, et une tentative de contournement par null sink PipeWire a échoué : `pw-play` ne s'y est pas lié. Reste à faire, son activé.
- [x] Step 5 : commit

---

## Ce que ce jalon ne fait pas

- Le mode combiné écran + audio : voir la spec §8, et l'écart qui y est noté.
- L'empaquetage electron-builder (jalon 6).
