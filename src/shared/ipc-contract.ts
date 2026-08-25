import type { Color, DeviceState, EffectPalette, PanelLayout, SourceId } from './types'

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
  getEffects(deviceId: string): Promise<string[]>
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
  setColor(deviceId: string, hue: number, sat: number): Promise<void>
  /** Subscribes to device-reported changes. Returns the unsubscribe function. */
  onDeviceEvent(listener: (event: DeviceEventMessage) => void): () => void
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
  getEffects: 'effects:list',
  effectPalettes: 'effects:palettes',
  selectEffect: 'effects:select',
  startStream: 'stream:start',
  stopStream: 'stream:stop',
  frame: 'stream:frame',
  paintPanel: 'devices:paintPanel',
  setColor: 'devices:setColor',
  deviceEvent: 'devices:event',
  windowMinimize: 'window:minimize',
  windowClose: 'window:close',
} as const
