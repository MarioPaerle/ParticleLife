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
      "uResolution", "uTime", "uCameraDistance", "uCameraYaw", "uCameraPitch",
      "uFieldOfView", "uDiskDensity", "uDiskColor", "uDiskSize", "uDiskParticles",
      "uMass", "uStarDensity", "uSteps", "uSamples", "uExposure", "uDitherStrength",
      "uDitherScale", "uDitherLevels", "uDitherMode",
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
    gl.uniform1f(this.loc.uCameraYaw, state.cameraYaw);
    gl.uniform1f(this.loc.uCameraPitch, state.cameraPitch);
    gl.uniform1f(this.loc.uFieldOfView, state.fieldOfView);
    gl.uniform1f(this.loc.uDiskDensity, state.diskDensity);
    gl.uniform1i(this.loc.uDiskColor, state.diskColor);
    gl.uniform1f(this.loc.uDiskSize, state.diskSize);
    gl.uniform1f(this.loc.uDiskParticles, state.diskParticles);
    gl.uniform1f(this.loc.uMass, state.mass);
    gl.uniform1f(this.loc.uStarDensity, state.starDensity);
    gl.uniform1i(this.loc.uSteps, Math.round(state.integrationSteps));
    gl.uniform1i(this.loc.uSamples, Math.round(state.monteCarloSamples));
    gl.uniform1f(this.loc.uExposure, state.exposure);
    gl.uniform1f(this.loc.uDitherStrength, state.ditherStrength);
    gl.uniform1f(this.loc.uDitherScale, state.ditherScale);
    gl.uniform1f(this.loc.uDitherLevels, state.ditherLevels);
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
uniform float uCameraYaw;
uniform float uCameraPitch;
uniform float uFieldOfView;
uniform float uDiskDensity;
uniform int uDiskColor;
uniform float uDiskSize;
uniform float uDiskParticles;
uniform float uMass;
uniform float uStarDensity;
uniform int uSteps;
uniform int uSamples;
uniform float uExposure;
uniform float uDitherStrength;
uniform float uDitherScale;
uniform float uDitherLevels;
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

float bayer8(vec2 p) {
  vec2 coarse = floor(p * 0.5);
  vec2 fine = mod(p, 2.0);
  float base = bayer4(coarse);
  float fineIndex = fine.x + fine.y * 2.0;
  float add = 0.0;
  if (fineIndex < 0.5) add = 0.0;
  else if (fineIndex < 1.5) add = 2.0;
  else if (fineIndex < 2.5) add = 3.0;
  else add = 1.0;
  return (floor(base * 16.0) * 4.0 + add + 0.5) / 64.0;
}

vec3 palette(float heat) {
  vec3 deep = vec3(0.18, 0.06, 0.018);
  vec3 amber = vec3(1.0, 0.42, 0.08);
  vec3 white = vec3(1.0, 0.88, 0.55);
  return mix(mix(deep, amber, smoothstep(0.05, 0.55, heat)), white, smoothstep(0.62, 1.0, heat));
}

vec3 diskPalette(float heat) {
  vec3 base = palette(heat);
  if (uDiskColor == 1) {
    vec3 deep = vec3(0.12, 0.10, 0.09);
    vec3 hot = vec3(1.0, 0.96, 0.82);
    vec3 core = vec3(1.0);
    return mix(mix(deep, hot, smoothstep(0.04, 0.52, heat)), core, smoothstep(0.58, 1.0, heat));
  }
  if (uDiskColor == 2) {
    vec3 deep = vec3(0.015, 0.06, 0.16);
    vec3 hot = vec3(0.20, 0.72, 1.0);
    vec3 core = vec3(0.92, 0.98, 1.0);
    return mix(mix(deep, hot, smoothstep(0.05, 0.56, heat)), core, smoothstep(0.60, 1.0, heat));
  }
  if (uDiskColor == 3) {
    vec3 deep = vec3(0.16, 0.018, 0.006);
    vec3 hot = vec3(1.0, 0.16, 0.05);
    vec3 core = vec3(1.0, 0.68, 0.36);
    return mix(mix(deep, hot, smoothstep(0.05, 0.55, heat)), core, smoothstep(0.62, 1.0, heat));
  }
  if (uDiskColor == 4) {
    float mono = dot(base, vec3(0.299, 0.587, 0.114));
    return vec3(mono);
  }
  return base;
}

float smoothStarLayer(vec2 sky, float scale, float density, float radius, float salt) {
  vec2 p = sky * scale + salt;
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 offset = vec2(hash(cell + salt), hash(cell + salt + 19.73));
  float d = length(local - offset);
  float chance = clamp(density, 0.0, 0.96);
  float present = step(1.0 - chance, hash(cell + salt + 83.1));
  float core = smoothstep(radius, 0.0, d);
  float halo = smoothstep(radius * 4.5, 0.0, d) * 0.12;
  float brightness = pow(hash(cell + salt + 41.9), 3.2);
  return present * brightness * (core + halo);
}

vec3 starField(vec3 dir, float magnification) {
  vec2 sky = vec2(atan(dir.x, dir.z), asin(clamp(dir.y, -1.0, 1.0)));
  float density = clamp(uStarDensity / 50.0, 0.0, 1.0);
  float sparse = smoothStarLayer(sky, 20.0, density * 0.22, 0.028, 4.0);
  float medium = smoothStarLayer(sky, 56.0, density * 0.40, 0.020, 12.0);
  float dense = smoothStarLayer(sky, 128.0, density * 0.72, 0.012, 23.0);
  float glow = (sparse * 1.55 + medium * 0.82 + dense * 0.32) * (0.18 + density * 1.6);
  float milky = smoothstep(0.74, 0.99, valueNoise(sky * vec2(13.0, 23.0) + 10.0)) * density * density * 0.015;
  vec3 cold = vec3(0.62, 0.72, 1.0);
  vec3 warm = vec3(1.0, 0.82, 0.60);
  vec3 tint = mix(cold, warm, hash(floor(sky * 37.0)));
  return tint * (glow * (0.18 + magnification * 0.36) + milky);
}

float diskParticleField(vec2 disk, float r, float angle, vec2 seed) {
  float density = clamp(uDiskParticles / 80.0, 0.0, 1.0);
  float shear = angle * 10.0 - pow(max(r, 0.001), -0.62) * 12.0 + uTime * 1.7;
  vec2 stream = vec2(shear, r * 1.6);
  float fine = smoothStarLayer(stream, 16.0, density * 0.80, 0.030, 57.0 + seed.x * 0.01);
  float hot = smoothStarLayer(stream, 34.0, density * 0.54, 0.020, 91.0 + seed.y * 0.01);
  float sparks = smoothStarLayer(stream, 72.0, density * 0.34, 0.014, 129.0);
  return fine * 0.35 + hot * 0.85 + sparks * 1.45;
}

vec3 diskEmission(vec3 hit, vec3 viewDir, float pass, vec2 seed, float occult) {
  float r = length(hit.xz);
  float angle = atan(hit.z, hit.x);
  float mass = max(0.25, uMass);
  float inner = 2.72 * mass;
  float outer = max(inner + 1.2 * mass, uDiskSize);
  float gate = smoothstep(inner, inner + 0.55 * mass, r) * (1.0 - smoothstep(outer * 0.82, outer, r));
  if (gate <= 0.0) return vec3(0.0);

  float spiral = angle * 3.5 - pow(max(r, 0.001), -0.72) * 9.0 + uTime * 0.55;
  float turbulence = fbm(vec2(spiral + hash(seed) * 3.0, r * 0.42 - uTime * 0.12));
  float rings = 0.82 + 0.18 * sin(r * 3.35 + turbulence * 3.2 - uTime * 1.05);
  float clumps = smoothstep(0.24, 0.98, turbulence);
  float particles = diskParticleField(hit.xz, r, angle, seed);

  vec3 tangent = normalize(vec3(-hit.z, 0.0, hit.x));
  float orbitalV = clamp(0.68 * sqrt(mass / max(r, inner)), 0.0, 0.62);
  float beaming = pow(clamp(1.0 / max(0.32, 1.0 - orbitalV * dot(tangent, -viewDir)), 0.35, 2.9), 2.15);
  float redshift = sqrt(max(0.0, 1.0 - (2.0 * mass) / max(r, 2.06 * mass)));
  float temperature = pow(inner / max(r, inner), 0.76);
  float secondary = pow(0.58, max(0.0, pass - 1.0));
  float structure = mix(rings, clumps, 0.24) + particles * (0.25 + temperature * 0.55);
  float light = gate * (0.18 + temperature * 1.75) * structure * beaming * redshift * secondary * uDiskDensity;
  vec3 diskTone = diskPalette(clamp(light * 0.58 + particles * 0.13, 0.0, 1.0));
  vec3 base = diskTone * light;
  vec3 particleGlow = mix(diskTone, vec3(1.0), 0.36) * particles * gate * secondary * uDiskDensity * (0.32 + temperature * 0.75);
  return (base + particleGlow) * occult;
}

vec3 sampleRadiance(vec2 sampleUv, vec2 seed, float sampleIndex) {
  vec2 uv = sampleUv;
  uv.x *= uResolution.x / max(1.0, uResolution.y);

  float fov = radians(uFieldOfView);
  float mass = max(0.25, uMass);
  float horizon = 2.0 * mass;
  float photonRadius = 3.0 * mass;
  float innerDisk = 2.72 * mass;
  float outerDisk = max(innerDisk + 1.2 * mass, uDiskSize);
  float rCamera = max(3.2 * mass + 3.0, uCameraDistance);
  float elevation = radians(uCameraPitch);
  float yaw = radians(uCameraYaw);
  vec3 camera = vec3(sin(yaw) * cos(elevation) * rCamera, sin(elevation) * rCamera, cos(yaw) * cos(elevation) * rCamera);
  vec3 forward = normalize(-camera);
  vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
  vec3 up = normalize(cross(right, forward));
  vec3 dir = normalize(forward + (uv.x * right + uv.y * up) * tan(fov * 0.5));
  vec3 initialDir = dir;
  vec3 pos = camera;
  vec3 prev = pos;
  vec3 color = vec3(0.0);
  float minR = 999.0;
  float diskPass = 0.0;
  bool captured = false;

  for (int i = 0; i < 192; i += 1) {
    if (i >= uSteps) break;
    float r = length(pos);
    minR = min(minR, r);

    if (r < horizon + 0.03 * mass) {
      captured = true;
      break;
    }

    if (r > rCamera * 2.65 && dot(pos, dir) > 0.0) {
      break;
    }

    float stepSize = clamp(r * 0.032, 0.026 * mass, 1.85);
    stepSize *= mix(0.40, 1.0, smoothstep(photonRadius + 0.2 * mass, 24.0 * mass, r));
    vec3 gravity = -pos / max(r, 0.0001);
    float bend = (2.35 * mass) / max(r * r, 0.08);
    dir = normalize(dir + gravity * bend * stepSize);

    prev = pos;
    pos += dir * stepSize;

    if ((prev.y > 0.0 && pos.y <= 0.0) || (prev.y < 0.0 && pos.y >= 0.0)) {
      float t = prev.y / max(0.00001, prev.y - pos.y);
      vec3 hit = mix(prev, pos, clamp(t, 0.0, 1.0));
      float diskR = length(hit.xz);
      if (diskR > innerDisk * 0.94 && diskR < outerDisk) {
        diskPass += 1.0;
        float nearShadow = smoothstep(horizon * 1.08, photonRadius * 1.18, minR);
        float diskOpacity = clamp(0.18 + uDiskDensity * 0.22, 0.0, 0.78);
        float passDim = pow(1.0 - diskOpacity, max(0.0, diskPass - 1.0));
        float occult = nearShadow * passDim;
        color += diskEmission(hit, dir, diskPass, seed + vec2(sampleIndex, diskPass), occult) * pow(0.72, diskPass - 1.0);
        color *= mix(1.0, 1.0 - diskOpacity * 0.45, smoothstep(0.0, 2.0, diskPass - 1.0));
      }
    }
  }

  float cosAlpha = clamp(dot(initialDir, forward), 0.0, 1.0);
  float sinAlpha = sqrt(max(0.0, 1.0 - cosAlpha * cosAlpha));
  float impact = rCamera * sinAlpha / sqrt(max(0.02, 1.0 - (2.0 * mass) / rCamera));
  float criticalImpact = 5.1961524 * mass;
  float nearCriticalImpact = exp(-pow((impact - criticalImpact) / (0.105 * mass), 2.0));
  float photonSphere = exp(-pow((minR - photonRadius) / (0.14 * mass), 2.0));
  float magnification = clamp((0.18 * mass) / max(0.025, abs(minR - photonRadius)), 0.0, 3.8);
  color += starField(dir, magnification) * (captured ? 0.08 : 1.0);
  float shadowMask = 1.0 - smoothstep(criticalImpact * 0.82, criticalImpact * 1.08, impact);
  color *= mix(1.0, 0.014, shadowMask);
  color += vec3(1.0, 0.78, 0.50) * max(photonSphere * 0.28, nearCriticalImpact * 0.72) * (0.055 + 0.10 * diskPass) * (captured ? 1.1 : 0.58);

  if (captured) {
    color *= 0.018;
  }

  return color;
}

void main() {
  vec2 baseUv = vUv * 2.0 - 1.0;
  vec3 color = vec3(0.0);
  int samples = clamp(uSamples, 1, 16);
  for (int i = 0; i < 16; i += 1) {
    if (i >= samples) break;
    vec2 seed = gl_FragCoord.xy + vec2(float(i) * 19.19, float(i) * 71.7);
    vec2 jitter = vec2(hash(seed), hash(seed + 31.7)) - 0.5;
    vec2 sampleUv = baseUv + jitter * 2.0 / uResolution.xy;
    color += sampleRadiance(sampleUv, seed, float(i));
  }
  color /= float(samples);
  color = color / (1.0 + color * 0.48);
  color *= uExposure;
  color = pow(color, vec3(0.82));

  if (uDitherMode > 0) {
    vec2 pixel = floor(gl_FragCoord.xy / max(1.0, uDitherScale));
    float threshold = bayer4(pixel);
    if (uDitherMode == 1) {
      color += (threshold - 0.5) * uDitherStrength / 7.5;
    } else if (uDitherMode == 2) {
      float levels = mix(max(2.0, uDitherLevels), 3.0, uDitherStrength);
      color = floor(color * levels + threshold) / levels;
    } else {
      if (uDitherMode == 4) {
        float t8 = bayer8(pixel);
        color += (t8 - 0.5) * uDitherStrength / 6.5;
      } else if (uDitherMode == 5) {
        float blue = hash(pixel + floor(color.rg * 37.0)) - 0.5;
        float levels = max(2.0, uDitherLevels);
        color = floor(color * levels + blue * uDitherStrength + 0.5) / levels;
      } else if (uDitherMode == 6) {
        vec2 cell = fract(pixel / 6.0) - 0.5;
        float dotMask = smoothstep(0.42, 0.02, length(cell));
        float mono = dot(color, vec3(0.299, 0.587, 0.114));
        float levels = max(2.0, uDitherLevels);
        mono = floor(mono * levels + mix(threshold, dotMask, 0.72) * uDitherStrength) / levels;
        color = vec3(mono);
      } else if (uDitherMode == 7) {
        float scan = sin(pixel.y * 3.14159265) * 0.5 + 0.5;
        float mono = dot(color, vec3(0.299, 0.587, 0.114));
        float levels = max(2.0, uDitherLevels);
        mono = floor(mono * levels + mix(threshold, scan, 0.55) * uDitherStrength) / levels;
        color = vec3(mono);
      } else {
      float mono = dot(color, vec3(0.299, 0.587, 0.114));
      float levels = mix(max(2.0, uDitherLevels), 4.0, uDitherStrength);
      mono = floor(mono * levels + threshold) / levels;
      color = vec3(mono);
      }
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
