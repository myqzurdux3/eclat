# Nanoleaf for Linux

Control and screen-sync application for Nanoleaf light panels, built for Linux
desktops. Discovers panels over mDNS, pairs with them, renders the wall in
WebGL2 at its real geometry, and drives the panels in real time from what is on
your screen.

*[Version française](README.fr.md)*

> **Status: working, not finished.** Discovery, pairing, control, scenes and
> screen sync all run against real hardware. Audio sync and packaging are not
> written yet. See [Roadmap](#roadmap).

## Why

The Nanoleaf mobile app is the only officially supported way to drive these
panels, and the existing third-party desktop tools I tried did not work on a
current Wayland/GNOME desktop. Everything here talks to the panels directly
over their documented local HTTP API — no cloud account, no vendor SDK, no
telemetry.

## Features

- **Discovery** over mDNS (`_nanoleafapi._tcp`), implemented directly on
  `node:dgram` — see [mDNS on Linux](#mdns-on-linux) for why.
- **Pairing** with the panel's local API; the auth token is stored in
  `~/.config/nanoleaf-app/config.json` with `0600` permissions and never
  leaves the Electron main process.
- **Wall rendering** in WebGL2 without a rendering library: panels are drawn at
  their real position, shape and rotation, each with a diffuse halo.
- **Control**: power, brightness, a hue/saturation wheel, and click-to-paint on
  any individual panel.
- **Scenes** built from the palettes actually stored on the device, not from
  invented colours.
- **Screen sync**: capture through the Wayland portal, analysed in a dedicated
  Worker, with three mapping modes (spatial, dominant, palette), letterbox
  detection, linear-light averaging and asymmetric temporal smoothing.
- **French and English** interface.

## Requirements

- Linux with Node.js 22+ (developed on Node 26, Ubuntu 26.04, Wayland/GNOME).
- A Nanoleaf device on the same network. Developed and verified against
  **Nanoleaf Shapes (NL42)**, firmware 12.x. Canvas, Elements and Lines share
  the same API and are handled in the geometry table, but are untested.
- The panels are **2.4 GHz only** — make sure your access point broadcasts a
  2.4 GHz SSID.

## Getting started

```bash
git clone https://github.com/myqzurdux3/nanoleaf.git
cd nanoleaf
npm install
npm start
```

On first launch the app looks for panels on the local network. Hold the panel's
power button for 5–7 seconds until the LED blinks, then press **Pair**.

### Electron sandbox on Ubuntu

Ubuntu restricts unprivileged user namespaces, so Chromium falls back to its
SUID sandbox helper, which npm does not install as root. If Electron aborts
with *"The SUID sandbox helper binary was found, but is not configured
correctly"*, run once per `npm install`:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

Do not pass `--no-sandbox` instead: it permanently disables the renderer's
isolation to work around a temporary system setting.

## Development

```bash
npm test                # 273 unit tests, no hardware or network needed
npm run build           # main process + renderer
npm run dev:renderer    # Vite dev server, then:
VITE_DEV_SERVER_URL=http://localhost:5173 npm start
```

Opening `http://localhost:5173` directly in a browser shows a notice rather
than the app: the Vite server only serves the interface, and everything that
talks to the panels lives in the Electron main process.

### Testing philosophy

No test needs hardware, a network, a GPU or a DOM. The device is doubled by
`FakeNanoleaf` (REST) and `FakeStreamReceiver` (UDP), so the full path from
pairing to streaming is covered in CI. Everything that can be a pure function —
colour space conversion, panel geometry, the whole sync pipeline — is one, and
is tested on hand-built fixtures.

Two helper tools cover what unit tests cannot:

```bash
npm run build
CAPTURE_OUT=/tmp/ui.png npx electron tools/capture-ui.cjs   # screenshot the window
npx electron tools/probe-worker-transfer.cjs                # capture → Worker → colours
```

## Architecture

```
main (Node)                          renderer (React)
├── device/discovery.ts  mDNS        ├── screens/     Control, Scenes, Sync
├── device/pairing.ts    POST /new   ├── gl/          WebGL2 wall
├── device/client.ts     REST :16021 └── worker/      frame analysis
├── device/stream.ts     UDP :60222        │
├── device/arbiter.ts    priorities        ▼
└── store.ts             0600 config   shared/  pure functions, no I/O
```

Three rules shape the whole thing:

1. **The renderer opens no socket.** It produces colours and hands them over
   IPC. The auth token never reaches it.
2. **`stream.ts` is the only writer of the UDP socket.** Every source goes
   through `arbiter.ts`, which enforces a strict priority: manual painting
   (3-second override) over screen sync over audio sync over the device's own
   effect.
3. **Pixel work lives in a Worker.** The UI thread never touches a frame.

## Notes from the hardware

Things the documentation does not tell you, found by measurement:

- **mDNS on Linux.** `bonjour-service` finds nothing on a typical desktop:
  `avahi-daemon` already holds port 5353 and the kernel delivers the multicast
  answer to only one of the bound processes. The queries here set the QU bit to
  get a unicast answer on an ephemeral port instead. One socket is opened per
  IPv4 interface, because an active VPN owns the default route without reaching
  the LAN.
- **REST latency is 60–340 ms.** A slider emits around sixty events per second,
  so writes must be coalesced: one request in flight, latest value wins.
  Measured 60 slider values → 3 requests.
- **External control is revocable.** Any other command — the mobile app, the
  physical button — takes it back, so an active sync re-arms every 10 seconds.
  The flip side: a stream that is never released makes the device unable to
  display any effect at all.
- **`normalizeLayout` normalises panel centres**, so polygons stick out of the
  unit square by a full circumradius — 20 % on a real Shapes wall. Framing must
  be computed from actual vertices.
- **Panel colours are not readable.** The device exposes no per-panel colour,
  so the wall shown in the app is a faithful mock-up of the device state, not a
  reading of its LEDs.

## Roadmap

| Milestone | State |
|---|---|
| 1 — Device layer: discovery, pairing, REST, layout | done |
| 2 — Streaming: extControl v2, frame encoding, arbiter | done |
| 3 — Control UI: WebGL2 wall, colour wheel, scenes | done |
| 4 — Screen sync: portal capture, Worker, colour pipeline | done |
| 5 — Audio sync: PipeWire monitor capture, analysis | not started |
| 6 — Packaging with electron-builder | not started |

## Project documentation

Design and implementation notes live in `docs/superpowers/`. They are written
in French, as are the code comments.

## Licence

MIT — see [LICENSE](LICENSE).

Not affiliated with, endorsed by, or supported by Nanoleaf. "Nanoleaf" is a
trademark of its owner and is used here only to say what this software talks
to.
