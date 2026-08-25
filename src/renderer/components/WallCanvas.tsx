import { useEffect, useRef } from 'react'
import { createWallRenderer, type WallRenderer } from '../gl/wall'
import { panelAt } from '../../shared/geometry'
import type { Color, PanelLayout } from '../../shared/types'

interface WallCanvasProps {
  layout: PanelLayout
  colors: Map<number, Color>
  onPaint: (panelId: number) => void
}

/**
 * Rend le mur et traduit un clic en panneau. Le renderer est recréé quand la
 * géométrie change, jamais quand les couleurs changent : redessiner ne coûte
 * qu'un uniforme.
 */
export function WallCanvas({ layout, colors, onPaint }: WallCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WallRenderer | null>(null)
  const colorsRef = useRef(colors)
  colorsRef.current = colors

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return

    let renderer: WallRenderer
    try {
      renderer = createWallRenderer(canvas, layout)
    } catch {
      return
    }
    rendererRef.current = renderer
    renderer.resize()
    renderer.draw(colorsRef.current)

    const observer = new ResizeObserver(() => {
      renderer.resize()
      renderer.draw(colorsRef.current)
    })
    observer.observe(canvas)

    return () => {
      observer.disconnect()
      renderer.dispose()
      rendererRef.current = null
    }
  }, [layout])

  useEffect(() => {
    rendererRef.current?.draw(colors)
  }, [colors])

  /**
   * Le canvas dessine le mur centré avec les mêmes marges que le shader :
   * l'inverse de cette mise à l'échelle ramène le clic en espace normalisé.
   */
  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const canvasAspect = bounds.width / bounds.height
    const [scaleX, scaleY] =
      canvasAspect > layout.aspect
        ? [layout.aspect / canvasAspect, 1]
        : [1, canvasAspect / layout.aspect]

    const panel = panelAt(layout, {
      x: ((event.clientX - bounds.left) / bounds.width - 0.5) / scaleX + 0.5,
      y: ((event.clientY - bounds.top) / bounds.height - 0.5) / scaleY + 0.5,
    })
    if (panel !== null) onPaint(panel.panelId)
  }

  return <canvas ref={canvasRef} className="mur" onClick={handleClick} />
}
