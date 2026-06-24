import { BlackHoleRenderer } from "./black-hole-renderer.js?v=20260624q";

const canvas = document.querySelector("#blackHoleCanvas");
const controls = {
  cameraDistance: document.querySelector("#cameraDistance"),
  cameraYaw: document.querySelector("#cameraYaw"),
  cameraPitch: document.querySelector("#cameraPitch"),
  fieldOfView: document.querySelector("#fieldOfView"),
  diskDensity: document.querySelector("#diskDensity"),
  diskColor: document.querySelector("#diskColor"),
  diskSize: document.querySelector("#diskSize"),
  diskParticles: document.querySelector("#diskParticles"),
  mass: document.querySelector("#mass"),
  starDensity: document.querySelector("#starDensity"),
  integrationSteps: document.querySelector("#integrationSteps"),
  monteCarloSamples: document.querySelector("#monteCarloSamples"),
  exposure: document.querySelector("#exposure"),
  ditherStrength: document.querySelector("#ditherStrength"),
  ditherScale: document.querySelector("#ditherScale"),
  ditherLevels: document.querySelector("#ditherLevels"),
  ditherMode: document.querySelector("#ditherMode"),
};

const readouts = {
  fps: document.querySelector("#fps"),
  steps: document.querySelector("#stepsReadout"),
  cameraDistance: document.querySelector("#cameraDistanceValue"),
  cameraYaw: document.querySelector("#cameraYawValue"),
  cameraPitch: document.querySelector("#cameraPitchValue"),
  fieldOfView: document.querySelector("#fieldOfViewValue"),
  diskDensity: document.querySelector("#diskDensityValue"),
  diskSize: document.querySelector("#diskSizeValue"),
  diskParticles: document.querySelector("#diskParticlesValue"),
  mass: document.querySelector("#massValue"),
  starDensity: document.querySelector("#starDensityValue"),
  integrationSteps: document.querySelector("#integrationStepsValue"),
  monteCarloSamples: document.querySelector("#monteCarloSamplesValue"),
  exposure: document.querySelector("#exposureValue"),
  ditherStrength: document.querySelector("#ditherStrengthValue"),
  ditherScale: document.querySelector("#ditherScaleValue"),
  ditherLevels: document.querySelector("#ditherLevelsValue"),
};

const state = {
  cameraDistance: Number(controls.cameraDistance.value),
  cameraYaw: Number(controls.cameraYaw.value),
  cameraPitch: Number(controls.cameraPitch.value),
  fieldOfView: Number(controls.fieldOfView.value),
  diskDensity: Number(controls.diskDensity.value),
  diskColor: Number(controls.diskColor.value),
  diskSize: Number(controls.diskSize.value),
  diskParticles: Number(controls.diskParticles.value),
  mass: Number(controls.mass.value),
  starDensity: Number(controls.starDensity.value),
  integrationSteps: Number(controls.integrationSteps.value),
  monteCarloSamples: Number(controls.monteCarloSamples.value),
  exposure: Number(controls.exposure.value),
  ditherStrength: Number(controls.ditherStrength.value),
  ditherScale: Number(controls.ditherScale.value),
  ditherLevels: Number(controls.ditherLevels.value),
  ditherMode: Number(controls.ditherMode.value),
};

const renderer = new BlackHoleRenderer(canvas);
if (!renderer.ok) {
  throw new Error("Black Hole Lab needs WebGL2.");
}

syncUi();

let lastTime = performance.now();
let fpsTime = lastTime;
let frames = 0;
let drag = null;

function frame(now) {
  renderer.draw(now, state);
  frames += 1;
  if (now - fpsTime > 400) {
    readouts.fps.textContent = Math.round((frames * 1000) / (now - fpsTime));
    fpsTime = now;
    frames = 0;
  }
  lastTime = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const numericControls = [
  ["cameraDistance", 1],
  ["cameraYaw", 0],
  ["cameraPitch", 0],
  ["fieldOfView", 1],
  ["diskDensity", 2],
  ["diskSize", 1],
  ["diskParticles", 1],
  ["mass", 2],
  ["starDensity", 1],
  ["integrationSteps", 0],
  ["monteCarloSamples", 0],
  ["exposure", 2],
  ["ditherStrength", 2],
  ["ditherScale", 0],
  ["ditherLevels", 0],
];

for (const [key, digits] of numericControls) {
  controls[key].addEventListener("input", () => {
    setNumericControl(key, Number(controls[key].value), digits);
  });
}

for (const key of ["diskColor", "ditherMode"]) {
  controls[key].addEventListener("input", () => {
    state[key] = Number(controls[key].value);
  });
}

window.addEventListener("resize", () => renderer.resize());

canvas.addEventListener("pointerdown", (event) => {
  drag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
  };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  drag.x = event.clientX;
  drag.y = event.clientY;
  setNumericControl("cameraYaw", state.cameraYaw - dx * 0.28, 0);
  setNumericControl("cameraPitch", state.cameraPitch + dy * 0.18, 0);
});

canvas.addEventListener("pointerup", (event) => {
  if (drag?.id === event.pointerId) {
    drag = null;
  }
});

canvas.addEventListener("pointercancel", () => {
  drag = null;
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const scale = Math.exp(event.deltaY * 0.0012);
  setNumericControl("cameraDistance", state.cameraDistance * scale, 1);
}, { passive: false });

function syncUi() {
  readouts.cameraDistance.textContent = state.cameraDistance.toFixed(1);
  readouts.cameraYaw.textContent = String(Math.round(state.cameraYaw));
  readouts.cameraPitch.textContent = String(Math.round(state.cameraPitch));
  readouts.fieldOfView.textContent = state.fieldOfView.toFixed(1);
  readouts.diskDensity.textContent = state.diskDensity.toFixed(2);
  readouts.diskSize.textContent = state.diskSize.toFixed(1);
  readouts.diskParticles.textContent = state.diskParticles.toFixed(1);
  readouts.mass.textContent = state.mass.toFixed(2);
  readouts.starDensity.textContent = state.starDensity.toFixed(1);
  readouts.integrationSteps.textContent = String(Math.round(state.integrationSteps));
  readouts.monteCarloSamples.textContent = String(Math.round(state.monteCarloSamples));
  readouts.steps.textContent = String(Math.round(state.integrationSteps));
  readouts.exposure.textContent = state.exposure.toFixed(2);
  readouts.ditherStrength.textContent = state.ditherStrength.toFixed(2);
  readouts.ditherScale.textContent = String(Math.round(state.ditherScale));
  readouts.ditherLevels.textContent = String(Math.round(state.ditherLevels));
}

function setNumericControl(key, value, digits) {
  const control = controls[key];
  const min = Number(control.min);
  const max = Number(control.max);
  state[key] = clamp(value, min, max);
  control.value = state[key];
  readouts[key].textContent = digits === 0 ? String(Math.round(state[key])) : state[key].toFixed(digits);
  if (key === "integrationSteps") {
    readouts.steps.textContent = String(Math.round(state.integrationSteps));
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
