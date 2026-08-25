// Outil de vérification visuelle.
//
// Lance l'application, la laisse se peupler avec le vrai device, capture la
// fenêtre en PNG puis quitte. GNOME refuse la capture d'écran aux clients
// non approuvés et le poste n'a pas d'outil en ligne de commande : passer
// par `capturePage()` de la fenêtre elle-même est le seul moyen de regarder
// le rendu réel sans intervention humaine.
//
//   npm run build
//   CAPTURE_OUT=/tmp/ui.png npx electron tools/capture-ui.cjs
//
// Variables : CAPTURE_OUT (obligatoire), CAPTURE_WAIT (ms avant capture),
// CAPTURE_TAB=scenes, CAPTURE_ROTATION='90°'.
const { app, BrowserWindow, ipcMain } = require('electron')
const { join } = require('node:path')
const { writeFileSync } = require('node:fs')

const { DeviceService, registerIpc } = require('../dist/main/main/ipc')
const { ConfigStore, defaultConfigPath } = require('../dist/main/main/store')
const { createMdnsFactory } = require('../dist/main/main/device/mdns')

const SORTIE = process.env.CAPTURE_OUT
const ATTENTE = Number(process.env.CAPTURE_WAIT ?? 6000)
const ONGLET = process.env.CAPTURE_TAB ?? 'controle'

app.whenReady().then(async () => {
  const service = new DeviceService({
    store: new ConfigStore(defaultConfigPath()),
    mdnsFactory: createMdnsFactory(),
  })
  registerIpc(ipcMain, service)

  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    frame: false,
    show: true,
    backgroundColor: '#08080b',
    webPreferences: {
      preload: join(__dirname, '../dist/main/preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  await window.loadFile(join(__dirname, '../dist/renderer/index.html'))
  await new Promise((resolve) => setTimeout(resolve, ATTENTE))

  const ROTATION = process.env.CAPTURE_ROTATION
  if (ROTATION !== undefined) {
    await window.webContents.executeJavaScript(
      `[...document.querySelectorAll('.segments button')].find(b => b.textContent === '${ROTATION}').click()`,
    )
    await new Promise((resolve) => setTimeout(resolve, 900))
  }

  const LIBELLES = { scenes: 'Scènes', sync: 'Sync', controle: 'Contrôle' }
  if (LIBELLES[ONGLET] !== undefined && ONGLET !== 'controle') {
    await window.webContents.executeJavaScript(
      `[...document.querySelectorAll('.onglets button')].find(b => b.textContent.trim() === ${JSON.stringify(LIBELLES[ONGLET])}).click()`,
    )
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }

  const image = await window.webContents.capturePage()
  writeFileSync(SORTIE, image.toPNG())
  console.log('capture écrite:', SORTIE)

  await service.shutdown()
  app.exit(0)
})
