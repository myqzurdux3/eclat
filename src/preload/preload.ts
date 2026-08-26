import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type DeviceEventMessage,
  type NanoleafApi,
} from '../shared/ipc-contract'
import type { AudioFeatures } from '../shared/audio/analyser'

const api: NanoleafApi = {
  discover: () => ipcRenderer.invoke(IPC_CHANNELS.discover),
  pair: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.pair, deviceId),
  listDevices: () => ipcRenderer.invoke(IPC_CHANNELS.list),
  getState: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.getState, deviceId),
  setOn: (deviceId, on) => ipcRenderer.invoke(IPC_CHANNELS.setOn, deviceId, on),
  setBrightness: (deviceId, value) => ipcRenderer.invoke(IPC_CHANNELS.setBrightness, deviceId, value),
  getLayout: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.getLayout, deviceId),
  getEffectPalettes: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.effectPalettes, deviceId),
  selectEffect: (deviceId, name) => ipcRenderer.invoke(IPC_CHANNELS.selectEffect, deviceId, name),
  startStream: (deviceId, source) => ipcRenderer.invoke(IPC_CHANNELS.startStream, deviceId, source),
  stopStream: (deviceId, source) => ipcRenderer.invoke(IPC_CHANNELS.stopStream, deviceId, source),
  sendFrame: (deviceId, source, colors, transitionTime) =>
    ipcRenderer.invoke(IPC_CHANNELS.frame, deviceId, source, colors, transitionTime),
  paintPanel: (deviceId, panelId, color) =>
    ipcRenderer.invoke(IPC_CHANNELS.paintPanel, deviceId, panelId, color),
  paintPanels: (deviceId, entries) =>
    ipcRenderer.invoke(IPC_CHANNELS.paintPanels, deviceId, entries),
  setColor: (deviceId, hue, sat) => ipcRenderer.invoke(IPC_CHANNELS.setColor, deviceId, hue, sat),
  onDeviceEvent: (listener) => {
    const relay = (_event: unknown, message: DeviceEventMessage): void => listener(message)
    ipcRenderer.on(IPC_CHANNELS.deviceEvent, relay)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.deviceEvent, relay)
  },
  listAudioSources: () => ipcRenderer.invoke(IPC_CHANNELS.audioSources),
  startAudioCapture: (sourceId) => ipcRenderer.invoke(IPC_CHANNELS.audioStart, sourceId),
  stopAudioCapture: () => ipcRenderer.invoke(IPC_CHANNELS.audioStop),
  onAudioFeatures: (listener) => {
    const relay = (_event: unknown, features: AudioFeatures): void => listener(features)
    ipcRenderer.on(IPC_CHANNELS.audioFeatures, relay)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.audioFeatures, relay)
  },
  minimizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowMinimize),
  closeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.windowClose),
}

contextBridge.exposeInMainWorld('nanoleaf', api)
