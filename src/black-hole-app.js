import { BlackHoleRenderer } from "./black-hole-renderer.js?v=20260624";

const canvas = document.querySelector("#blackHoleCanvas");
const controls = {
  cameraDistance: document.querySelector("#cameraDistance"),
  fieldOfView: document.querySelector("#fieldOfView"),
  diskInclination: document.querySelector("#diskInclination"),
  diskDensity: document.querySelector("#diskDensity"),
  integrationSteps: document.querySelector("#integrationSteps"),
  exposure: document.querySelector("#exposure"),
  ditherStrength: document.querySelector("#ditherStrength"),
  ditherMode: document.querySelector("#ditherMode"),
};

const readouts = {
  fps: document.querySelector("#fps"),
  steps: document.querySelector("#stepsReadout"),
  cameraDistance: document.querySelector("#cameraDistanceValue"),
  fieldOfView: document.querySelector("#fieldOfViewValue"),
  diskInclination: document.querySelector("#diskInclinationValue"),
  diskDensity: document.querySelector("#diskDensityValue"),
  integrationSteps: document.querySelector("#integrationStepsValue"),
  exposure: document.querySelector("#exposureValue"),
  ditherStrength: document.querySelector("#ditherStrengthValue"),
};

const state = {
  cameraDistance: Number(controls.cameraDistance.value),
  fieldOfView: Number(controls.fieldOfView.value),
  diskInclination: Number(controls.diskInclination.value),
  diskDensity: Number(controls.diskDensity.value),
  integrationSteps: Number(controls.integrationSteps.value),
  exposure: Number(controls.exposure.value),
  ditherStrength: Number(controls.ditherStrength.value),
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

for (const [key, digits] of [
  ["cameraDistance", 1],
  ["fieldOfView", 1],
  ["diskInclination", 0],
  ["diskDensity", 2],
  ["integrationSteps", 0],
  ["exposure", 2],
  ["ditherStrength", 2],
]) {
  controls[key].addEventListener("input", () => {
    state[key] = Number(controls[key].value);
    readouts[key].textContent = digits === 0 ? String(Math.round(state[key])) : state[key].toFixed(digits);
    if (key === "integrationSteps") {
      readouts.steps.textContent = String(Math.round(state.integrationSteps));
    }
  });
}

controls.ditherMode.addEventListener("input", () => {
  state.ditherMode = Number(controls.ditherMode.value);
});

window.addEventListener("resize", () => renderer.resize());

function syncUi() {
  readouts.cameraDistance.textContent = state.cameraDistance.toFixed(1);
  readouts.fieldOfView.textContent = state.fieldOfView.toFixed(1);
  readouts.diskInclination.textContent = String(Math.round(state.diskInclination));
  readouts.diskDensity.textContent = state.diskDensity.toFixed(2);
  readouts.integrationSteps.textContent = String(Math.round(state.integrationSteps));
  readouts.steps.textContent = String(Math.round(state.integrationSteps));
  readouts.exposure.textContent = state.exposure.toFixed(2);
  readouts.ditherStrength.textContent = state.ditherStrength.toFixed(2);
}
