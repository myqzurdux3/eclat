// Vérifie de bout en bout le chemin capture → Worker → couleurs, avec le
// Worker réellement embarqué dans l'application.
//
// `canvas.captureStream()` donne une piste vidéo sans passer par le portail
// xdg-desktop-portal, donc sans clic humain : c'est le seul moyen de tester
// le transfert et la lecture des VideoFrame sans intervention.
//
//   npm run build && npx electron tools/probe-worker-transfer.cjs
const { app, BrowserWindow, ipcMain } = require('electron')
const { join } = require('node:path')
const { readdirSync } = require('node:fs')

const { DeviceService, registerIpc } = require('../dist/main/main/ipc')
const { ConfigStore, defaultConfigPath, legacyConfigPath } = require('../dist/main/main/store')
const { createMdnsFactory } = require('../dist/main/main/device/mdns')

const RACINE = join(__dirname, '../dist/renderer')

function trouverWorker() {
  const assets = readdirSync(join(RACINE, 'assets'))
  const fichier = assets.find((nom) => nom.startsWith('capture.worker-') && nom.endsWith('.js'))
  if (fichier === undefined) throw new Error('Worker introuvable : lance `npm run build`')
  return `./assets/${fichier}`
}

app.whenReady().then(async () => {
  const worker = trouverWorker()

  const service = new DeviceService({
    store: new ConfigStore(defaultConfigPath(), legacyConfigPath()),
    mdnsFactory: createMdnsFactory(),
  })
  registerIpc(ipcMain, service)

  const window = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: {
      preload: join(__dirname, '../dist/main/preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.log('[renderer]', event.message)
  })
  await window.loadFile(join(RACINE, 'index.html'))

  const resultat = await window.webContents.executeJavaScript(`
    (async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 180
      const ctx = canvas.getContext('2d')

      // Moitié gauche rouge, moitié droite bleue : le mapping spatial doit
      // les séparer, et le mode dominante doit trancher.
      ctx.fillStyle = 'rgb(255, 0, 0)'
      ctx.fillRect(0, 0, 160, 180)
      ctx.fillStyle = 'rgb(0, 0, 255)'
      ctx.fillRect(160, 0, 160, 180)
      setInterval(() => {
        ctx.fillStyle = 'rgb(255, 0, 0)'
        ctx.fillRect(0, 0, 160, 180)
        ctx.fillStyle = 'rgb(0, 0, 255)'
        ctx.fillRect(160, 0, 160, 180)
      }, 40)

      const piste = canvas.captureStream(25).getVideoTracks()[0]
      if (piste === undefined) return { ok: false, raison: 'aucune piste' }

      if (window.nanoleaf === undefined) return { ok: false, raison: 'pont IPC absent' }
      const devices = await window.nanoleaf.listDevices()
      const device = devices.find((d) => d.paired)
      if (device === undefined) return { ok: false, raison: 'aucun device appairé' }
      const layout = await window.nanoleaf.getLayout(device.id)

      const readable = new MediaStreamTrackProcessor({ track: piste }).readable
      const w = new Worker(${JSON.stringify(worker)}, { type: 'module' })

      return await new Promise((resolve) => {
        const vues = []
        const minuterie = setTimeout(
          () => resolve({ ok: false, raison: 'aucune couleur en 8 s', vues }),
          8000,
        )
        w.onmessage = (event) => {
          if (event.data.type === 'error') {
            clearTimeout(minuterie)
            resolve({ ok: false, raison: 'worker: ' + event.data.message })
            return
          }
          if (event.data.type !== 'colors') return
          vues.push(event.data.colors)
          if (vues.length >= 25) {
            clearTimeout(minuterie)
            w.postMessage({ type: 'stop' })
            const derniere = vues[vues.length - 1]
            resolve({
              ok: true,
              frames: vues.length,
              panneaux: derniere.length,
              premier: derniere[0],
              dernier: derniere[derniere.length - 1],
            })
          }
        }
        w.onerror = (event) => {
          clearTimeout(minuterie)
          resolve({ ok: false, raison: 'onerror: ' + event.message })
        }
        w.postMessage(
          {
            type: 'start',
            readable,
            layout,
            settings: { mode: 'spatial', radius: 0.1, saturation: 1, blackFloor: 0, attack: 1, release: 1, hz: 25 },
          },
          [readable],
        )
      })
    })()
  `)

  console.log(JSON.stringify(resultat, null, 2))
  await service.shutdown()
  app.exit(resultat.ok ? 0 : 1)
})
