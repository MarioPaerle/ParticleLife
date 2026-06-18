import { mulberry32 } from "./rules.js";

const MAX_TYPES = 50;

// GpuParticleLife uses the classic "ping-pong texture" pattern:
// 1. Particle state is stored in floating point textures, not JavaScript arrays.
// 2. A fullscreen shader computes the next state for every particle in parallel.
// 3. A point-rendering shader samples the newest position texture and draws glow.
export class GpuParticleLife {
  constructor(canvas, asciiCanvas) {
    this.canvas = canvas;
    this.asciiCanvas = asciiCanvas;
    this.ascii = asciiCanvas.getContext("2d", { alpha: false });
    this.gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });

    this.ok = Boolean(this.gl);
    if (!this.ok) return;

    const gl = this.gl;
    this.ok = Boolean(gl.getExtension("EXT_color_buffer_float"));
    if (!this.ok) return;

    this.particleCount = 0;
    this.typeCount = 0;
    this.texSize = 0;
    this.flip = 0;
    this.frame = 0;
    this.ruleTex = null;
    this.colorTex = null;

    this.quad = makeBuffer(gl, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
    this.updateProgram = makeProgram(gl, updateVertexShader, updateFragmentShader);
    this.renderProgram = makeProgram(gl, renderVertexShader, renderFragmentShader);

    this.updateLoc = locations(gl, this.updateProgram, [
      "uPosTex", "uVelTex", "uRuleTex", "uTexSize", "uParticleCount", "uTypeCount", "uDt", "uSpeed",
      "uRadius", "uNoise", "uFriction", "uFrame", "uWorldSize",
    ]);
    this.renderLoc = locations(gl, this.renderProgram, [
      "uPosTex", "uColorTex", "uTexSize", "uParticleCount", "uTypeCount", "uCanvasSize", "uPointSize",
      "uGlow", "uThemeMode", "uWorldSize", "uCamera", "uZoom",
    ]);

    this.resize();
  }

  configure(state) {
    if (!this.ok) return;
    this.state = state;
    this.typeCount = state.typeCount;
    this.uploadRuleTexture(state.matrix);
    this.uploadColorTexture(state.palette);
  }

  randomizeParticles(count, typeCount, seed, worldSize = 1) {
    const gl = this.gl;
    this.particleCount = count;
    this.typeCount = typeCount;
    this.texSize = Math.ceil(Math.sqrt(count));
    this.flip = 0;

    const total = this.texSize * this.texSize;
    const random = mulberry32(seed);
    const pos = new Float32Array(total * 4);
    const vel = new Float32Array(total * 4);

    for (let index = 0; index < total; index += 1) {
      const offset = index * 4;
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * worldSize * 0.42;
      pos[offset + 0] = worldSize * 0.5 + Math.cos(angle) * radius;
      pos[offset + 1] = worldSize * 0.5 + Math.sin(angle) * radius;
      pos[offset + 2] = index < count ? Math.floor(random() * typeCount) : 0;
      pos[offset + 3] = index < count ? 1 : 0;
      vel[offset + 0] = (random() - 0.5) * 0.01 * worldSize;
      vel[offset + 1] = (random() - 0.5) * 0.01 * worldSize;
    }

    this.posTex = [texture(gl, this.texSize, pos), texture(gl, this.texSize, pos)];
    this.velTex = [texture(gl, this.texSize, vel), texture(gl, this.texSize, vel)];
    this.fbo = [framebuffer(gl, this.posTex[0], this.velTex[0]), framebuffer(gl, this.posTex[1], this.velTex[1])];
    this.indexBuffer = makeIndexBuffer(gl, total);
  }

  uploadRuleTexture(matrix) {
    const gl = this.gl;
    const data = flattenRules(matrix);
    this.ruleTex = dataTexture(gl, MAX_TYPES, MAX_TYPES, data);
  }

  uploadColorTexture(colors) {
    const gl = this.gl;
    const data = flattenColors(colors);
    this.colorTex = dataTexture(gl, MAX_TYPES, 1, data);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.asciiCanvas.width = Math.max(240, Math.floor(rect.width * 0.65));
      this.asciiCanvas.height = Math.max(180, Math.floor(rect.height * 0.65));
    }
  }

  step(dt, state) {
    const gl = this.gl;
    const src = this.flip;
    const dst = 1 - this.flip;
    this.frame += 1;

    gl.useProgram(this.updateProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[dst]);
    gl.viewport(0, 0, this.texSize, this.texSize);

    bindTexture(gl, 0, this.posTex[src], this.updateLoc.uPosTex);
    bindTexture(gl, 1, this.velTex[src], this.updateLoc.uVelTex);
    bindTexture(gl, 2, this.ruleTex, this.updateLoc.uRuleTex);
    gl.uniform1f(this.updateLoc.uTexSize, this.texSize);
    gl.uniform1i(this.updateLoc.uParticleCount, this.particleCount);
    gl.uniform1i(this.updateLoc.uTypeCount, state.typeCount);
    gl.uniform1f(this.updateLoc.uDt, dt);
    gl.uniform1f(this.updateLoc.uSpeed, state.speed);
    gl.uniform1f(this.updateLoc.uRadius, state.radius);
    gl.uniform1f(this.updateLoc.uNoise, state.noise);
    gl.uniform1f(this.updateLoc.uFriction, state.friction);
    gl.uniform1f(this.updateLoc.uFrame, this.frame);
    gl.uniform1f(this.updateLoc.uWorldSize, state.worldSize);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = gl.getAttribLocation(this.updateProgram, "aPosition");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    this.flip = dst;
  }

  draw(state) {
    this.resize();
    if (state.theme === "ascii") {
      this.drawAscii(state);
      return;
    }

    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.015, 0.017, 0.024, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    gl.useProgram(this.renderProgram);
    bindTexture(gl, 0, this.posTex[this.flip], this.renderLoc.uPosTex);
    bindTexture(gl, 1, this.colorTex, this.renderLoc.uColorTex);
    gl.uniform1f(this.renderLoc.uTexSize, this.texSize);
    gl.uniform1i(this.renderLoc.uParticleCount, this.particleCount);
    gl.uniform1i(this.renderLoc.uTypeCount, state.typeCount);
    gl.uniform2f(this.renderLoc.uCanvasSize, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.renderLoc.uPointSize, state.size * (window.devicePixelRatio || 1));
    gl.uniform1f(this.renderLoc.uGlow, state.glow);
    gl.uniform1i(this.renderLoc.uThemeMode, state.theme === "pixel" ? 1 : 0);
    gl.uniform1f(this.renderLoc.uWorldSize, state.worldSize);
    gl.uniform2f(this.renderLoc.uCamera, state.camera.x, state.camera.y);
    gl.uniform1f(this.renderLoc.uZoom, state.camera.zoom);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuffer);
    const loc = gl.getAttribLocation(this.renderProgram, "aIndex");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 1, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, this.particleCount);
    gl.disable(gl.BLEND);
  }

  drawAscii(state) {
    // ASCII mode keeps simulation on the GPU, then samples a compact position
    // buffer for terminal-style drawing. It is intentionally lower resolution.
    const gl = this.gl;
    const w = this.asciiCanvas.width;
    const h = this.asciiCanvas.height;
    const pixels = new Float32Array(this.texSize * this.texSize * 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[this.flip]);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, this.texSize, this.texSize, gl.RGBA, gl.FLOAT, pixels);

    const ctx = this.ascii;
    ctx.fillStyle = "#050805";
    ctx.fillRect(0, 0, w, h);
    ctx.font = "11px SFMono-Regular, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowBlur = Math.round(7 * state.glow);
    ctx.shadowColor = "#b7ff6a";

    const glyphs = ["*", "+", "x", "o", "#", "%", "@", ":", ";", "="];
    for (let i = 0; i < this.particleCount; i += 2) {
      const off = i * 4;
      const type = pixels[off + 2] | 0;
      const color = state.palette[type % state.palette.length];
      const screen = worldToAscii(pixels[off], pixels[off + 1], state, w, h);
      if (screen.x < -12 || screen.x > w + 12 || screen.y < -12 || screen.y > h + 12) continue;
      ctx.fillStyle = `rgb(${color.map((v) => Math.floor(v * 255)).join(",")})`;
      ctx.fillText(glyphs[type % glyphs.length], screen.x, screen.y);
    }
  }
}

const updateVertexShader = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const updateFragmentShader = `#version 300 es
precision highp float;
layout(location = 0) out vec4 outPos;
layout(location = 1) out vec4 outVel;

uniform sampler2D uPosTex;
uniform sampler2D uVelTex;
uniform sampler2D uRuleTex;
uniform float uTexSize;
uniform int uParticleCount;
uniform int uTypeCount;
uniform float uDt;
uniform float uSpeed;
uniform float uRadius;
uniform float uNoise;
uniform float uFriction;
uniform float uFrame;
uniform float uWorldSize;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 texCoordForIndex(int index) {
  float x = mod(float(index), uTexSize);
  float y = floor(float(index) / uTexSize);
  return (vec2(x, y) + 0.5) / uTexSize;
}

float forceCurve(float d, float radius, float rule) {
  float q = d / radius;
  float softRepel = smoothstep(0.0, 0.18, q) - 1.0;
  float social = (1.0 - abs(2.0 * q - 1.0)) * rule;
  return mix(softRepel * 0.9, social, smoothstep(0.10, 0.24, q));
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  int selfIndex = pixel.y * int(uTexSize) + pixel.x;
  vec2 uv = (vec2(pixel) + 0.5) / uTexSize;
  vec4 self = texture(uPosTex, uv);
  vec2 vel = texture(uVelTex, uv).xy;

  if (selfIndex >= uParticleCount || self.w < 0.5) {
    outPos = self;
    outVel = vec4(0.0);
    return;
  }

  vec2 acc = vec2(0.0);
  int selfType = int(self.z + 0.5);

  for (int otherIndex = 0; otherIndex < 8192; otherIndex += 1) {
    if (otherIndex >= uParticleCount) break;
    if (otherIndex == selfIndex) continue;

    vec4 other = texture(uPosTex, texCoordForIndex(otherIndex));
    vec2 delta = other.xy - self.xy;
    delta -= round(delta / uWorldSize) * uWorldSize;
    float dist = length(delta) + 0.0006;

    if (dist < uRadius) {
      int otherType = int(other.z + 0.5);
      float rule = texelFetch(uRuleTex, ivec2(otherType, selfType), 0).r;
      acc += normalize(delta) * forceCurve(dist, uRadius, rule);
    }
  }

  vec2 jitter = vec2(
    hash(self.xy * 19.31 + uFrame),
    hash(self.yx * 23.77 - uFrame)
  ) - 0.5;

  vel = (vel + acc * uDt * uSpeed * 0.075 + jitter * uNoise * uDt * 0.08) * uFriction;
  vel = clamp(vel, vec2(-0.018 * uWorldSize), vec2(0.018 * uWorldSize));
  self.xy = mod(self.xy + vel * uSpeed + uWorldSize, uWorldSize);

  outPos = self;
  outVel = vec4(vel, 0.0, 1.0);
}`;

const renderVertexShader = `#version 300 es
precision highp float;
in float aIndex;
uniform sampler2D uPosTex;
uniform sampler2D uColorTex;
uniform float uTexSize;
uniform int uParticleCount;
uniform int uTypeCount;
uniform vec2 uCanvasSize;
uniform float uPointSize;
uniform float uWorldSize;
uniform vec2 uCamera;
uniform float uZoom;
out vec3 vColor;
out float vType;

vec2 texCoordForIndex(float index) {
  float x = mod(index, uTexSize);
  float y = floor(index / uTexSize);
  return (vec2(x, y) + 0.5) / uTexSize;
}

void main() {
  vec4 particle = texture(uPosTex, texCoordForIndex(aIndex));
  int typeIndex = int(particle.z + 0.5);
  vec2 centered = particle.xy - uCamera;
  centered -= round(centered / uWorldSize) * uWorldSize;
  float aspect = uCanvasSize.x / max(1.0, uCanvasSize.y);
  float viewHeight = uWorldSize / max(0.001, uZoom);
  vec2 clip = vec2(centered.x / (viewHeight * aspect * 0.5), centered.y / (viewHeight * 0.5));
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = uPointSize * (1.0 + mod(float(typeIndex), 3.0) * 0.12);
  vColor = texelFetch(uColorTex, ivec2(typeIndex, 0), 0).rgb;
  vType = float(typeIndex);
}`;

const renderFragmentShader = `#version 300 es
precision highp float;
in vec3 vColor;
in float vType;
out vec4 outColor;
uniform float uGlow;
uniform int uThemeMode;

void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  float core;
  float halo;

  if (uThemeMode == 1) {
    vec2 block = abs(p);
    core = step(max(block.x, block.y), 0.22);
    halo = step(max(block.x, block.y), 0.48) * 0.22;
  } else {
    core = smoothstep(0.22, 0.02, d);
    halo = smoothstep(0.50, 0.08, d) * 0.32 * uGlow;
  }

  float alpha = core + halo;
  if (alpha < 0.01) discard;
  vec3 color = vColor * (0.55 + core * 1.8 + halo * uGlow);
  outColor = vec4(color, alpha);
}`;

function makeProgram(gl, vertexSource, fragmentSource) {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  return program;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function locations(gl, program, names) {
  return Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));
}

function makeBuffer(gl, data) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}

function makeIndexBuffer(gl, total) {
  const data = new Float32Array(total);
  for (let i = 0; i < total; i += 1) data[i] = i;
  return makeBuffer(gl, data);
}

function texture(gl, size, data) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size, size, 0, gl.RGBA, gl.FLOAT, data);
  return tex;
}

function dataTexture(gl, width, height, data) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);
  return tex;
}

function framebuffer(gl, posTex, velTex) {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, posTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, velTex, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("Floating point framebuffer is not complete.");
  }
  return fbo;
}

function bindTexture(gl, unit, tex, uniform) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(uniform, unit);
}

function flattenRules(matrix) {
  const data = new Float32Array(MAX_TYPES * MAX_TYPES * 4);
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix[row].length; col += 1) {
      data[(row * MAX_TYPES + col) * 4] = matrix[row][col];
    }
  }
  return data;
}

function flattenColors(colors) {
  const data = new Float32Array(MAX_TYPES * 4);
  colors.forEach((color, index) => {
    data[index * 4 + 0] = color[0];
    data[index * 4 + 1] = color[1];
    data[index * 4 + 2] = color[2];
    data[index * 4 + 3] = 1;
  });
  return data;
}

function worldToAscii(x, y, state, width, height) {
  let dx = x - state.camera.x;
  let dy = y - state.camera.y;
  dx -= Math.round(dx / state.worldSize) * state.worldSize;
  dy -= Math.round(dy / state.worldSize) * state.worldSize;
  const viewHeight = state.worldSize / state.camera.zoom;
  const viewWidth = viewHeight * (width / Math.max(1, height));
  return {
    x: (dx / viewWidth + 0.5) * width,
    y: (0.5 - dy / viewHeight) * height,
  };
}
