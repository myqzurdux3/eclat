import { useEffect, useRef, useState } from 'react'
import { createWallRenderer, type WallRenderer } from '../gl/wall'
import { panelAt } from '../../shared/geometry'
import { unproject } from '../../shared/view'
import { sceneMotion } from '../../shared/scene-motion'
import type { Color, PanelLayout } from '../../shared/types'
import { useT } from '../i18n'

interface WallCanvasProps {
  layout: PanelLayout
  colors: Map<number, Color>
  /**
   * Palette à faire vivre sur le mur, quand une scène du device tourne.
   * `null` fige l'affichage sur `colors`.
   */
  motion: { palette: Color[]; brightness: number } | null
  onPaint: (panelId: number) => void
}

/**
 * Rend le mur et traduit un clic en panneau. Le renderer est recréé quand la
 * géométrie change, jamais quand les couleurs changent : redessiner ne coûte
 * qu'un uniforme.
 */
export function WallCanvas({ layout, colors, motion, onPaint }: WallCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WallRenderer | null>(null)
  const colorsRef = useRef(colors)
  colorsRef.current = colors
  const motionRef = useRef(motion)
  motionRef.current = motion
  const [panne, setPanne] = useState<string | null>(null)
  const t = useT()

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

  /**
   * L'animation vit ici, pas dans React : redessiner le mur ne coûte qu'un
   * uniforme, alors qu'un état React à 60 Hz repeindrait tout l'arbre.
   */
  useEffect(() => {
    if (motion === null) return

    let image = 0
    const debut = performance.now()

    const boucle = (maintenant: number): void => {
      const anime = motionRef.current
      const renderer = rendererRef.current
      if (anime !== null && renderer !== null) {
        const couleurs = sceneMotion(anime.palette, layout.panels.length, maintenant - debut)
        const facteur = Math.max(0, Math.min(100, anime.brightness)) / 100
        renderer.draw(
          new Map(
            layout.panels.map((panel, index) => {
              const couleur = couleurs[index] ?? { r: 0, g: 0, b: 0 }
              return [
                panel.panelId,
                {
                  r: Math.round(couleur.r * facteur),
                  g: Math.round(couleur.g * facteur),
                  b: Math.round(couleur.b * facteur),
                },
              ]
            }),
          ),
        )
      }
      image = requestAnimationFrame(boucle)
    }

    image = requestAnimationFrame(boucle)
    return () => {
      cancelAnimationFrame(image)
      rendererRef.current?.draw(colorsRef.current)
    }
    // `motion` n'est lu que par la référence : seule sa présence relance la
    // boucle, un changement de palette est pris au vol.
  }, [motion === null, layout])

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
        <strong>{t('control.wallUnavailable')}</strong>
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
