import { useEffect, useRef, useState } from 'react'
import { createWallRenderer, type WallRenderer } from '../gl/wall'
import { panelAt } from '../../shared/geometry'
import { unproject } from '../../shared/view'
import { sceneMotion } from '../../shared/scene-motion'
import type { Color, PanelLayout } from '../../shared/types'
import { useT } from '../i18n'
import { reasonFor } from '../../shared/i18n/errors'

interface WallCanvasProps {
  layout: PanelLayout
  colors: Map<number, Color>
  /**
   * The palette to bring to life on the wall while a device scene runs.
   * `null` freezes the display on `colors`.
   */
  motion: { palette: Color[]; brightness: number } | null
  onPaint: (panelId: number) => void
}

/**
 * Draws the wall and turns a click into a panel. The renderer is rebuilt
 * when the geometry changes, never when the colours change: redrawing only
 * costs a uniform.
 */
export function WallCanvas({ layout, colors, motion, onPaint }: WallCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WallRenderer | null>(null)
  const colorsRef = useRef(colors)
  colorsRef.current = colors
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const motionRef = useRef(motion)
  motionRef.current = motion
  const [failure, setFailure] = useState<string | null>(null)
  const t = useT()

  // The renderer outlives a geometry change: only its buffers depend on the
  // layout, and rebuilding it per rotation step recompiled six shaders and
  // relinked three programs on every pointer event.
  useEffect(() => {
    const renderer = rendererRef.current
    if (renderer === null) return
    renderer.setLayout(layout)
    renderer.draw(colorsRef.current)
  }, [layout])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return

    let renderer: WallRenderer
    try {
      renderer = createWallRenderer(canvas, layoutRef.current)
    } catch (cause) {
      // GPU context unavailable or shader refused: say so, rather than
      // leaving an empty area with no explanation.
      setFailure(reasonFor(cause))
      return
    }
    setFailure(null)
    rendererRef.current = renderer
    renderer.resize()
    renderer.draw(colorsRef.current)

    const observer = new ResizeObserver(() => {
      renderer.resize()
      renderer.draw(colorsRef.current)
    })
    observer.observe(canvas)

    // A lost context leaves a blank wall for good unless we hear about it.
    const onLost = (event: Event): void => {
      event.preventDefault()
      rendererRef.current = null
      setFailure(t('control.wallUnavailable'))
    }
    canvas.addEventListener('webglcontextlost', onLost)

    return () => {
      canvas.removeEventListener('webglcontextlost', onLost)
      observer.disconnect()
      renderer.dispose()
      rendererRef.current = null
    }
  }, [t])

  useEffect(() => {
    rendererRef.current?.draw(colors)
  }, [colors])

  /**
   * The animation lives here, not in React: redrawing the wall only costs a
   * uniform, whereas React state at 60 Hz would repaint the whole tree.
   */
  useEffect(() => {
    if (motion === null) return

    let frame = 0
    const start = performance.now()

    const loop = (now: number): void => {
      const animation = motionRef.current
      const renderer = rendererRef.current
      if (animation !== null && renderer !== null) {
        const colours = sceneMotion(animation.palette, layout.panels.length, now - start)
        const factor = Math.max(0, Math.min(100, animation.brightness)) / 100
        renderer.draw(
          new Map(
            layout.panels.map((panel, index) => {
              const colour = colours[index] ?? { r: 0, g: 0, b: 0 }
              return [
                panel.panelId,
                {
                  r: Math.round(colour.r * factor),
                  g: Math.round(colour.g * factor),
                  b: Math.round(colour.b * factor),
                },
              ]
            }),
          ),
        )
      }
      frame = requestAnimationFrame(loop)
    }

    frame = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(frame)
      rendererRef.current?.draw(colorsRef.current)
    }
    // `motion` is only read through the ref: only its presence restarts the
    // loop, a palette change is picked up on the fly.
  }, [motion === null, layout])

  /** The shader's framing is authoritative: invert it to locate the click. */
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

  // The canvas stays mounted even when the context failed: unmounting it
  // took away the very element the next attempt needs, so a single failure —
  // a context lost after a burst of allocations, say — was final for the
  // life of the component.
  return (
    <div className="stage">
      <canvas
        ref={canvasRef}
        className="wall"
        onClick={handleClick}
        style={failure === null ? undefined : { visibility: 'hidden' }}
      />
      {failure !== null && (
        <div className="wall-failure">
          <strong>{t('control.wallUnavailable')}</strong>
          <p className="hint">{failure}</p>
        </div>
      )}
    </div>
  )
}
