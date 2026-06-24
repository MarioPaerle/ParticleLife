import { mulberry32 } from "./rules.js";

const MAX_TYPES = 75;
const MAX_INTERACTION_SAMPLES = 8192;
const MAX_LINE_SEGMENTS = 20000;

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
    this.lineVertexBuffer = null;
    this.lineVertexCapacity = 0;

    this.quad = makeBuffer(gl, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
    this.updateProgram = makeProgram(gl, updateVertexShader, updateFragmentShader);
    this.renderProgram = makeProgram(gl, renderVertexShader, renderFragmentShader);
    this.lineProgram = makeProgram(gl, lineVertexShader, lineFragmentShader);

    this.updateLoc = locations(gl, this.updateProgram, [
      "uPosTex", "uVelTex", "uRuleTex", "uTexSize", "uParticleCount", "uSampleCount", "uTypeCount", "uDt",
      "uRadius", "uNoise", "uBorderForce", "uFriction", "uFrame", "uWorldSize",
    ]);
    this.renderLoc = locations(gl, this.renderProgram, [
      "uPosTex", "uColorTex", "uTexSize", "uParticleCount", "uTypeCount", "uCanvasSize", "uPointSize",
      "uGlow", "uThemeMode", "uWorldSize", "uCamera", "uZoom", "uBorderForce",
    ]);
    this.lineLoc = locations(gl, this.lineProgram, [
      "uPosTex", "uColorTex", "uRuleTex", "uTexSize", "uParticleCount", "uCanvasSize", "uWorldSize",
      "uCamera", "uZoom", "uLineRadius", "uLineOpacity", "uLineWidth", "uLineMode", "uBorderForce", "uFrame",
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
    if (this.ruleTex) gl.deleteTexture(this.ruleTex);
    this.ruleTex = dataTexture(gl, MAX_TYPES, MAX_TYPES, data);
  }

  uploadColorTexture(colors) {
    const gl = this.gl;
    const data = flattenColors(colors);
    if (this.colorTex) gl.deleteTexture(this.colorTex);
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
    gl.uniform1i(this.updateLoc.uSampleCount, Math.min(this.particleCount, state.interactionSamples, MAX_INTERACTION_SAMPLES));
    gl.uniform1i(this.updateLoc.uTypeCount, state.typeCount);
    gl.uniform1f(this.updateLoc.uDt, dt);
    gl.uniform1f(this.updateLoc.uRadius, state.radius);
    gl.uniform1f(this.updateLoc.uNoise, state.noise);
    gl.uniform1f(this.updateLoc.uBorderForce, state.borderForce);
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
    gl.uniform1f(this.renderLoc.uBorderForce, state.borderForce);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuffer);
    const loc = gl.getAttribLocation(this.renderProgram, "aIndex");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 1, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, this.particleCount);

    if (state.lineEnabled && state.lineCount > 0) {
      this.drawLines(state);
    }

    gl.disable(gl.BLEND);
  }

  drawLines(state) {
    const gl = this.gl;
    const lineCount = Math.min(state.lineCount, MAX_LINE_SEGMENTS);
    if (lineCount <= 0 || this.particleCount <= 1) return;

    this.ensureLineBuffer(lineCount);
    gl.useProgram(this.lineProgram);
    bindTexture(gl, 0, this.posTex[this.flip], this.lineLoc.uPosTex);
    bindTexture(gl, 1, this.colorTex, this.lineLoc.uColorTex);
    bindTexture(gl, 2, this.ruleTex, this.lineLoc.uRuleTex);
    gl.uniform1f(this.lineLoc.uTexSize, this.texSize);
    gl.uniform1i(this.lineLoc.uParticleCount, this.particleCount);
    gl.uniform2f(this.lineLoc.uCanvasSize, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.lineLoc.uWorldSize, state.worldSize);
    gl.uniform2f(this.lineLoc.uCamera, state.camera.x, state.camera.y);
    gl.uniform1f(this.lineLoc.uZoom, state.camera.zoom);
    gl.uniform1f(this.lineLoc.uLineRadius, state.lineRadius);
    gl.uniform1f(this.lineLoc.uLineOpacity, state.lineOpacity);
    gl.uniform1f(this.lineLoc.uLineWidth, state.lineWidth);
    gl.uniform1i(this.lineLoc.uLineMode, state.lineMode);
    gl.uniform1f(this.lineLoc.uBorderForce, state.borderForce);
    gl.uniform1f(this.lineLoc.uFrame, this.frame);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVertexBuffer);
    const loc = gl.getAttribLocation(this.lineProgram, "aLineVertex");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 1, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, lineCount * 6);
  }

  ensureLineBuffer(lineCount) {
    if (this.lineVertexBuffer && this.lineVertexCapacity >= lineCount) return;
    const gl = this.gl;
    const capacity = Math.min(MAX_LINE_SEGMENTS, Math.max(lineCount, this.lineVertexCapacity * 2 || 1024));
    const data = new Float32Array(capacity * 6);
    for (let i = 0; i < data.length; i += 1) data[i] = i;
    this.lineVertexBuffer = makeBuffer(gl, data);
    this.lineVertexCapacity = capacity;
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
uniform int uSampleCount;
uniform int uTypeCount;
uniform float uDt;
uniform float uRadius;
uniform float uNoise;
uniform float uBorderForce;
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

  int frameOffset = int(mod(uFrame, float(max(1, uParticleCount))));
  int stride = max(1, uParticleCount / max(1, uSampleCount));

  for (int sampleIndex = 0; sampleIndex < 8192; sampleIndex += 1) {
    if (sampleIndex >= uSampleCount) break;
    int otherIndex = (selfIndex + frameOffset + sampleIndex * stride) % uParticleCount;
    if (otherIndex == selfIndex) continue;

    vec4 other = texture(uPosTex, texCoordForIndex(otherIndex));
    vec2 delta = other.xy - self.xy;
    if (uBorderForce <= 0.001) {
      delta -= round(delta / uWorldSize) * uWorldSize;
    }
    float dist = length(delta) + 0.0006;

    if (dist < uRadius) {
      int otherType = int(other.z + 0.5);
      float rule = texelFetch(uRuleTex, ivec2(otherType, selfType), 0).r;
      acc += normalize(delta) * forceCurve(dist, uRadius, rule);
    }
  }

  acc *= float(uParticleCount) / float(max(1, uSampleCount));

  if (uBorderForce > 0.001) {
    float wallBand = max(uRadius * 2.2, uWorldSize * 0.035);
    float left = 1.0 - smoothstep(0.0, wallBand, self.x);
    float right = smoothstep(uWorldSize - wallBand, uWorldSize, self.x);
    float bottom = 1.0 - smoothstep(0.0, wallBand, self.y);
    float top = smoothstep(uWorldSize - wallBand, uWorldSize, self.y);
    acc += vec2(left - right, bottom - top) * uBorderForce * 1.35;
  }

  vec2 jitter = vec2(
    hash(self.xy * 19.31 + uFrame),
    hash(self.yx * 23.77 - uFrame)
  ) - 0.5;

  vel = (vel + acc * uDt * 0.075 + jitter * uNoise * uDt * 0.08) * uFriction;
  vel = clamp(vel, vec2(-0.018 * uWorldSize), vec2(0.018 * uWorldSize));
  vec2 nextPos = self.xy + vel;
  if (uBorderForce > 0.001) {
    vec2 clamped = clamp(nextPos, vec2(0.0005), vec2(uWorldSize - 0.0005));
    vec2 hit = step(vec2(0.0001), abs(nextPos - clamped));
    vel = mix(vel, -vel * 0.28, hit);
    self.xy = clamped;
  } else {
    self.xy = mod(nextPos + uWorldSize, uWorldSize);
  }

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
uniform float uBorderForce;
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
  if (uBorderForce <= 0.001) {
    centered -= round(centered / uWorldSize) * uWorldSize;
  }
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

const lineVertexShader = `#version 300 es
precision highp float;
in float aLineVertex;
uniform sampler2D uPosTex;
uniform sampler2D uColorTex;
uniform sampler2D uRuleTex;
uniform float uTexSize;
uniform int uParticleCount;
uniform vec2 uCanvasSize;
uniform float uWorldSize;
uniform vec2 uCamera;
uniform float uZoom;
uniform float uLineRadius;
uniform float uLineOpacity;
uniform float uLineWidth;
uniform int uLineMode;
uniform float uBorderForce;
uniform float uFrame;
out vec4 vColor;

vec2 texCoordForIndex(int index) {
  float x = mod(float(index), uTexSize);
  float y = floor(float(index) / uTexSize);
  return (vec2(x, y) + 0.5) / uTexSize;
}

vec2 projectWorld(vec2 world) {
  vec2 centered = world - uCamera;
  if (uBorderForce <= 0.001) {
    centered -= round(centered / uWorldSize) * uWorldSize;
  }
  float aspect = uCanvasSize.x / max(1.0, uCanvasSize.y);
  float viewHeight = uWorldSize / max(0.001, uZoom);
  return vec2(centered.x / (viewHeight * aspect * 0.5), centered.y / (viewHeight * 0.5));
}

void main() {
  int count = max(1, uParticleCount);
  int lineIndex = int(floor(aLineVertex / 6.0));
  int corner = int(mod(aLineVertex, 6.0));

  int a = (lineIndex * 97 + int(uFrame) * 13) % count;
  vec4 pa = texture(uPosTex, texCoordForIndex(a));

  int b = (a + 1) % count;
  vec4 pb = texture(uPosTex, texCoordForIndex(b));
  vec2 bestDelta = pb.xy - pa.xy;
  if (uBorderForce <= 0.001) {
    bestDelta -= round(bestDelta / uWorldSize) * uWorldSize;
  }
  float bestDist = length(bestDelta);
  float targetDist = uLineRadius * 0.82;
  float bestScore = abs(bestDist - targetDist) + (bestDist > uLineRadius ? uLineRadius * 4.0 : 0.0);

  for (int candidate = 0; candidate < 64; candidate += 1) {
    int offset = 1 + ((lineIndex * 37 + candidate * 911 + int(uFrame) * 19) % count);
    int testIndex = (a + offset) % count;
    if (testIndex == a) continue;
    vec4 testParticle = texture(uPosTex, texCoordForIndex(testIndex));
    vec2 testDelta = testParticle.xy - pa.xy;
    if (uBorderForce <= 0.001) {
      testDelta -= round(testDelta / uWorldSize) * uWorldSize;
    }
    float testDist = length(testDelta);
    float testScore = abs(testDist - targetDist) + (testDist > uLineRadius ? uLineRadius * 4.0 : 0.0);
    if (testScore < bestScore) {
      bestScore = testScore;
      bestDist = testDist;
      bestDelta = testDelta;
      b = testIndex;
      pb = testParticle;
    }
  }

  vec2 delta = bestDelta;
  float dist = bestDist;
  float q = dist / max(0.0001, uLineRadius);
  float strength = smoothstep(1.0, 0.0, q);

  int typeA = int(pa.z + 0.5);
  int typeB = int(pb.z + 0.5);
  vec3 colorA = texelFetch(uColorTex, ivec2(typeA, 0), 0).rgb;
  vec3 colorB = texelFetch(uColorTex, ivec2(typeB, 0), 0).rgb;
  float ruleAB = texelFetch(uRuleTex, ivec2(typeB, typeA), 0).r;
  float ruleBA = texelFetch(uRuleTex, ivec2(typeA, typeB), 0).r;
  float rule = (ruleAB + ruleBA) * 0.5;

  vec3 lineColor = mix(colorA, colorB, 0.5);
  if (uLineMode == 1) {
    lineColor = colorA;
  } else if (uLineMode == 2) {
    vec3 attract = vec3(0.25, 1.0, 0.78);
    vec3 repel = vec3(1.0, 0.24, 0.55);
    lineColor = mix(repel, attract, smoothstep(-1.0, 1.0, rule));
    strength *= 0.35 + abs(rule) * 0.65;
  }

  float along = (corner == 0 || corner == 4 || corner == 5) ? 0.0 : 1.0;
  float side = (corner == 0 || corner == 1 || corner == 5) ? -1.0 : 1.0;
  vec2 clipA = projectWorld(pa.xy);
  float aspect = uCanvasSize.x / max(1.0, uCanvasSize.y);
  float viewHeight = uWorldSize / max(0.001, uZoom);
  vec2 clipDelta = vec2(delta.x / (viewHeight * aspect * 0.5), delta.y / (viewHeight * 0.5));
  vec2 clipB = clipA + clipDelta;
  vec2 screenDelta = (clipB - clipA) * uCanvasSize;
  vec2 direction = length(screenDelta) < 0.001 ? vec2(1.0, 0.0) : normalize(screenDelta);
  vec2 normal = vec2(-direction.y / uCanvasSize.x, direction.x / uCanvasSize.y) * max(0.5, uLineWidth) * 2.0;
  vec2 clip = mix(clipA, clipB, along) + normal * side;
  gl_Position = vec4(clip, 0.0, 1.0);
  float alpha = (dist <= uLineRadius ? 0.08 + 0.42 * strength : 0.0) * uLineOpacity;
  vec3 boostedColor = mix(vec3(0.85), lineColor, 0.72) * (0.8 + 1.15 * strength);
  vColor = vec4(boostedColor, alpha);
}`;

const lineFragmentShader = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;

void main() {
  if (vColor.a <= 0.001) discard;
  outColor = vColor;
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
