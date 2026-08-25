import type { Dictionary } from './fr'

/** English translations. Keys are defined by the French reference file. */
export const en: Dictionary = {
  'app.tab.control': 'Control',
  'app.tab.scenes': 'Scenes',
  'app.tab.sync': 'Sync',
  'app.window.minimise': 'Minimise',
  'app.window.close': 'Close',
  'app.language': 'Language',

  'bridge.missing.title': 'Éclat — IPC bridge missing',
  'bridge.missing.body':
    'This page is served by Vite, which only provides the interface. Talking to the panels goes through the Electron main process: the authentication token must never reach the browser.',

  'control.noDevice.title': 'No device known',
  'control.noDevice.body': 'Panels announce themselves over mDNS on the local network.',
  'control.discover': 'Discover',
  'control.rescan': 'Look for more panels',
  'control.newDevice':
    'Another wall was found on the network. Pick it above to pair it.',
  'control.found.title': '{name} found',
  'control.found.body':
    'Hold the power button on the panel for 5 to 7 seconds, until the LED blinks, then start pairing.',
  'control.pair': 'Pair',
  'control.panels': '{count} panels',
  'control.firmware': 'firmware {version}',
  'control.turnOn': 'Turn on',
  'control.turnOff': 'Turn off',
  'control.brightness': 'Brightness',
  'control.colour': 'Colour',
  'control.externalControl': 'Driven externally',
  'control.colour.underScene':
    'A scene is running: the device no longer reports a hue. Picking a colour will replace it.',
  'control.orientation': 'Wall orientation',
  'control.orientation.help':
    'The device does not report how the wall is mounted, and nothing says a wall has to hang square.',
  'control.motion.approximate':
    'The wall is animated from the scene\u2019s colours. The device does not publish its LED state: this is an approximation, not a mirror.',
  'control.paint.help': 'Click a panel on the wall to paint it with the chosen colour.',
  'control.wallUnavailable': 'Wall rendering unavailable',

  'scenes.empty': 'No scenes read yet.',
  'scenes.unpaired': 'Pair a device to see its scenes.',

  'sync.title': 'Screen sync',
  'sync.running': 'Running',
  'sync.stopped': 'Stopped',
  'sync.choose': 'Choose a source',
  'sync.choosing': 'Selecting…',
  'sync.stop': 'Stop',
  'sync.unpaired': 'Pair a device to sync the screen.',
  'sync.preview.empty': 'The preview will appear here once capture starts.',
  'sync.mode': 'Mapping mode',
  'sync.mode.spatial': 'Spatial',
  'sync.mode.dominant': 'Dominant',
  'sync.mode.palette': 'Palette',
  'sync.radius': 'Radius',
  'sync.saturation': 'Saturation',
  'sync.blackFloor': 'Black floor',
  'sync.attack': 'Attack',
  'sync.release': 'Release',
  'sync.hz': 'Frame rate',
  'sync.wayland.help':
    'On Wayland the GNOME picker chooses the window, so this application cannot show window thumbnails. The source must be picked again on every launch, as the portal does not hand its restore token to Electron. The stream itself stays open while the app runs, so stopping and restarting the sync asks nothing.',

  'error.deviceUnknown': 'Unknown device.',
  'error.deviceUnpaired': 'Device not paired: start pairing.',
  'error.unreachable': 'Device unreachable on the network.',
  'error.pairingCancelled': 'Pairing cancelled.',
  'error.pairingRefused':
    'The device refused pairing. Hold the power button for 5 to 7 seconds, then try again.',
  'error.processorMissing':
    'This build of Chromium cannot read the capture frame by frame: screen sync is unavailable.',
}
