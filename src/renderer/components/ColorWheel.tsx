import { useEffect, useRef } from 'react'
import { hsbToRgb, hsvToWheel, wheelToHsv, type WheelPosition } from '../../shared/color'

interface ColorWheelProps {
  hue: number
  sat: number
  size: number
  onPick: (position: WheelPosition) => void
}

/**
 * Roue teinte/saturation dessinée une fois en 2D, puis seulement recouverte
 * d'un curseur : rien ne se redessine pendant qu'un sync tourne.
 */
export function ColorWheel({ hue, sat, size, onPick }: ColorWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const radius = size / 2

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return

    const image = context.createImageData(size, size)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const position = wheelToHsv(x - radius + 0.5, y - radius + 0.5, radius)
        const at = (y * size + x) * 4
        if (position === null) {
          image.data[at + 3] = 0
          continue
        }
        const { r, g, b } = hsbToRgb(position.hue, position.sat, 100)
        image.data[at] = r
        image.data[at + 1] = g
        image.data[at + 2] = b
        // Bord adouci sur le dernier pixel, sinon le disque crénèle.
        const bordure = radius - Math.hypot(x - radius + 0.5, y - radius + 0.5)
        image.data[at + 3] = Math.round(255 * Math.min(1, Math.max(0, bordure)))
      }
    }
    context.putImageData(image, 0, 0)
  }, [size, radius])

  /**
   * Le pointeur est capturé au premier appui : le glissement continue même
   * si le curseur sort du disque, comme sur tout sélecteur de couleur.
   */
  const pick = (event: React.PointerEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const dx = event.clientX - bounds.left - radius
    const dy = event.clientY - bounds.top - radius
    const distance = Math.hypot(dx, dy)
    // Hors du disque, on projette sur le bord plutôt que d'ignorer le geste.
    const facteur = distance > radius ? radius / distance : 1
    const position = wheelToHsv(dx * facteur, dy * facteur, radius)
    if (position !== null) onPick(position)
  }

  const cursor = hsvToWheel(hue, sat, radius)

  return (
    <div
      className="roue"
      style={{ width: size, height: size }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        pick(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event)
      }}
      onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
    >
      <canvas ref={canvasRef} width={size} height={size} />
      <div
        className="curseur-roue"
        style={{
          transform: `translate(${radius + cursor.dx}px, ${radius + cursor.dy}px)`,
          background: `rgb(${hsbToRgb(hue, sat, 100).r}, ${hsbToRgb(hue, sat, 100).g}, ${hsbToRgb(hue, sat, 100).b})`,
        }}
      />
    </div>
  )
}
