import {
  buildHaloMesh,
  buildOutlineMesh,
  buildPanelMesh,
  MAX_PANELS,
  type WallMesh,
} from './mesh'
import { fitTransform, wallBounds, type ViewTransform } from '../../shared/view'
import type { Color, PanelLayout } from '../../shared/types'

export interface WallRenderer {
  draw(colors: Map<number, Color>): void
  /**
   * Points the renderer at a new geometry.
   *
   * Only the buffers depend on it. Rebuilding the whole renderer for a
   * rotation step meant recompiling six shaders and relinking three programs
   * per pointer event, all of them identical to the ones just thrown away.
   */
  setLayout(layout: PanelLayout): void
  resize(): void
  dispose(): void
  /** The current framing, used to find the panel under a click. */
  transform(): ViewTransform
}

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
in float aPanelIndex;
in vec2 aOffset;
uniform vec2 uScale;
uniform vec2 uCentre;
uniform vec3 uColors[${MAX_PANELS}];
out vec3 vColor;
out vec2 vOffset;

void main() {
  vColor = uColors[int(aPanelIndex)];
  vOffset = aOffset;
  // Wall space into clip space: centre, scale, and flip the Y axis, which
  // points down on screen.
  vec2 placed = (aPosition - uCentre) * uScale;
  gl_Position = vec4(placed.x, -placed.y, 0.0, 1.0);
}`

const PANEL_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vColor;
in vec2 vOffset;
out vec4 outColor;

void main() {
  outColor = vec4(vColor, 1.0);
}`

const OUTLINE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vColor;
in vec2 vOffset;
out vec4 outColor;

void main() {
  // The outline never falls below a floor: a wall of unlit panels is drawn
  // in near-black over a near-black stage, and without this there is nothing
  // on screen to say where the panels are, let alone where to click.
  outColor = vec4(max(vColor, vec3(0.34)), 1.0);
}`

const HALO_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vColor;
in vec2 vOffset;
out vec4 outColor;

void main() {
  float dist = length(vOffset);
  // Soft falloff: opaque at the centre, zero at the quad's edge.
  float falloff = pow(max(0.0, 1.0 - dist), 3.0);
  outColor = vec4(vColor * falloff, falloff);
}`

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (shader === null) throw new Error('Shader allocation failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compilation: ${gl.getShaderInfoLog(shader) ?? 'unknown'}`)
  }
  return shader
}

function link(gl: WebGL2RenderingContext, fragmentSource: string): WebGLProgram {
  const program = gl.createProgram()
  if (program === null) throw new Error('Program allocation failed')
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)

  // Flagged as soon as they are linked: a shader lives until every program
  // holding it is gone, and without this it survives its program's deletion.
  // The wall is rebuilt on every rotation step, so they used to pile up.
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program linking: ${gl.getProgramInfoLog(program) ?? 'unknown'}`)
  }
  return program
}

function upload(gl: WebGL2RenderingContext, data: Float32Array): WebGLBuffer {
  const buffer = gl.createBuffer()
  if (buffer === null) throw new Error('Buffer allocation failed')
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
  return buffer
}

function bindAttribute(
  gl: WebGL2RenderingContext,
  location: number,
  buffer: WebGLBuffer,
  size: number,
): void {
  if (location < 0) return
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
}

interface Geometry {
  layout: PanelLayout
  bounds: ReturnType<typeof wallBounds>
  panel: WallMesh
  halo: WallMesh
  outline: WallMesh
  buffers: Record<string, WebGLBuffer>
}

/** Meshes and buffers for one wall geometry. Nothing here survives a rotation. */
function buildGeometry(gl: WebGL2RenderingContext, layout: PanelLayout): Geometry {
  const panel = buildPanelMesh(layout)
  const halo = buildHaloMesh(layout)
  const outline = buildOutlineMesh(layout)

  return {
    layout,
    bounds: wallBounds(layout),
    panel,
    halo,
    outline,
    buffers: {
      panelPosition: upload(gl, panel.positions),
      panelIndex: upload(gl, panel.panelIndices),
      panelOffset: upload(gl, new Float32Array(panel.vertexCount * 2)),
      haloPosition: upload(gl, halo.positions),
      haloIndex: upload(gl, halo.panelIndices),
      haloOffset: upload(gl, halo.offsets),
      outlinePosition: upload(gl, outline.positions),
      outlineIndex: upload(gl, outline.panelIndices),
      outlineOffset: upload(gl, new Float32Array(outline.vertexCount * 2)),
    },
  }
}

/**
 * Draws the wall: a diffuse halo per panel, the panel itself, then its
 * outline. Colours
 * travel through a uniform array indexed by panel, which avoids rebuilding
 * any buffer per frame — only the uniform changes, at 30 Hz.
 */
export function createWallRenderer(
  canvas: HTMLCanvasElement,
  layout: PanelLayout,
): WallRenderer {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true })
  if (gl === null) throw new Error('WebGL2 unavailable')

  const panelProgram = link(gl, PANEL_FRAGMENT_SHADER)
  const haloProgram = link(gl, HALO_FRAGMENT_SHADER)
  const outlineProgram = link(gl, OUTLINE_FRAGMENT_SHADER)

  /** Locations are fixed at link time: looking them up per frame is waste. */
  const locate = (program: WebGLProgram) => ({
    program,
    aPosition: gl.getAttribLocation(program, 'aPosition'),
    aPanelIndex: gl.getAttribLocation(program, 'aPanelIndex'),
    aOffset: gl.getAttribLocation(program, 'aOffset'),
    uScale: gl.getUniformLocation(program, 'uScale'),
    uCentre: gl.getUniformLocation(program, 'uCentre'),
    uColors: gl.getUniformLocation(program, 'uColors'),
  })

  const programs = {
    panel: locate(panelProgram),
    halo: locate(haloProgram),
    outline: locate(outlineProgram),
  }

  let geometry = buildGeometry(gl, layout)

  const flat = new Float32Array(MAX_PANELS * 3)

  const fillColors = (colors: Map<number, Color>): void => {
    geometry.layout.panels.forEach((panel, index) => {
      if (index >= MAX_PANELS) return
      const color = colors.get(panel.panelId) ?? { r: 0, g: 0, b: 0 }
      flat[index * 3] = color.r / 255
      flat[index * 3 + 1] = color.g / 255
      flat[index * 3 + 2] = color.b / 255
    })
  }

  /** The current framing: depends on canvas size, so it is recomputed. */
  const currentTransform = (): ViewTransform =>
    fitTransform(geometry.bounds, canvas.height === 0 ? 1 : canvas.width / canvas.height)

  const drawMesh = (
    located: ReturnType<typeof locate>,
    mesh: WallMesh,
    prefix: 'panel' | 'halo' | 'outline',
    mode: number = gl.TRIANGLES,
  ): void => {
    if (mesh.vertexCount === 0) return
    const view = currentTransform()
    gl.useProgram(located.program)
    bindAttribute(gl, located.aPosition, geometry.buffers[`${prefix}Position`]!, 2)
    bindAttribute(gl, located.aPanelIndex, geometry.buffers[`${prefix}Index`]!, 1)
    bindAttribute(gl, located.aOffset, geometry.buffers[`${prefix}Offset`]!, 2)
    gl.uniform2fv(located.uScale, view.scale)
    gl.uniform2fv(located.uCentre, view.centre)
    gl.uniform3fv(located.uColors, flat)
    gl.drawArrays(mode, 0, mesh.vertexCount)
  }

  const dropGeometry = (): void => {
    for (const buffer of Object.values(geometry.buffers)) gl.deleteBuffer(buffer)
  }

  return {
    draw(colors) {
      fillColors(colors)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
      drawMesh(programs.halo, geometry.halo, 'halo')
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      drawMesh(programs.panel, geometry.panel, 'panel')
      drawMesh(programs.outline, geometry.outline, 'outline', gl.LINES)
    },

    setLayout(next) {
      dropGeometry()
      geometry = buildGeometry(gl, next)
    },

    resize() {
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(canvas.clientWidth * ratio)
      canvas.height = Math.round(canvas.clientHeight * ratio)
    },

    transform: currentTransform,

    dispose() {
      dropGeometry()
      gl.deleteProgram(panelProgram)
      gl.deleteProgram(haloProgram)
      gl.deleteProgram(outlineProgram)
    },
  }
}
