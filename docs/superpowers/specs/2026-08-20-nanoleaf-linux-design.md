# Nanoleaf Linux — application de contrôle et de synchronisation

Date : 2026-08-20
Statut : design validé, en attente de relecture

## 1. Objectif

Application de bureau Linux pour piloter des panneaux Nanoleaf (Shapes /
Elements / Lines) sur le réseau local, avec synchronisation temps réel des
couleurs sur le contenu d'une fenêtre choisie (typiquement un lecteur vidéo)
et sur l'audio système.

Deux exigences dominent le design :

1. **Qualité visuelle de l'application elle-même.** L'interface est un
   livrable, pas un habillage.
2. **Latence et stabilité du sync.** Un ambilight qui scintille ou qui
   traîne est pire que pas d'ambilight.

## 2. Environnement cible

| Élément | Valeur |
|---|---|
| OS | Ubuntu 26.04 LTS |
| Session | Wayland / GNOME |
| Audio | PipeWire (avec compat pipewire-pulse) |
| Node | v26 |
| Matériel | Nanoleaf Shapes / Elements / Lines, firmware 4.x+ |
| Réseau | panneaux et machine sur le même LAN |

Ces valeurs sont les cibles de développement. X11 et les anciens Light
Panels ne sont pas des cibles v1, mais rien dans l'architecture ne les
interdit plus tard.

## 3. Stack

- **Electron** + **React** + **TypeScript**
- **Vite** pour le build renderer, **electron-builder** pour le paquet
- **Vitest** pour les tests unitaires
- Rendu du layout en **WebGL2** sans bibliothèque tierce (la géométrie se
  limite à des polygones convexes et un halo par panneau : une dépendance
  de rendu ne se justifie pas)

Motivation : l'UI web donne la latitude nécessaire à l'exigence visuelle,
et le pipeline `getDisplayMedia` → `MediaStreamTrackProcessor` →
`OffscreenCanvas` de Chromium résout la capture Wayland et le
redimensionnement GPU sans code natif.

Alternatives écartées : Tauri (capture PipeWire à câbler manuellement via
ashpd, coût sans bénéfice ici), Python/GTK4 (marge de design insuffisante).

## 4. Architecture

### 4.1 Processus

```
┌─ main (Node) ───────────────────────────────────────┐
│  device/discovery.ts   mDNS _nanoleafapi._tcp       │
│  device/pairing.ts     POST /api/v1/new             │
│  device/rest.ts        REST 16021                   │
│  device/stream.ts      dgram UDP → 60222 (v2)       │
│  device/arbiter.ts     priorité des sources         │
│  audio/capture.ts      monitor PipeWire → analyse   │
│  store.ts              config JSON persistée        │
└──────────────── IPC (contextBridge) ────────────────┘
┌─ renderer (React) ──────────────────────────────────┐
│  UI + LayoutCanvas (WebGL)                          │
│  ┌ Worker: VideoFrame → OffscreenCanvas → Color[] ┐ │
└─────────────────────────────────────────────────────┘
```

### 4.2 Règles structurantes

- **Le renderer n'ouvre aucune socket réseau.** Il produit des couleurs et
  les envoie par IPC.
- **`stream.ts` est le seul writer du socket UDP.** Toute source passe par
  `arbiter.ts`.
- **Le token d'authentification ne quitte jamais le processus main.**
- Le traitement pixel vit dans un Worker dédié : le thread UI n'est jamais
  bloqué par la capture.

### 4.3 Contrat IPC

| Canal | Sens | Charge utile |
|---|---|---|
| `devices:discover` | R→M | — |
| `devices:list` | M→R | `DeviceInfo[]` |
| `devices:pair` | R→M | `{ ip }` |
| `devices:state` | M→R | `{ on, brightness, hue, sat, ct, effect }` |
| `devices:setState` | R→M | `Partial<State>` |
| `devices:layout` | M→R | `PanelLayout` |
| `effects:list` | M→R | `Effect[]` |
| `effects:select` | R→M | `{ name }` |
| `capture:start` / `capture:stop` | R→M | `{ mode }` |
| `stream:frame` | R→M | `{ colors: Color[], transitionTime }` |
| `audio:devices` | M→R | `AudioDevice[]` |
| `audio:features` | R→M | `{ bass, mid, treble, beat }` |

Ce contrat est étroit par construction : il permet de tester le pipeline
couleur sans device, et le device sans UI.

## 5. Couche device

### 5.1 Découverte

mDNS sur `_nanoleafapi._tcp.local` (`bonjour-service`). Les TXT records
donnent le modèle (`md=`) et la version firmware (`srcvers=`). Saisie
manuelle d'IP en repli si le mDNS est filtré.

### 5.2 Appairage

1. L'UI affiche l'instruction : maintenir le bouton power 5-7 s jusqu'au
   clignotement de la LED.
2. Le main appelle `POST http://<ip>:16021/api/v1/new` toutes les 2 s
   pendant 30 s.
3. Réponse `200` → `{ "auth_token": "..." }`, persisté. Hors fenêtre
   d'appairage le device répond `403`, la boucle est donc inoffensive.

Stockage : `~/.config/nanoleaf-app/config.json`, permissions `0600`.

### 5.3 REST

Base : `http://<ip>:16021/api/v1/<token>/`

| Appel | Usage |
|---|---|
| `GET /` | état complet |
| `PUT /state` | on/off, brightness, hue, sat, ct |
| `GET /effects/effectsList` | noms des effets |
| `PUT /effects` | sélection d'effet, armement extControl |
| `GET /panelLayout/layout` | géométrie des panneaux |

`panelLayout/layout` renvoie `numPanels`, `sideLength`, et un
`positionData[]` de `{ panelId, x, y, o, shapeType }`. Ces coordonnées sont
normalisées côté app dans un carré `[0,1]²` en conservant le rapport
d'aspect, pour servir à la fois au rendu WebGL et au mapping spatial.

### 5.4 Streaming External Control v2

Armement :

```json
PUT /effects
{ "write": { "command": "display",
             "animType": "extControl",
             "extControlVersion": "v2" } }
```

Le device écoute ensuite en UDP sur le port **60222**.

Format de trame, big-endian :

```
uint16  nPanels
répété nPanels fois :
  uint16  panelId
  uint8   R
  uint8   G
  uint8   B
  uint8   W            (0 sur Shapes / Lines)
  uint16  transitionTime   (unité : 100 ms)
```

Trois contraintes opérationnelles, non négociables :

- **`transitionTime = 1`** (100 ms) plutôt que 0. Le device interpole
  lui-même, ce qui lisse le rendu et absorbe le jitter réseau. À 0, le
  résultat scintille.
- **Cadence plafonnée à 25-30 Hz**, avec adaptation à la baisse si le
  temps d'envoi dérive. Au-delà, les panneaux droppent des trames de façon
  visible.
- **Le mode extControl est révocable** par toute autre commande (app
  mobile, bouton physique). Pendant un sync, `stream.ts` sonde l'état
  toutes les 10 s et réarme si nécessaire.

API exposée : `setPanels(colors: Color[], transitionTime: number)`. Les
appels sont ignorés si le mode externe n'est pas armé.

## 6. Pipeline de synchronisation écran

### 6.1 Capture

`setDisplayMediaRequestHandler` côté main, `getDisplayMedia` côté renderer.

Sous Wayland, Chromium délègue la sélection au portail xdg-desktop-portal :
`desktopCapturer.getSources()` ne renvoie pas la liste réelle des fenêtres,
c'est le sélecteur GNOME qui s'ouvre.

Deux limitations à assumer et à documenter dans l'UI :

- Pas de vignettes de fenêtres dans l'interface de l'app.
- Le jeton de restauration du portail n'étant pas exposé par Electron, la
  fenêtre doit être re-sélectionnée à chaque lancement. Mitigation : le
  flux est conservé vivant tant que l'app tourne, donc basculer le sync
  on/off ne redemande rien.

### 6.2 Lecture des frames

`MediaStreamTrackProcessor` transfère la piste vidéo dans le Worker, qui
consomme des `VideoFrame` sans passer par le thread UI. Chaque frame est
dessinée dans un `OffscreenCanvas` **64×36** : le redimensionnement est
fait par le GPU, l'analyse porte sur 2304 pixels.

### 6.3 Traitement

Ordre imposé :

1. **Détection et crop du letterbox.** Sans cette étape, un film en 2.35:1
   éteint les panneaux hauts et bas.
2. **Moyennage en espace linéaire.** Conversion sRGB → linéaire avant
   moyenne, retour après. Moyenner en sRGB produit du gris désaturé.
3. **Mapping**, selon le mode :
   - *Spatial* — chaque panneau échantillonne la zone d'image
     correspondant à sa position normalisée, avec pondération gaussienne.
     Le rayon est réglable ; les zones se recouvrent, ce qui adoucit les
     transitions entre panneaux voisins.
   - *Dominant* — histogramme 3D 16 bins, cluster majoritaire pondéré par
     la saturation. Tous les panneaux reçoivent la même couleur.
   - *Palette* — 3 à 5 clusters principaux, distribués sur les panneaux et
     permutés lentement.
4. **Correction** — boost de saturation, plancher de noir (en dessous d'un
   seuil le device coupe), gamma par device.
5. **Lissage temporel asymétrique** — EMA à attaque rapide et relâche
   lente. Un EMA symétrique donne soit du strobe sur les coupes, soit une
   réactivité molle.

Les étapes 2 à 5 sont des fonctions pures de signature
`(ImageData, PanelLayout, Settings) => Color[]`, testables sur fixtures.

### 6.4 Réglages exposés

| Réglage | Plage | Défaut |
|---|---|---|
| Mode de mapping | spatial / dominant / palette | spatial |
| Rayon d'échantillonnage | 0.05 – 0.5 | 0.18 |
| Saturation | 0.5 – 2.0 | 1.25 |
| Plancher de noir | 0 – 20 % | 4 % |
| Attaque EMA | 0.1 – 1.0 | 0.6 |
| Relâche EMA | 0.02 – 0.5 | 0.15 |
| Cadence | 10 – 30 Hz | 25 Hz |

## 7. Synchronisation audio

### 7.1 Capture

Le portail ScreenCast de Chromium ne fournit pas l'audio système sous
Linux : `getDisplayMedia({ audio: true })` ne rend rien d'exploitable.

Chemin retenu : `enumerateDevices()` expose les sources *monitor* de
pipewire-pulse (« Monitor of … »), ouvertes via `getUserMedia`. L'UI
propose la liste des monitors.

Repli si la compat Pulse est absente : `pw-record` lancé depuis le
processus main, PCM brut pipé vers l'analyse.

### 7.2 Analyse

`AudioWorklet`, FFT 1024, bandes espacées logarithmiquement (graves,
médiums, aigus). Détection de beat par flux d'énergie sur les graves avec
seuil adaptatif (moyenne glissante et variance) — un seuil fixe ne
fonctionne que sur un morceau donné.

Sortie : `{ bass, mid, treble, beat }`, valeurs normalisées.

## 8. Arbitrage des sources

Priorité stricte, un seul writer :

```
1. Peinture manuelle d'un panneau  (override 3 s, puis relâche)
2. Sync écran
3. Sync audio
4. Scène / effet du device
```

> **Écart assumé, 26 août 2026.** Le relâchement au bout de trois secondes a
> été retiré : à l'usage il se lisait comme un mur qui s'efface tout seul
> quelques instants après avoir été peint. La peinture tient désormais le mur
> jusqu'à ce que quelque chose le reprenne — une scène, une synchro,
> l'extinction, ou le device qui annonce un effet de lui-même. Les trois
> secondes restent, mais uniquement comme priorité dans `arbiter.ts` : un
> trait passe devant une synchro en cours pendant ce délai. Voir `dc40e21`.

Deux modes de sync ne sont jamais actifs en concurrence sur le socket. Un
mode **combiné** explicite existe — l'écran fournit la teinte, l'audio
module l'intensité — implémenté comme un producteur unique lisant deux
entrées, pas comme deux writers.

### 8.1 Restauration d'état

Avant d'armer extControl, l'effet courant et l'état on/off sont
sauvegardés. Ils sont réappliqués :

- à l'arrêt manuel du sync,
- à la fermeture de la fenêtre,
- sur `SIGTERM` / `SIGINT`.

Sans cette restauration, les panneaux restent figés sur la dernière frame
diffusée.

## 9. Interface

### 9.1 Direction visuelle

Fenêtre sombre, sans décoration système (frameless avec zone de drag), une
vue principale unique.

L'élément central est le **canvas de layout** : les panneaux rendus en
WebGL à leur position et rotation réelles, chacun entouré d'un halo diffus
reprenant sa couleur en direct. Pendant un sync, la fenêtre devient une
maquette animée du mur physique.

Le reste se subordonne : fond quasi noir avec un gradient lent dérivant
vers la couleur dominante courante, panneau latéral en verre dépoli pour
les contrôles, typographie unique en graisses contrastées, animations
limitées à `transform` et `opacity` — aucun recalcul de layout pendant
qu'un sync tourne à 30 Hz.

### 9.2 Écrans

| Écran | Contenu |
|---|---|
| **Contrôle** | canvas de layout, roue chromatique, luminosité, on/off |
| **Scènes** | grille de vignettes générées depuis les palettes réelles des effets du device |
| **Sync** | source, mode de mapping, réglages du §6.4, aperçu live de la capture à côté du canvas |

Interaction notable : clic sur un panneau du canvas pour le peindre
directement (déclenche l'override du §8).

## 10. Tests

### 10.1 Unitaires (Vitest)

Couverture obligatoire, c'est là que se logent les vrais défauts :

- détection de letterbox sur fixtures 16:9, 2.35:1, 4:3, plein noir
- conversion sRGB ↔ linéaire (aller-retour idempotent)
- mapping spatial : géométries à 1, 2, 20 panneaux ; panneau hors cadre
- clustering dominant et palette sur images de référence
- EMA asymétrique : réponse à un échelon montant et descendant
- encodage de trame v2 : comparaison octet à octet avec des vecteurs
  attendus, y compris `nPanels = 0` et valeurs limites

### 10.2 Device factice

Serveur REST factice plus socket UDP local décodant les trames. Permet de
couvrir en CI le chemin complet appairage → layout → streaming sans
matériel.

### 10.3 Manuel

La capture Wayland et l'audio monitor ne s'automatisent pas
raisonnablement. Checklist à tenir à jour :

1. Appairage à froid sur device non appairé
2. Sélection de fenêtre VLC, lecture d'un film sombre puis d'un film
   coloré
3. Sync audio sur musique à beat marqué
4. Interruption : sélection d'un effet depuis l'app mobile pendant un sync
   → l'app doit réarmer
5. Fermeture brutale de l'app → les panneaux retrouvent leur effet

### 10.4 Cibles de performance

- latence bout en bout (frame écran → panneau allumé) : **< 80 ms**
- thread UI : **jamais sous 60 fps** pendant un sync
- CPU au repos avec sync actif : objectif sous 10 % d'un cœur

## 11. Hors périmètre v1

- X11 (l'architecture ne l'interdit pas, mais non testé)
- Light Panels première génération / streaming v1
- Contrôle hors du réseau local, cloud Nanoleaf
- Éditeur d'effets personnalisés téléversés vers le device
- Multi-device simultané avec layouts fusionnés (un device à la fois en v1)

## 12. Risques

| Risque | Impact | Mitigation |
|---|---|---|
| Re-sélection de fenêtre à chaque lancement (portail) | friction utilisateur | flux maintenu vivant ; documenté dans l'UI |
| Panneaux qui droppent des trames en cadence haute | rendu saccadé | plafond 25-30 Hz, adaptation à la baisse |
| extControl révoqué par une autre application | sync mort silencieusement | sondage d'état toutes les 10 s, réarmement |
| Monitors audio absents sans compat Pulse | pas de sync audio | repli `pw-record` |
| mDNS filtré par le routeur | device introuvable | saisie manuelle d'IP |

## 13. Découpage en jalons

Le périmètre dépasse ce qu'un seul plan d'implémentation peut couvrir
proprement. Ordre retenu, chaque jalon étant utilisable seul :

1. **Socle device** — découverte, appairage, REST, état, layout. Vérifiable
   avec le device factice et le matériel réel, sans UI aboutie.
2. **Streaming** — armement extControl, encodage v2, sender à cadence
   adaptative, arbitre, restauration d'état.
3. **UI de contrôle** — canvas WebGL2, roue chromatique, luminosité,
   scènes. Première version présentable.
4. **Sync écran** — capture portail, Worker, pipeline couleur, réglages.
5. **Sync audio** — capture monitor, analyse, mode combiné.

Les jalons 1 et 2 sont un prérequis strict de 4 et 5. Le jalon 3 peut être
mené en parallèle des 4-5 une fois 1-2 en place.
