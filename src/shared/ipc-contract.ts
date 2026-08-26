import type { Color, DeviceState, EffectPalette, PanelLayout, SourceId } from './types'
import type { AudioFeatures } from './audio/analyser'

/** One of the machine's audio outputs, as PipeWire sees it. */
export interface AudioSourceInfo {
  id: number
  name: string
  description: string
}

/** What a device reports of its own accord, unprompted. */
export interface DeviceEventMessage {
  deviceId: string
  kind: 'on' | 'brightness' | 'hue' | 'sat' | 'ct' | 'colourMode' | 'effect' | 'layout'
  value: string | number | boolean
}

/** The renderer's view of a device. Never carries the token. */
export interface RendererDevice {
  id: string
  name: string
  ip: string
  port: number
  model?: string
  firmware?: string
  paired: boolean
}

export interface NanoleafApi {
  discover(): Promise<RendererDevice[]>
  pair(deviceId: string): Promise<RendererDevice>
  listDevices(): Promise<RendererDevice[]>
  getState(deviceId: string): Promise<DeviceState>
  setOn(deviceId: string, on: boolean): Promise<void>
  setBrightness(deviceId: string, value: number): Promise<void>
  getLayout(deviceId: string): Promise<PanelLayout>
  getEffectPalettes(deviceId: string): Promise<EffectPalette[]>
  selectEffect(deviceId: string, name: string): Promise<void>
  startStream(deviceId: string, source: SourceId): Promise<void>
  stopStream(deviceId: string, source: SourceId): Promise<void>
  sendFrame(
    deviceId: string,
    source: SourceId,
    colors: Color[],
    transitionTime?: number,
  ): Promise<boolean>
  paintPanel(deviceId: string, panelId: number, color: Color): Promise<boolean>
  /** Recolours several panels in a single frame. */
  paintPanels(
    deviceId: string,
    entries: Array<{ panelId: number; color: Color }>,
  ): Promise<boolean>
  setColor(deviceId: string, hue: number, sat: number): Promise<void>
  /** Subscribes to device-reported changes. Returns the unsubscribe function. */
  onDeviceEvent(listener: (event: DeviceEventMessage) => void): () => void
  listAudioSources(): Promise<AudioSourceInfo[]>
  startAudioCapture(sourceId: number): Promise<void>
  stopAudioCapture(): Promise<void>
  /** Subscribes to the analysed audio features. Returns the unsubscribe function. */
  onAudioFeatures(listener: (features: AudioFeatures) => void): () => void
  minimizeWindow(): Promise<void>
  closeWindow(): Promise<void>
}

export const IPC_CHANNELS = {
  discover: 'devices:discover',
  pair: 'devices:pair',
  list: 'devices:list',
  getState: 'devices:getState',
  setOn: 'devices:setOn',
  setBrightness: 'devices:setBrightness',
  getLayout: 'devices:layout',
  effectPalettes: 'effects:palettes',
  selectEffect: 'effects:select',
  startStream: 'stream:start',
  stopStream: 'stream:stop',
  frame: 'stream:frame',
  paintPanel: 'devices:paintPanel',
  paintPanels: 'devices:paintPanels',
  setColor: 'devices:setColor',
  deviceEvent: 'devices:event',
  audioSources: 'audio:sources',
  audioStart: 'audio:start',
  audioStop: 'audio:stop',
  audioFeatures: 'audio:features',
  windowMinimize: 'window:minimize',
  windowClose: 'window:close',
} as const
