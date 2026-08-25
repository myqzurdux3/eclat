// Lists the audio inputs Chromium can see, and checks whether a PipeWire
// monitor source can actually be opened.
//
// The spec assumes `enumerateDevices()` exposes "Monitor of ..." sources
// through pipewire-pulse. Worth verifying before building on it.
//
//   npx electron tools/probe-audio-sources.cjs
const { app, BrowserWindow, session } = require('electron')
const { join } = require('node:path')

app.whenReady().then(async () => {
  // Grant microphone permission up front: enumerateDevices only reveals
  // labels once a capture permission has been given.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler(() => true)

  const window = new BrowserWindow({ show: false, width: 400, height: 300 })
  // `data:` URLs are not a secure context, so `navigator.mediaDevices`
  // is undefined there. `file://` is potentially trustworthy.
  await window.loadFile(join(__dirname, '../dist/renderer/index.html'))

  const report = await window.webContents.executeJavaScript(`
    (async () => {
      let granted = false
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
        probe.getTracks().forEach((t) => t.stop())
        granted = true
      } catch (cause) {
        return { granted: false, reason: String(cause) }
      }

      const devices = await navigator.mediaDevices.enumerateDevices()
      const inputs = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({ id: d.deviceId, label: d.label }))

      const monitor = inputs.find((d) => /monitor/i.test(d.label))
      let opened = null
      if (monitor !== undefined) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: monitor.id } },
          })
          const context = new AudioContext()
          const analyser = context.createAnalyser()
          analyser.fftSize = 1024
          context.createMediaStreamSource(stream).connect(analyser)
          await new Promise((r) => setTimeout(r, 900))
          const bins = new Uint8Array(analyser.frequencyBinCount)
          analyser.getByteFrequencyData(bins)
          const energy = bins.reduce((a, b) => a + b, 0)
          opened = { sampleRate: context.sampleRate, bins: bins.length, energy }
          stream.getTracks().forEach((t) => t.stop())
          await context.close()
        } catch (cause) {
          opened = { error: String(cause) }
        }
      }

      return { granted, inputs, monitor: monitor ?? null, opened }
    })()
  `)

  console.log(JSON.stringify(report, null, 2))
  app.exit(0)
})
