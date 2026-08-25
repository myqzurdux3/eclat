import { buildHaloMesh, buildPanelMesh, MAX_PANELS, type WallMesh } from './mesh'
import type { Color, PanelLayout } from '../../shared/types'

export interface WallRenderer {
  draw(colors: Map<number, Color>): void
  resize(): void
  dispose(): void
}

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
in float aPanelIndex;
in vec2 aOffset;
uniform vec2 uScale;
uniform vec3 uColors[${MAX_PANELS}];
out vec3 vColor;
out vec2 vOffset;

void main() {
  vColor = uColors[int(aPanelIndex)];
  vOffset = aOffset;
  // [0,1] vers le repère de clip, en conservant le rapport d'aspect.
  vec2 centered = (aPosition - 0.5) * 2.0 * uScale;
  gl_Position = vec4(centered.x, -centered.y, 0.0, 1.0);
}`

const PANEL_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vColor;
in vec2 vOffset;
out vec4 outColor;

void main() {
  outColor = vec4(vColor, 1.0);
}`

const HALO_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vColor;
in vec2 vOffset;
out vec4 outColor;

void main() {
  float dist = length(vOffset);
  // Décroissance douce : opaque au centre, nulle au bord du quad.
  float falloff = pow(max(0.0, 1.0 - dist), 3.0);
  outColor = vec4(vColor * falloff, falloff);
}`

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (shader === null) throw new Error('Shader non alloué')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Compilation du shader : ${gl.getShaderInfoLog(shader) ?? 'inconnue'}`)
  }
  return shader
}

function link(gl: WebGL2RenderingContext, fragmentSource: string): WebGLProgram {
  const program = gl.createProgram()
  if (program === null) throw new Error('Programme non alloué')
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Édition de liens : ${gl.getProgramInfoLog(program) ?? 'inconnue'}`)
  }
  return program
}

function upload(gl: WebGL2RenderingContext, data: Float32Array): WebGLBuffer {
  const buffer = gl.createBuffer()
  if (buffer === null) throw new Error('Tampon non alloué')
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
  return buffer
}

function bindAttribute(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  buffer: WebGLBuffer,
  size: number,
): void {
  const location = gl.getAttribLocation(program, name)
  if (location < 0) return
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
}

/**
 * Dessine le mur : un halo diffus par panneau, puis le panneau lui-même.
 * Les couleurs passent par un tableau d'uniformes indexé par panneau, ce qui
 * évite de reconstruire le moindre tampon à chaque frame — seul l'uniforme
 * change, à 30 Hz.
 */
export function createWallRenderer(
  canvas: HTMLCanvasElement,
  layout: PanelLayout,
): WallRenderer {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true })
  if (gl === null) throw new Error('WebGL2 indisponible')

  const panelMesh = buildPanelMesh(layout)
  const haloMesh = buildHaloMesh(layout)

  const panelProgram = link(gl, PANEL_FRAGMENT_SHADER)
  const haloProgram = link(gl, HALO_FRAGMENT_SHADER)

  const zeros = new Float32Array(panelMesh.vertexCount * 2)
  const buffers = {
    panelPosition: upload(gl, panelMesh.positions),
    panelIndex: upload(gl, panelMesh.panelIndices),
    panelOffset: upload(gl, zeros),
    haloPosition: upload(gl, haloMesh.positions),
    haloIndex: upload(gl, haloMesh.panelIndices),
    haloOffset: upload(gl, haloMesh.offsets),
  }

  const flat = new Float32Array(MAX_PANELS * 3)

  const fillColors = (colors: Map<number, Color>): void => {
    layout.panels.forEach((panel, index) => {
      if (index >= MAX_PANELS) return
      const color = colors.get(panel.panelId) ?? { r: 0, g: 0, b: 0 }
      flat[index * 3] = color.r / 255
      flat[index * 3 + 1] = color.g / 255
      flat[index * 3 + 2] = color.b / 255
    })
  }

  /** Marges pour que le mur tienne dans le canvas quel que soit son ratio. */
  const scaleFor = (): [number, number] => {
    const canvasAspect = canvas.width / canvas.height
    return canvasAspect > layout.aspect
      ? [layout.aspect / canvasAspect, 1]
      : [1, canvasAspect / layout.aspect]
  }

  const drawMesh = (
    program: WebGLProgram,
    mesh: WallMesh,
    position: WebGLBuffer,
    index: WebGLBuffer,
    offset: WebGLBuffer,
  ): void => {
    if (mesh.vertexCount === 0) return
    gl.useProgram(program)
    bindAttribute(gl, program, 'aPosition', position, 2)
    bindAttribute(gl, program, 'aPanelIndex', index, 1)
    bindAttribute(gl, program, 'aOffset', offset, 2)
    gl.uniform2fv(gl.getUniformLocation(program, 'uScale'), scaleFor())
    gl.uniform3fv(gl.getUniformLocation(program, 'uColors'), flat)
    gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount)
  }

  return {
    draw(colors) {
      fillColors(colors)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
      drawMesh(haloProgram, haloMesh, buffers.haloPosition, buffers.haloIndex, buffers.haloOffset)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      drawMesh(
        panelProgram,
        panelMesh,
        buffers.panelPosition,
        buffers.panelIndex,
        buffers.panelOffset,
      )
    },

    resize() {
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(canvas.clientWidth * ratio)
      canvas.height = Math.round(canvas.clientHeight * ratio)
    },

    dispose() {
      for (const buffer of Object.values(buffers)) gl.deleteBuffer(buffer)
      gl.deleteProgram(panelProgram)
      gl.deleteProgram(haloProgram)
    },
  }
}
