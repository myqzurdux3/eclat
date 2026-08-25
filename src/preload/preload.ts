import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type NanoleafApi } from '../shared/ipc-contract'

const api: NanoleafApi = {
  discover: () => ipcRenderer.invoke(IPC_CHANNELS.discover),
  pair: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.pair, deviceId),
  listDevices: () => ipcRenderer.invoke(IPC_CHANNELS.list),
  getState: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.getState, deviceId),
  setOn: (deviceId, on) => ipcRenderer.invoke(IPC_CHANNELS.setOn, deviceId, on),
  setBrightness: (deviceId, value) => ipcRenderer.invoke(IPC_CHANNELS.setBrightness, deviceId, value),
  getLayout: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.getLayout, deviceId),
  getEffects: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.getEffects, deviceId),
  getEffectPalettes: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.effectPalettes, deviceId),
  selectEffect: (deviceId, name) => ipcRenderer.invoke(IPC_CHANNELS.selectEffect, deviceId, name),
  startStream: (deviceId, source) => ipcRenderer.invoke(IPC_CHANNELS.startStream, deviceId, source),
  stopStream: (deviceId, source) => ipcRenderer.invoke(IPC_CHANNELS.stopStream, deviceId, source),
  sendFrame: (deviceId, source, colors, transitionTime) =>
    ipcRenderer.invoke(IPC_CHANNELS.frame, deviceId, source, colors, transitionTime),
  paintPanel: (deviceId, panelId, color) =>
    ipcRenderer.invoke(IPC_CHANNELS.paintPanel, deviceId, panelId, color),
  setColor: (deviceId, hue, sat) => ipcRenderer.invoke(IPC_CHANNELS.setColor, deviceId, hue, sat),
}

contextBridge.exposeInMainWorld('nanoleaf', api)
