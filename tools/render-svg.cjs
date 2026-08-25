// Renders an SVG to a PNG.
//
// This machine has neither rsvg-convert, nor cairosvg, nor Inkscape; Electron
// ships a rendering engine perfectly able to do it. The drawing goes through
// an in-memory canvas rather than `capturePage`: a hidden or transparent
// window is not composited, and capturing it would yield an empty image.
//
//   npx electron tools/render-svg.cjs assets/logo.svg assets/logo.png 512
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

const [input, output, rawWidth] = process.argv.slice(2)
const width = Number(rawWidth ?? 512)

app.whenReady().then(async () => {
  const svg = readFileSync(resolve(input), 'utf8')
  const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
  if (viewBox === null) {
    console.error('viewBox not found in the SVG')
    app.exit(1)
    return
  }
  const height = Math.round((width * Number(viewBox[2])) / Number(viewBox[1]))

  const window = new BrowserWindow({ show: false, width: 200, height: 200 })
  await window.loadURL('data:text/html,<meta charset="utf-8">')

  const dataUrl = await window.webContents.executeJavaScript(`
    (async () => {
      const source = ${JSON.stringify(svg)}
      const blob = new Blob([source], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const image = new Image()
      await new Promise((resolve, reject) => {
        image.onload = resolve
        image.onerror = () => reject(new Error('Unreadable SVG'))
        image.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = ${width}
      canvas.height = ${height}
      canvas.getContext('2d').drawImage(image, 0, 0, ${width}, ${height})
      URL.revokeObjectURL(url)
      return canvas.toDataURL('image/png')
    })()
  `)

  writeFileSync(resolve(output), Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log(`${output} — ${width}x${height}`)
  app.exit(0)
})
