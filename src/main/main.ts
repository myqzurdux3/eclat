import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { createMdnsFactory } from './device/mdns'
import { DeviceService, registerIpc } from './ipc'
import { ConfigStore, defaultConfigPath, legacyConfigPath } from './store'
import { IPC_CHANNELS } from '../shared/ipc-contract'

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

/** Beyond this, assume enumerating the sources will never answer. */
const CAPTURE_FALLBACK_MS = 4000

/**
 * Opens screen capture to the renderer.
 *
 * On Wayland, Chromium delegates the choice to xdg-desktop-portal: the GNOME
 * picker opens, and `desktopCapturer.getSources()` does not return the real
 * list of windows. The fallback below therefore only serves X11 sessions.
 */
function allowScreenCapture(): void {
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

      const timeout = setTimeout(() => callback({}), CAPTURE_FALLBACK_MS)
      void desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          clearTimeout(timeout)
          // The whole screen, named: handing over `sources[0]` shared
          // whichever window happened to come first, which the user never
          // chose. Sharing a screen should not be a surprise.
          const screen = sources.find((source) => source.id.startsWith('screen:'))
          callback(screen === undefined ? {} : { video: screen })
        })
        .catch(() => {
          clearTimeout(timeout)
          callback({})
        })
    },
    { useSystemPicker: true },
  )
}

/**
 * Shuts the doors the application never uses.
 *
 * It renders no remote content and opens no windows of its own, so every one
 * of these is a door that only an accident or an attack could walk through.
 * The device's own strings — panel names, effect names — do reach the
 * renderer, and React escapes them, but that is one layer, not a policy.
 */
function hardenWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  window.webContents.on('will-navigate', (event, url) => {
    if (DEV_SERVER_URL !== undefined && url.startsWith(DEV_SERVER_URL)) return
    event.preventDefault()
  })

  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    })
  })
}

/**
 * Everything the interface needs and nothing more.
 *
 * `'unsafe-inline'` for styles is Vite's doing: it injects the stylesheet as
 * a tag. `blob:` covers the Worker, which is bundled as one.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

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
      // A sandboxed preload cannot `require` a relative module, and this one
      // imports the IPC contract it shares with the renderer: turning the
      // sandbox on gives "module not found: ../shared/ipc-contract" and no
      // bridge at all. Enabling it means bundling the preload into a single
      // file first. Measured, not assumed.
      sandbox: false,
    },
  })

  hardenWindow(window)

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
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.deviceEvent, event)
      }
    },
    onAudioFeatures: (features) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.audioFeatures, features)
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

  allowScreenCapture()
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
