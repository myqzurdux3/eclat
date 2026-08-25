import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { createMdnsFactory } from './device/mdns'
import { DeviceService, registerIpc } from './ipc'
import { ConfigStore, defaultConfigPath, legacyConfigPath } from './store'
import { IPC_CHANNELS } from '../shared/ipc-contract'

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

/** Beyond this, assume enumerating the sources will never answer. */
const REPLI_CAPTURE_MS = 4000

/**
 * Opens screen capture to the renderer.
 *
 * On Wayland, Chromium delegates the choice to xdg-desktop-portal: the GNOME
 * picker opens, and `desktopCapturer.getSources()` does not return the real
 * list of windows. The fallback below therefore only serves X11 sessions.
 */
function autoriserCaptureEcran(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      // On Wayland the system picker answers in our stead and this handler
      // is not called. If it is called anyway, `getSources()` never returns —
      // it waits on a portal that will not come — and the request would hang
      // forever, leaving the interface stuck on "Selecting…". Better to
      // refuse outright.
      if (process.env.XDG_SESSION_TYPE === 'wayland') {
        callback({})
        return
      }

      const minuterie = setTimeout(() => callback({}), REPLI_CAPTURE_MS)
      void desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          clearTimeout(minuterie)
          const premiere = sources[0]
          callback(premiere === undefined ? {} : { video: premiere })
        })
        .catch(() => {
          clearTimeout(minuterie)
          callback({})
        })
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

// Without this restore, the panels would stay frozen on the last frame
// broadcast.
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
