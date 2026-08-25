import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { createMdnsFactory } from './device/mdns'
import { DeviceService, registerIpc } from './ipc'
import { ConfigStore, defaultConfigPath } from './store'

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
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

app.whenReady().then(() => {
  const service = new DeviceService({
    store: new ConfigStore(defaultConfigPath()),
    mdnsFactory: createMdnsFactory(),
  })
  registerIpc(ipcMain, service)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
