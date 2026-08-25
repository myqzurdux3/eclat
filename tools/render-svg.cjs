// Rend un SVG en PNG.
//
// Le poste n'a ni rsvg-convert, ni cairosvg, ni Inkscape ; Electron embarque
// un moteur de rendu parfaitement capable de le faire. Le dessin passe par un
// canvas en mémoire plutôt que par `capturePage` : une fenêtre masquée ou
// transparente n'est pas composée, et sa capture rendrait une image vide.
//
//   npx electron tools/render-svg.cjs assets/logo.svg assets/logo.png 512
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

const [entree, sortie, largeurBrute] = process.argv.slice(2)
const largeur = Number(largeurBrute ?? 512)

app.whenReady().then(async () => {
  const svg = readFileSync(resolve(entree), 'utf8')
  const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
  if (viewBox === null) {
    console.error('viewBox introuvable dans le SVG')
    app.exit(1)
    return
  }
  const hauteur = Math.round((largeur * Number(viewBox[2])) / Number(viewBox[1]))

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
        image.onerror = () => reject(new Error('SVG illisible'))
        image.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = ${largeur}
      canvas.height = ${hauteur}
      canvas.getContext('2d').drawImage(image, 0, 0, ${largeur}, ${hauteur})
      URL.revokeObjectURL(url)
      return canvas.toDataURL('image/png')
    })()
  `)

  writeFileSync(resolve(sortie), Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log(`${sortie} — ${largeur}×${hauteur}`)
  app.exit(0)
})
