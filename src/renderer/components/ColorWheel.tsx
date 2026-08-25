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
        image.data[at + 3] = 255
      }
    }
    context.putImageData(image, 0, 0)
  }, [size, radius])

  const pick = (event: React.PointerEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const position = wheelToHsv(
      event.clientX - bounds.left - radius,
      event.clientY - bounds.top - radius,
      radius,
    )
    if (position !== null) onPick(position)
  }

  const cursor = hsvToWheel(hue, sat, radius)

  return (
    <div
      style={{ position: 'relative', width: size, height: size, touchAction: 'none' }}
      onPointerDown={pick}
      onPointerMove={(event) => {
        if (event.buttons === 1) pick(event)
      }}
    >
      <canvas ref={canvasRef} width={size} height={size} style={{ borderRadius: '50%' }} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 14,
          height: 14,
          marginLeft: -7,
          marginTop: -7,
          borderRadius: '50%',
          border: '2px solid #fff',
          boxShadow: '0 0 6px rgba(0,0,0,0.6)',
          pointerEvents: 'none',
          transform: `translate(${radius + cursor.dx}px, ${radius + cursor.dy}px)`,
        }}
      />
    </div>
  )
}
