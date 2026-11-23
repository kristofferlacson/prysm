/**
 * Draws an image stretched over a deformed triangle mesh. WebGL 2 does the resampling (bilinear
 * with mipmaps, so both stretched and compressed areas stay smooth); a Canvas 2D path covers
 * browsers where WebGL is unavailable.
 */

export interface Mesh {
  /** Vertex positions in output pixels: x0, y0, x1, y1, ... */
  positions: Float32Array;
  /** Matching texture coordinates in 0..1 of the source image. */
  uvs: Float32Array;
  /** Triangles as vertex indices. */
  indices: Uint16Array;
}

interface GlState {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  position: WebGLBuffer;
  uv: WebGLBuffer;
  index: WebGLBuffer;
  texture: WebGLTexture;
  size: WebGLUniformLocation | null;
  maxTexture: number;
}

const VERTEX = `#version 300 es
in vec2 aPosition;
in vec2 aUv;
uniform vec2 uSize;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPosition.x / uSize.x * 2.0 - 1.0, 1.0 - aPosition.y / uSize.y * 2.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D uImage;
in vec2 vUv;
out vec4 color;
void main() {
  color = texture(uImage, vUv);
}`;

let state: GlState | null | undefined;
let forced2d = false;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
  return shader;
}

function createState(): GlState | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.bindAttribLocation(program, 1, 'aUv');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
    gl.useProgram(program);

    const position = gl.createBuffer()!;
    const uv = gl.createBuffer()!;
    const index = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, position);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, uv);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);

    const texture = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) {
      const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }
    gl.uniform1i(gl.getUniformLocation(program, 'uImage'), 0);
    // Canvas pixels are premultiplied, and so is everything from here to the 2D canvas it ends up on.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    const created: GlState = {
      canvas,
      gl,
      position,
      uv,
      index,
      texture,
      size: gl.getUniformLocation(program, 'uSize'),
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    };
    // A lost context cannot be used again; the next draw builds a new one.
    canvas.addEventListener('webglcontextlost', () => {
      if (state === created) state = undefined;
    });
    return created;
  } catch {
    return null;
  }
}

function glState() {
  if (forced2d) return null;
  if (state === undefined) state = createState();
  if (state && state.gl.isContextLost()) state = createState();
  return state;
}

/** Which renderer warped text will use in this browser. */
export const meshBackend = (): 'webgl2' | 'canvas2d' => (glState() ? 'webgl2' : 'canvas2d');

/** Largest source image the renderer accepts on one side. */
export const maxSourceSize = () => Math.min(8192, glState()?.maxTexture ?? 4096);

/** Test hook: exercise the Canvas 2D path on a machine that has WebGL. */
export function forceCanvas2d(on: boolean) {
  forced2d = on;
}

function drawWebgl(s: GlState, source: HTMLCanvasElement, mesh: Mesh, width: number, height: number) {
  const { gl, canvas } = s;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindTexture(gl.TEXTURE_2D, s.texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.uniform2f(s.size, width, height);
  gl.bindBuffer(gl.ARRAY_BUFFER, s.position);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, s.uv);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.uvs, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, s.index);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.DYNAMIC_DRAW);
  gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
  return canvas;
}

/** Each triangle is drawn with the affine transform that carries its source corners to its output corners. */
function drawCanvas2d(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, mesh: Mesh) {
  const { positions: p, uvs, indices } = mesh;
  const sw = source.width;
  const sh = source.height;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    const x0 = p[a * 2], y0 = p[a * 2 + 1], x1 = p[b * 2], y1 = p[b * 2 + 1], x2 = p[c * 2], y2 = p[c * 2 + 1];
    const u0 = uvs[a * 2] * sw, v0 = uvs[a * 2 + 1] * sh, u1 = uvs[b * 2] * sw, v1 = uvs[b * 2 + 1] * sh, u2 = uvs[c * 2] * sw, v2 = uvs[c * 2 + 1] * sh;
    const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    if (Math.abs(det) < 1e-9) continue;
    const m11 = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det;
    const m12 = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det;
    const m21 = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / det;
    const m22 = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / det;
    // Grow the clip slightly so neighbouring triangles overlap instead of leaving hairline seams.
    const cx = (x0 + x1 + x2) / 3;
    const cy = (y0 + y1 + y2) / 3;
    const grow = (x: number, y: number): [number, number] => {
      const d = Math.hypot(x - cx, y - cy) || 1;
      return [x + ((x - cx) / d) * 0.7, y + ((y - cy) / d) * 0.7];
    };
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(...grow(x0, y0));
    ctx.lineTo(...grow(x1, y1));
    ctx.lineTo(...grow(x2, y2));
    ctx.closePath();
    ctx.clip();
    ctx.transform(m11, m12, m21, m22, x0 - m11 * u0 - m21 * v0, y0 - m12 * u0 - m22 * v0);
    ctx.drawImage(source, 0, 0);
    ctx.restore();
  }
}

/** Renders `source` over `mesh` into a new canvas of `width` x `height` pixels. */
export function renderMesh(source: HTMLCanvasElement, mesh: Mesh, width: number, height: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d')!;
  const s = glState();
  if (s) {
    try {
      ctx.drawImage(drawWebgl(s, source, mesh, width, height), 0, 0);
      return out;
    } catch {
      state = null;
      ctx.clearRect(0, 0, width, height);
    }
  }
  drawCanvas2d(ctx, source, mesh);
  return out;
}
