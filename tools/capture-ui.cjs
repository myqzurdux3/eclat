// Visual verification tool.
//
// Launches the application, lets it populate from the real device, captures
// the window as a PNG and quits. GNOME refuses screenshots to unapproved
// clients and this machine has no command-line tool, so going through the
// window's own `capturePage()` is the only way to look at the real rendering
// without a human present.
//
//   npm run build
//   CAPTURE_OUT=/tmp/ui.png npx electron tools/capture-ui.cjs
//
// Variables: CAPTURE_OUT (required), CAPTURE_WAIT (ms before capture),
// CAPTURE_TAB=scenes, CAPTURE_ROTATION=90, CAPTURE_LOCALE=en.
const { app, BrowserWindow, ipcMain } = require('electron')
const { join } = require('node:path')
const { writeFileSync } = require('node:fs')

const { DeviceService, registerIpc } = require('../dist/main/main/ipc')
const { ConfigStore, defaultConfigPath, legacyConfigPath } = require('../dist/main/main/store')
const { createMdnsFactory } = require('../dist/main/main/device/mdns')

const OUTPUT = process.env.CAPTURE_OUT
const WAIT = Number(process.env.CAPTURE_WAIT ?? 6000)
const TAB = process.env.CAPTURE_TAB ?? 'controle'
// Rotation in degrees, as the application stores it.
const ROTATION = process.env.CAPTURE_ROTATION

app.whenReady().then(async () => {
  const service = new DeviceService({
    store: new ConfigStore(defaultConfigPath(), legacyConfigPath()),
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

  window.webContents.on('console-message', (event) => {
    console.log('[renderer]', event.level, event.message)
  })
  window.webContents.on('render-process-gone', (_e, details) => {
    console.log('[renderer gone]', JSON.stringify(details))
  })

  // The tab is chosen before the first render: Chromium stops repainting an
  // occluded window, and `capturePage` would otherwise return a stale frame.
  await window.loadFile(join(__dirname, '../dist/renderer/index.html'))
  await window.webContents.executeJavaScript(
    `localStorage.setItem('eclat.tab', ${JSON.stringify(TAB)})`,
  )
  const LOCALE = process.env.CAPTURE_LOCALE
  if (LOCALE !== undefined) {
    await window.webContents.executeJavaScript(
      `localStorage.setItem('eclat.locale', ${JSON.stringify(LOCALE)})`,
    )
  }
  if (ROTATION !== undefined) {
    await window.webContents.executeJavaScript(
      `localStorage.setItem('nanoleaf.rotation', ${JSON.stringify(ROTATION)})`,
    )
  }
  window.reload()
  await new Promise((resolve) => setTimeout(resolve, WAIT))

  const image = await window.webContents.capturePage()
  writeFileSync(OUTPUT, image.toPNG())
  console.log('capture written:', OUTPUT)

  await service.shutdown()
  app.exit(0)
})
