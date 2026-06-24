import { GpuParticleLife } from "./gpu-particle-life.js";
import { clamp, makePalette, matrixFromPrompt, randomMatrix, seedFromString } from "./rules.js";

const FIXED_STEP = 1 / 120;
const MAX_FRAME_STEPS = 12;

const canvas = document.querySelector("#glCanvas");
const asciiCanvas = document.querySelector("#asciiCanvas");
const stage = document.querySelector(".stage");
const body = document.body;

const controls = {
  particleCount: document.querySelector("#particleCount"),
  density: document.querySelector("#density"),
  typeCount: document.querySelector("#typeCount"),
  worldSize: document.querySelector("#worldSize"),
  zoom: document.querySelector("#zoom"),
  speed: document.querySelector("#speed"),
  interactionSamples: document.querySelector("#interactionSamples"),
  radius: document.querySelector("#radius"),
  noise: document.querySelector("#noise"),
  friction: document.querySelector("#friction"),
  glow: document.querySelector("#glow"),
  size: document.querySelector("#size"),
  lineEnabled: document.querySelector("#lineEnabled"),
  lineCount: document.querySelector("#lineCount"),
  lineRadius: document.querySelector("#lineRadius"),
  lineOpacity: document.querySelector("#lineOpacity"),
  lineMode: document.querySelector("#lineMode"),
  prompt: document.querySelector("#promptInput"),
};

const readouts = {
  fps: document.querySelector("#fps"),
  particles: document.querySelector("#particleReadout"),
  gpu: document.querySelector("#gpuReadout"),
  particleCount: document.querySelector("#particleCountValue"),
  density: document.querySelector("#densityValue"),
  typeCount: document.querySelector("#typeCountValue"),
  worldSize: document.querySelector("#worldSizeValue"),
  zoom: document.querySelector("#zoomValue"),
  speed: document.querySelector("#speedValue"),
  interactionSamples: document.querySelector("#interactionSamplesValue"),
  radius: document.querySelector("#radiusValue"),
  noise: document.querySelector("#noiseValue"),
  friction: document.querySelector("#frictionValue"),
  glow: document.querySelector("#glowValue"),
  size: document.querySelector("#sizeValue"),
  lineEnabled: document.querySelector("#lineEnabledValue"),
  lineCount: document.querySelector("#lineCountValue"),
  lineRadius: document.querySelector("#lineRadiusValue"),
  lineOpacity: document.querySelector("#lineOpacityValue"),
};

const state = {
  particleCount: Number(controls.particleCount.value),
  density: Number(controls.density.value),
  typeCount: Number(controls.typeCount.value),
  worldSize: Number(controls.worldSize.value),
  speed: Number(controls.speed.value),
  interactionSamples: Number(controls.interactionSamples.value),
  radius: Number(controls.radius.value),
  noise: Number(controls.noise.value),
  friction: Number(controls.friction.value),
  glow: Number(controls.glow.value),
  size: Number(controls.size.value),
  lineEnabled: controls.lineEnabled.checked,
  lineCount: Number(controls.lineCount.value),
  lineRadius: Number(controls.lineRadius.value),
  lineOpacity: Number(controls.lineOpacity.value),
  lineMode: Number(controls.lineMode.value),
  theme: "aurora",
  paused: false,
  camera: {
    x: Number(controls.worldSize.value) * 0.5,
    y: Number(controls.worldSize.value) * 0.5,
    zoom: Number(controls.zoom.value),
  },
  matrix: randomMatrix(6, seedFromString("aurora-starter")),
  palette: makePalette("aurora", 6),
};

const sim = new GpuParticleLife(canvas, asciiCanvas);
if (!sim.ok) {
  readouts.gpu.textContent = "No WebGL2";
  throw new Error("ParticleLife needs WebGL2 with floating point render targets.");
}

sim.configure(state);
sim.randomizeParticles(state.particleCount, state.typeCount, seedFromString("first-spawn"), state.worldSize);
syncUi();
renderMatrixEditor();
applyTheme("aurora");

let lastTime = performance.now();
let fpsTime = lastTime;
let frames = 0;
let physicsTime = 0;

function frame(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;

  if (!state.paused) {
    physicsTime += dt * state.speed;
    let steps = 0;
    while (physicsTime >= FIXED_STEP && steps < MAX_FRAME_STEPS) {
      sim.step(FIXED_STEP, state);
      physicsTime -= FIXED_STEP;
      steps += 1;
    }
    if (steps === MAX_FRAME_STEPS) {
      physicsTime = Math.min(physicsTime, FIXED_STEP);
    }
  }
  sim.draw(state);

  frames += 1;
  if (now - fpsTime > 400) {
    readouts.fps.textContent = Math.round((frames * 1000) / (now - fpsTime));
    fpsTime = now;
    frames = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function updateNumberControl(key, formatter = (value) => value) {
  state[key] = Number(controls[key].value);
  readouts[key].textContent = formatter(state[key]);
  sim.configure(state);
}

controls.particleCount.addEventListener("input", () => {
  updateNumberControl("particleCount", (v) => String(v));
  applyDensityToWorldSize();
});
controls.particleCount.addEventListener("change", () => {
  sim.randomizeParticles(state.particleCount, state.typeCount, seedFromString(`${Date.now()}-count`), state.worldSize);
  readouts.particles.textContent = state.particleCount;
});

controls.density.addEventListener("input", () => {
  updateNumberControl("density", (v) => v.toFixed(1));
  applyDensityToWorldSize();
});
controls.density.addEventListener("change", () => {
  centerCamera();
  sim.randomizeParticles(state.particleCount, state.typeCount, seedFromString(`${Date.now()}-density`), state.worldSize);
});

controls.typeCount.addEventListener("input", () => {
  const nextTypes = Number(controls.typeCount.value);
  state.typeCount = nextTypes;
  state.matrix = resizeMatrix(state.matrix, nextTypes);
  state.palette = makePalette(state.theme, nextTypes);
  readouts.typeCount.textContent = String(nextTypes);
  renderMatrixEditor();
  sim.configure(state);
});
controls.typeCount.addEventListener("change", () => {
  sim.randomizeParticles(state.particleCount, state.typeCount, seedFromString(`${Date.now()}-types`), state.worldSize);
});

controls.worldSize.addEventListener("input", () => {
  const previous = state.worldSize;
  updateNumberControl("worldSize", (v) => v.toFixed(1));
  const scale = state.worldSize / previous;
  state.camera.x = wrapWorld(state.camera.x * scale);
  state.camera.y = wrapWorld(state.camera.y * scale);
  updateDensityFromWorldSize();
});
controls.worldSize.addEventListener("change", () => {
  centerCamera();
  sim.randomizeParticles(state.particleCount, state.typeCount, seedFromString(`${Date.now()}-world`), state.worldSize);
});

controls.zoom.addEventListener("input", () => {
  state.camera.zoom = Number(controls.zoom.value);
  readouts.zoom.textContent = state.camera.zoom.toFixed(2);
  sim.configure(state);
});

for (const [key, digits] of [["speed", 2], ["noise", 2], ["friction", 3], ["glow", 2], ["size", 1]]) {
  controls[key].addEventListener("input", () => updateNumberControl(key, (v) => v.toFixed(digits)));
}

controls.radius.addEventListener("input", () => {
  updateNumberControl("radius", (v) => v.toFixed(3));
  applyDensityToWorldSize();
});
controls.radius.addEventListener("change", () => {
  centerCamera();
  sim.randomizeParticles(state.particleCount, state.typeCount, seedFromString(`${Date.now()}-radius`), state.worldSize);
});

controls.interactionSamples.addEventListener("input", () => {
  updateNumberControl("interactionSamples", (v) => String(Math.round(v)));
});

controls.lineEnabled.addEventListener("input", () => {
  state.lineEnabled = controls.lineEnabled.checked;
  readouts.lineEnabled.textContent = state.lineEnabled ? "on" : "off";
  sim.configure(state);
});

for (const [key, digits] of [["lineCount", 0], ["lineRadius", 3], ["lineOpacity", 2]]) {
  controls[key].addEventListener("input", () => updateNumberControl(key, (v) => digits === 0 ? String(Math.round(v)) : v.toFixed(digits)));
}

controls.lineMode.addEventListener("input", () => {
  state.lineMode = Number(controls.lineMode.value);
  sim.configure(state);
});

document.querySelector("#pauseButton").addEventListener("click", (event) => {
  state.paused = !state.paused;
  event.currentTarget.textContent = state.paused ? ">" : "II";
});

document.querySelector("#randomizeRules").addEventListener("click", () => {
  const seed = seedFromString(`${controls.prompt.value || state.theme}-${Date.now()}`);
  state.matrix = randomMatrix(state.typeCount, seed);
  renderMatrixEditor();
  sim.configure(state);
});

document.querySelector("#respawnParticles").addEventListener("click", () => {
  sim.randomizeParticles(state.particleCount, state.typeCount, seedFromString(`${Date.now()}-respawn`), state.worldSize);
});

document.querySelector("#copyMatrix").addEventListener("click", async () => {
  const text = JSON.stringify(state.matrix.map((row) => row.map((v) => Number(v.toFixed(3)))));
  await navigator.clipboard.writeText(text);
});

document.querySelector("#applyPrompt").addEventListener("click", () => {
  const result = matrixFromPrompt(controls.prompt.value, state.typeCount);
  state.matrix = result.matrix;
  if (result.themeHint) {
    applyTheme(result.themeHint);
  }
  renderMatrixEditor();
  sim.configure(state);
});

document.querySelector("#clearPrompt").addEventListener("click", () => {
  controls.prompt.value = "";
});

document.querySelectorAll("[data-theme]").forEach((button) => {
  button.addEventListener("click", () => applyTheme(button.dataset.theme));
});

document.querySelector("#zoomOut").addEventListener("click", () => setZoom(state.camera.zoom / 1.35));
document.querySelector("#zoomIn").addEventListener("click", () => setZoom(state.camera.zoom * 1.35));
document.querySelector("#resetView").addEventListener("click", () => {
  centerCamera();
  setZoom(1);
});

let drag = null;
canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  drag = { x: event.clientX, y: event.clientY };
});

canvas.addEventListener("pointermove", (event) => {
  if (!drag) return;
  panByPixels(event.clientX - drag.x, event.clientY - drag.y);
  drag = { x: event.clientX, y: event.clientY };
});

canvas.addEventListener("pointerup", () => {
  drag = null;
});

canvas.addEventListener("pointercancel", () => {
  drag = null;
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const factor = Math.exp(-event.deltaY * 0.0015);
  setZoom(state.camera.zoom * factor);
}, { passive: false });

window.addEventListener("resize", () => sim.resize());

function applyTheme(theme) {
  state.theme = theme;
  body.className = `theme-${theme}`;
  document.querySelectorAll("[data-theme]").forEach((button) => {
    button.classList.toggle("active", button.dataset.theme === theme);
  });
  state.palette = makePalette(theme, state.typeCount);
  stage.style.background = themeBackground(theme);
  sim.configure(state);
}

function renderMatrixEditor() {
  const grid = document.querySelector("#matrixGrid");
  grid.style.gridTemplateColumns = `repeat(${state.typeCount}, 44px)`;
  grid.replaceChildren();

  for (let row = 0; row < state.typeCount; row += 1) {
    for (let col = 0; col < state.typeCount; col += 1) {
      const input = document.createElement("input");
      input.className = "matrix-cell";
      input.type = "number";
      input.min = "-1";
      input.max = "1";
      input.step = "0.05";
      input.value = state.matrix[row][col].toFixed(2);
      paintMatrixCell(input, state.matrix[row][col]);
      input.title = `Type ${row + 1} responding to type ${col + 1}`;
      input.addEventListener("input", () => {
        const value = clamp(Number(input.value) || 0, -1, 1);
        state.matrix[row][col] = value;
        paintMatrixCell(input, value);
        sim.configure(state);
      });
      grid.append(input);
    }
  }
}

function paintMatrixCell(input, value) {
  const strength = Math.round(Math.abs(value) * 72);
  input.style.background = value >= 0
    ? `rgb(${20 + strength}, ${44 + strength * 2}, ${40 + strength})`
    : `rgb(${54 + strength * 2}, ${24 + strength}, ${45 + strength})`;
}

function resizeMatrix(matrix, size) {
  const next = randomMatrix(size, seedFromString(`resize-${size}-${Date.now()}`));
  for (let row = 0; row < Math.min(size, matrix.length); row += 1) {
    for (let col = 0; col < Math.min(size, matrix[row].length); col += 1) {
      next[row][col] = matrix[row][col];
    }
  }
  return next;
}

function syncUi() {
  readouts.particles.textContent = state.particleCount;
  for (const key of Object.keys(controls)) {
    if (key !== "prompt" && readouts[key]) {
      readouts[key].textContent = Number(controls[key].value).toString();
    }
  }
  readouts.radius.textContent = state.radius.toFixed(3);
  readouts.friction.textContent = state.friction.toFixed(3);
  readouts.size.textContent = state.size.toFixed(1);
  readouts.worldSize.textContent = state.worldSize.toFixed(1);
  readouts.zoom.textContent = state.camera.zoom.toFixed(2);
  readouts.density.textContent = state.density.toFixed(1);
  readouts.interactionSamples.textContent = String(state.interactionSamples);
  readouts.lineEnabled.textContent = state.lineEnabled ? "on" : "off";
  readouts.lineCount.textContent = String(state.lineCount);
  readouts.lineRadius.textContent = state.lineRadius.toFixed(3);
  readouts.lineOpacity.textContent = state.lineOpacity.toFixed(2);
}

function applyDensityToWorldSize() {
  const nextWorldSize = Math.sqrt((state.particleCount * Math.PI * state.radius * state.radius) / Math.max(0.01, state.density));
  setWorldSize(nextWorldSize);
}

function updateDensityFromWorldSize() {
  state.density = (state.particleCount * Math.PI * state.radius * state.radius) / (state.worldSize * state.worldSize);
  state.density = clamp(state.density, Number(controls.density.min), Number(controls.density.max));
  controls.density.value = state.density;
  readouts.density.textContent = state.density.toFixed(1);
}

function setWorldSize(value) {
  const previous = state.worldSize;
  state.worldSize = clamp(value, Number(controls.worldSize.min), Number(controls.worldSize.max));
  controls.worldSize.value = state.worldSize;
  readouts.worldSize.textContent = state.worldSize.toFixed(1);
  const scale = state.worldSize / previous;
  state.camera.x = wrapWorld(state.camera.x * scale);
  state.camera.y = wrapWorld(state.camera.y * scale);
  sim.configure(state);
}

function setZoom(value) {
  state.camera.zoom = clamp(value, Number(controls.zoom.min), Number(controls.zoom.max));
  controls.zoom.value = state.camera.zoom;
  readouts.zoom.textContent = state.camera.zoom.toFixed(2);
  sim.configure(state);
}

function centerCamera() {
  state.camera.x = state.worldSize * 0.5;
  state.camera.y = state.worldSize * 0.5;
  sim.configure(state);
}

function panByPixels(dx, dy) {
  const rect = canvas.getBoundingClientRect();
  const viewHeight = state.worldSize / state.camera.zoom;
  const viewWidth = viewHeight * (rect.width / Math.max(1, rect.height));
  state.camera.x = wrapWorld(state.camera.x - (dx / Math.max(1, rect.width)) * viewWidth);
  state.camera.y = wrapWorld(state.camera.y + (dy / Math.max(1, rect.height)) * viewHeight);
  sim.configure(state);
}

function wrapWorld(value) {
  return ((value % state.worldSize) + state.worldSize) % state.worldSize;
}

function themeBackground(theme) {
  const backgrounds = {
    aurora: "radial-gradient(circle at 18% 18%, rgba(72, 240, 200, 0.14), transparent 30%), radial-gradient(circle at 85% 72%, rgba(255, 119, 196, 0.13), transparent 32%), #07080b",
    pixel: "linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), #070707",
    ascii: "radial-gradient(circle at center, rgba(183,255,106,0.09), transparent 52%), #050805",
    void: "radial-gradient(circle at 35% 18%, rgba(120,166,255,0.12), transparent 28%), radial-gradient(circle at 74% 78%, rgba(255,114,182,0.11), transparent 34%), #03040a",
  };
  return backgrounds[theme] || backgrounds.aurora;
}
