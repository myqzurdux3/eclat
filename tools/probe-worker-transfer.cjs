// End-to-end check of the capture -> Worker -> colours path, using the very
// Worker the application ships.
//
// `canvas.captureStream()` yields a video track without going through
// xdg-desktop-portal, hence without a human click: it is the only way to
// test the transfer and the VideoFrame reading unattended.
//
//   npm run build && npx electron tools/probe-worker-transfer.cjs
const { app, BrowserWindow, ipcMain } = require('electron')
const { join } = require('node:path')
const { readdirSync } = require('node:fs')

const { DeviceService, registerIpc } = require('../dist/main/main/ipc')
const { ConfigStore, defaultConfigPath, legacyConfigPath } = require('../dist/main/main/store')
const { createMdnsFactory } = require('../dist/main/main/device/mdns')

const RACINE = join(__dirname, '../dist/renderer')

function findWorker() {
  const assets = readdirSync(join(RACINE, 'assets'))
  const file = assets.find((nom) => nom.startsWith('capture.worker-') && nom.endsWith('.js'))
  if (file === undefined) throw new Error('Worker not found: run `npm run build`')
  return `./assets/${file}`
}

app.whenReady().then(async () => {
  const worker = findWorker()

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

      // Left half red, right half blue: spatial mapping must separate them,
      // and dominant mode must pick a side.
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
      if (piste === undefined) return { ok: false, reason: 'no track' }

      if (window.nanoleaf === undefined) return { ok: false, reason: 'IPC bridge missing' }
      const devices = await window.nanoleaf.listDevices()
      const device = devices.find((d) => d.paired)
      if (device === undefined) return { ok: false, reason: 'no paired device' }
      const layout = await window.nanoleaf.getLayout(device.id)

      const readable = new MediaStreamTrackProcessor({ track: piste }).readable
      const w = new Worker(${JSON.stringify(worker)}, { type: 'module' })

      return await new Promise((resolve) => {
        const seen = []
        const timer = setTimeout(
          () => resolve({ ok: false, reason: 'no colours within 8 s', seen }),
          8000,
        )
        w.onmessage = (event) => {
          if (event.data.type === 'error') {
            clearTimeout(timer)
            resolve({ ok: false, reason: 'worker: ' + event.data.message })
            return
          }
          if (event.data.type !== 'colors') return
          const perDevice = event.data.colors[device.id]
          if (perDevice === undefined) return
          seen.push(perDevice)
          if (seen.length >= 25) {
            clearTimeout(timer)
            w.postMessage({ type: 'stop' })
            const last = seen[seen.length - 1]
            resolve({
              ok: true,
              frames: seen.length,
              panels: last.length,
              first: last[0],
              last: last[last.length - 1],
            })
          }
        }
        w.onerror = (event) => {
          clearTimeout(timer)
          resolve({ ok: false, reason: 'onerror: ' + event.message })
        }
        w.postMessage(
          {
            type: 'start',
            readable,
            targets: [{ deviceId: device.id, layout }],
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
