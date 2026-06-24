export class BlackHoleRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    this.ok = Boolean(this.gl);
    if (!this.ok) return;

    const gl = this.gl;
    this.quad = makeBuffer(gl, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
    this.program = makeProgram(gl, vertexShader, fragmentShader);
    this.loc = locations(gl, this.program, [
      "uResolution", "uTime", "uCameraDistance", "uFieldOfView", "uInclination",
      "uDiskDensity", "uSteps", "uExposure", "uDitherStrength", "uDitherMode",
    ]);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  draw(now, state) {
    if (!this.ok) return;
    this.resize();
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.uniform2f(this.loc.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.loc.uTime, now * 0.001);
    gl.uniform1f(this.loc.uCameraDistance, state.cameraDistance);
    gl.uniform1f(this.loc.uFieldOfView, state.fieldOfView);
    gl.uniform1f(this.loc.uInclination, state.diskInclination);
    gl.uniform1f(this.loc.uDiskDensity, state.diskDensity);
    gl.uniform1i(this.loc.uSteps, Math.round(state.integrationSteps));
    gl.uniform1f(this.loc.uExposure, state.exposure);
    gl.uniform1f(this.loc.uDitherStrength, state.ditherStrength);
    gl.uniform1i(this.loc.uDitherMode, state.ditherMode);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = gl.getAttribLocation(this.program, "aPosition");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

const vertexShader = `#version 300 es
in vec2 aPosition;
out vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const fragmentShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform vec2 uResolution;
uniform float uTime;
uniform float uCameraDistance;
uniform float uFieldOfView;
uniform float uInclination;
uniform float uDiskDensity;
uniform int uSteps;
uniform float uExposure;
uniform float uDitherStrength;
uniform int uDitherMode;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i += 1) {
    sum += valueNoise(p) * amp;
    p = p * 2.03 + 17.7;
    amp *= 0.52;
  }
  return sum;
}

float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int index = x + y * 4;
  float v = 0.0;
  if (index == 0) v = 0.0; else if (index == 1) v = 8.0; else if (index == 2) v = 2.0; else if (index == 3) v = 10.0;
  else if (index == 4) v = 12.0; else if (index == 5) v = 4.0; else if (index == 6) v = 14.0; else if (index == 7) v = 6.0;
  else if (index == 8) v = 3.0; else if (index == 9) v = 11.0; else if (index == 10) v = 1.0; else if (index == 11) v = 9.0;
  else if (index == 12) v = 15.0; else if (index == 13) v = 7.0; else if (index == 14) v = 13.0; else v = 5.0;
  return (v + 0.5) / 16.0;
}

vec3 palette(float heat) {
  vec3 deep = vec3(0.18, 0.06, 0.018);
  vec3 amber = vec3(1.0, 0.42, 0.08);
  vec3 white = vec3(1.0, 0.88, 0.55);
  return mix(mix(deep, amber, smoothstep(0.05, 0.55, heat)), white, smoothstep(0.62, 1.0, heat));
}

vec3 starField(vec2 uv, float magnification) {
  vec2 p = uv * 72.0;
  vec2 cell = floor(p);
  float local = hash(cell);
  float star = step(0.992, local) * pow(hash(cell + 4.2), 5.0);
  float twinkle = 0.72 + 0.28 * sin(uTime * 2.0 + local * 31.0);
  return vec3(star * twinkle * (0.14 + magnification * 0.22));
}

float geodesicDeflection(float b, float rCamera, out float minR, out float whirl, out bool captured) {
  float u = 1.0 / rCamera;
  float invB2 = 1.0 / max(0.0001, b * b);
  float radial = max(0.0, invB2 - u * u + 2.0 * u * u * u);
  float du = sqrt(radial);
  float phi = 0.0;
  float dphi = 0.018;
  float signDir = 1.0;
  minR = rCamera;
  whirl = 0.0;
  captured = false;

  for (int i = 0; i < 192; i += 1) {
    if (i >= uSteps) break;
    float accel = 3.0 * u * u - u;
    du += accel * dphi * signDir;
    u += du * dphi * signDir;
    phi += dphi;

    if (u > 0.499) {
      captured = true;
      break;
    }

    if (u > 0.0) {
      minR = min(minR, 1.0 / u);
    }

    float potential = invB2 - u * u + 2.0 * u * u * u;
    if (potential <= 0.00003 && signDir > 0.0) {
      signDir = -1.0;
      du = sqrt(max(0.0, potential));
      whirl += 1.0;
    }

    if (signDir < 0.0 && u <= 1.0 / rCamera) break;
  }

  return phi;
}

float diskBand(vec2 p, float height, float inner, float outer) {
  float r = length(p);
  float band = exp(-pow(abs(p.y) / max(0.006, height + r * 0.012), 1.22));
  return band * smoothstep(inner, inner * 1.18, r) * (1.0 - smoothstep(outer * 0.82, outer, r));
}

float diskTexture(vec2 p, float side) {
  float r = length(p);
  float angle = atan(p.y, p.x);
  float shear = angle * 6.0 + uTime * (1.1 + side * 0.45) - pow(max(0.01, r), -0.55) * 3.2;
  float turbulence = fbm(vec2(shear, r * 13.0));
  float rings = 0.55 + 0.45 * sin(r * 34.0 - uTime * 1.8 + turbulence * 2.0);
  return mix(rings, turbulence, 0.62);
}

void main() {
  vec2 uv = (vUv * 2.0 - 1.0);
  uv.x *= uResolution.x / max(1.0, uResolution.y);

  float fov = radians(uFieldOfView);
  vec3 ray = normalize(vec3(uv * tan(fov * 0.5), -1.0));
  float rCamera = max(6.2, uCameraDistance);
  float cosAlpha = clamp(-ray.z, 0.0, 1.0);
  float sinAlpha = sqrt(max(0.0, 1.0 - cosAlpha * cosAlpha));
  float b = rCamera * sinAlpha / sqrt(max(0.01, 1.0 - 2.0 / rCamera));
  float criticalB = 5.1961524;
  float minR;
  float whirl;
  bool captured;
  float phi = geodesicDeflection(b, rCamera, minR, whirl, captured);
  float nearCritical = exp(-pow((b - criticalB) / 0.075, 2.0));
  float magnification = clamp(0.25 / max(0.025, abs(b - criticalB)), 0.0, 4.0);

  float inc = radians(uInclination);
  float projectedY = uv.y / max(0.16, cos(inc));
  float bend = clamp(phi - 0.55, 0.0, 5.8);
  float lensLift = bend * 0.12 / (1.0 + length(uv) * 2.2);
  vec2 directDisk = vec2(uv.x, projectedY);
  vec2 topArc = vec2(uv.x, (uv.y - 0.34 + lensLift * 0.22) / max(0.16, cos(inc)));
  vec2 bottomArc = vec2(uv.x, (uv.y + 0.27 - lensLift * 0.18) / max(0.16, cos(inc)));

  float inner = 0.28;
  float outer = 1.42;
  float direct = diskBand(directDisk, 0.026, inner, outer) * diskTexture(directDisk, 1.0);
  float top = diskBand(topArc, 0.020, inner * 0.82, outer * 1.02) * diskTexture(topArc, -1.0) * smoothstep(0.06, 0.64, uv.y);
  float bottom = diskBand(bottomArc, 0.018, inner * 0.90, outer) * diskTexture(bottomArc, 1.0) * smoothstep(-0.02, -0.54, uv.y);

  float angle = atan(uv.y, uv.x);
  float doppler = 0.62 + 0.78 * smoothstep(-0.9, 0.95, cos(angle - 0.18) * sin(inc));
  float gravitationalRedshift = sqrt(max(0.0, 1.0 - 2.0 / max(2.08, minR)));
  float diskLight = (direct + top * 0.95 + bottom * 0.58) * uDiskDensity * doppler * gravitationalRedshift;
  float heat = clamp(diskLight + nearCritical * 0.55, 0.0, 1.8);

  vec2 skyUv = uv + normalize(uv + 0.0001) * bend * 0.13;
  vec3 color = vec3(0.002, 0.003, 0.010);
  color += starField(skyUv, magnification);
  color += palette(clamp(heat, 0.0, 1.0)) * heat * 2.15;
  color += vec3(0.95, 0.82, 0.72) * nearCritical * (0.34 + magnification * 0.08);
  color += vec3(1.0, 0.55, 0.16) * exp(-pow((length(uv) - 0.46) / 0.10, 2.0)) * diskLight * 0.35;

  if (captured) {
    color = mix(color, vec3(0.0), 0.985);
  }
  color = color / (1.0 + color * 0.48);
  color *= uExposure;
  color = pow(color, vec3(0.82));

  if (uDitherMode > 0) {
    vec2 pixel = gl_FragCoord.xy;
    float threshold = bayer4(pixel);
    if (uDitherMode == 1) {
      color += (threshold - 0.5) * uDitherStrength / 7.5;
    } else if (uDitherMode == 2) {
      float levels = mix(18.0, 5.0, uDitherStrength);
      color = floor(color * levels + threshold) / levels;
    } else {
      float mono = dot(color, vec3(0.299, 0.587, 0.114));
      float levels = mix(24.0, 4.0, uDitherStrength);
      mono = floor(mono * levels + threshold) / levels;
      color = vec3(mono);
    }
  }

  outColor = vec4(color, 1.0);
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
