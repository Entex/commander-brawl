import { squareToQuad, type Quad } from '@commander-brawl/application';

// Chromium's "breakout box": the frames of a video track as they come, and a track made from frames. Not in
// TypeScript's DOM types (other browsers don't have them yet), so declared here as far as they're used.
interface TrackProcessor {
  readonly readable: ReadableStream<VideoFrame>;
}
interface TrackGenerator extends MediaStreamTrack {
  readonly writable: WritableStream<VideoFrame>;
}
declare const MediaStreamTrackProcessor: new (init: { track: MediaStreamTrack }) => TrackProcessor;
declare const MediaStreamTrackGenerator: new (init: { kind: 'video' }) => TrackGenerator;

/** The size of the picture to make from a camera picture of the given size. */
export type OutputSize = (width: number, height: number) => { readonly width: number; readonly height: number };

/** Worked out once: making a WebGL context to find out isn't free. */
let supportedHere: boolean | undefined;

const VERTEX_SHADER = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
  // The picture's top left is (0, 0), as in the camera picture.
  uv = vec2((position.x + 1.0) / 2.0, (1.0 - position.y) / 2.0);
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D camera;
// From a point of the straight picture to where it is in the camera picture.
uniform mat3 warp;
in vec2 uv;
out vec4 color;
void main() {
  vec3 p = warp * vec3(uv, 1.0);
  vec2 at = p.xy / p.z;
  if (at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0) {
    color = vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    color = texture(camera, at);
  }
}`;

/**
 * Turns a camera that looks at the playmat at an angle into a straight, top-down view: each frame, the four
 * corners of the playmat are stretched back into a rectangle (on the graphics card). `track` is the result,
 * for the other players. Works frame by frame as the camera delivers them, so it keeps going when the window
 * is in the background. The result's size is worked out from each frame's, so it follows the camera when its
 * resolution changes, or only becomes known once its video arrives (a phone's).
 */
export class Straightener {
  readonly track: MediaStreamTrack;
  private readonly canvas: OffscreenCanvas;
  private readonly gl: WebGL2RenderingContext;
  private readonly warpLocation: WebGLUniformLocation;
  private stopped = false;

  /** Whether this computer can straighten a camera: the browser has what it takes, and WebGL 2 works. */
  static supported(): boolean {
    supportedHere ??=
      'MediaStreamTrackProcessor' in globalThis &&
      'MediaStreamTrackGenerator' in globalThis &&
      'OffscreenCanvas' in globalThis &&
      new OffscreenCanvas(1, 1).getContext('webgl2') !== null;
    return supportedHere;
  }

  /** `corners` are the playmat's corners in the camera picture, as fractions of its width and height. */
  constructor(
    private readonly source: MediaStreamTrack,
    corners: Quad,
    private readonly sizeFor: OutputSize,
  ) {
    // Until the first frame says otherwise.
    const { width = 1280, height = 720 } = source.getSettings();
    const size = sizeFor(width, height);
    this.canvas = new OffscreenCanvas(size.width, size.height);
    const gl = this.canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('This computer can’t straighten the camera (no WebGL 2).');
    this.gl = gl;
    const program = link(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    gl.useProgram(program);
    // Two triangles covering the whole picture.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.viewport(0, 0, size.width, size.height);
    this.warpLocation = gl.getUniformLocation(program, 'warp')!;
    this.setCorners(corners);

    const generator = new MediaStreamTrackGenerator({ kind: 'video' });
    // Card text matters more than smooth motion, as for the camera itself.
    generator.contentHint = 'detail';
    this.track = generator;
    void this.run(new MediaStreamTrackProcessor({ track: source }).readable, generator.writable);
  }

  /** The straight picture's size, as of the latest frame. */
  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  setCorners(corners: Quad): void {
    // Row by row, which WebGL takes with "transpose".
    this.gl.uniformMatrix3fv(this.warpLocation, true, new Float32Array(squareToQuad(corners)));
  }

  stop(): void {
    this.stopped = true;
    this.track.stop();
  }

  /** Makes the straight picture the size for a camera picture of this size, if it isn't already. */
  private fit(width: number, height: number): void {
    const size = this.sizeFor(width, height);
    if (size.width === this.canvas.width && size.height === this.canvas.height) return;
    this.canvas.width = size.width;
    this.canvas.height = size.height;
    this.gl.viewport(0, 0, size.width, size.height);
  }

  private async run(frames: ReadableStream<VideoFrame>, out: WritableStream<VideoFrame>): Promise<void> {
    const reader = frames.getReader();
    const writer = out.getWriter();
    try {
      while (!this.stopped) {
        const { value: frame, done } = await reader.read();
        if (done) break;
        const { timestamp } = frame;
        try {
          this.fit(frame.displayWidth, frame.displayHeight);
          this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, frame);
        } finally {
          frame.close();
        }
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
        const straight = new VideoFrame(this.canvas, { timestamp });
        try {
          await writer.write(straight);
        } catch {
          straight.close();
          break;
        }
      }
    } catch (error) {
      if (!this.stopped) console.warn('[camera] straightening stopped', error);
    } finally {
      reader.releaseLock();
      void reader.cancel().catch(() => undefined);
      void writer.close().catch(() => undefined);
    }
    // The camera itself ended (unplugged, phone gone): so does the straight picture.
    if (this.source.readyState === 'ended') this.track.stop();
  }
}

function link(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertexSource],
    [gl.FRAGMENT_SHADER, fragmentSource],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program');
  return program;
}
