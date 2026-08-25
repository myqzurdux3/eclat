import { useEffect, useRef, useState } from 'react'
import { createWallRenderer, type WallRenderer } from '../gl/wall'
import { panelAt } from '../../shared/geometry'
import { unproject } from '../../shared/view'
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
  const [panne, setPanne] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return

    let renderer: WallRenderer
    try {
      renderer = createWallRenderer(canvas, layout)
    } catch (cause) {
      // Contexte GPU indisponible ou shader refusé : le dire, plutôt que de
      // laisser une zone vide sans explication.
      setPanne(cause instanceof Error ? cause.message : String(cause))
      return
    }
    setPanne(null)
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

  /** Le cadrage du shader fait foi : on l'inverse pour situer le clic. */
  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    const renderer = rendererRef.current
    if (renderer === null) return

    const bounds = event.currentTarget.getBoundingClientRect()
    const point = unproject(
      renderer.transform(),
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
    )

    const panel = panelAt(layout, point)
    if (panel !== null) onPaint(panel.panelId)
  }

  if (panne !== null) {
    return (
      <div className="scene" style={{ display: 'grid', alignContent: 'center', padding: 24 }}>
        <strong>Rendu du mur indisponible</strong>
        <p className="aide">{panne}</p>
      </div>
    )
  }

  return (
    <div className="scene">
      <canvas ref={canvasRef} className="mur" onClick={handleClick} />
    </div>
  )
}
