import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { createMdnsFactory } from './device/mdns'
import { DeviceService, registerIpc } from './ipc'
import { ConfigStore, defaultConfigPath, legacyConfigPath } from './store'
import { IPC_CHANNELS } from '../shared/ipc-contract'

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

/**
 * Ouvre la capture d'écran au renderer.
 *
 * Sous Wayland, Chromium délègue la sélection au portail
 * xdg-desktop-portal : c'est le sélecteur GNOME qui s'ouvre, et
 * `desktopCapturer.getSources()` ne renvoie pas la liste réelle des
 * fenêtres. Le repli ci-dessous ne sert donc qu'aux sessions X11.
 */
function autoriserCaptureEcran(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      void desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          const premiere = sources[0]
          callback(premiere === undefined ? {} : { video: premiere })
        })
        .catch(() => callback({}))
    },
    { useSystemPicker: true },
  )
}

function createWindow(): void {
  const window = new BrowserWindow({
    title: 'Éclat',
    icon: join(__dirname, '../../assets/logo.png'),
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

let service: DeviceService | undefined
let quitting = false

async function shutdown(): Promise<void> {
  await service?.shutdown()
}

app.whenReady().then(() => {
  service = new DeviceService({
    store: new ConfigStore(defaultConfigPath(), legacyConfigPath()),
    mdnsFactory: createMdnsFactory(),
    onDeviceEvent: (event) => {
      for (const fenetre of BrowserWindow.getAllWindows()) {
        fenetre.webContents.send(IPC_CHANNELS.deviceEvent, event)
      }
    },
  })
  void service.watchPairedDevices().catch(() => undefined)
  registerIpc(ipcMain, service)

  ipcMain.handle(IPC_CHANNELS.windowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle(IPC_CHANNELS.windowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  autoriserCaptureEcran()
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
