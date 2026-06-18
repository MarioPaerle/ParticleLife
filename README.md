# ParticleLife

ParticleLife is a free, local, hardware-accelerated WebGL2 particle-life simulator. It runs entirely in the browser with no build step, no paid APIs, and no network dependency after the files are loaded.

The simulation stores particle positions, velocities, rule matrices, and palettes on the GPU. A fragment shader updates the ecosystem each frame, and a point-rendering shader draws glowing particles, pixel-style particles, or an ASCII-inspired view.

## Features

- GPU-accelerated particle simulation with WebGL2 floating-point textures.
- Random rule generation.
- Prompt-based deterministic rule generation.
- JSON rule-matrix import through the prompt field.
- Editable rule matrix with attraction and repulsion values.
- Up to 8,192 particles.
- Up to 50 particle types with a scrollable 50x50 rule matrix.
- Adjustable simulation speed, interaction radius, movement randomness, friction, glow, and particle size.
- Adjustable wrapped 2D world size.
- Camera zoom, mouse-wheel zoom, and click-drag panning.
- Themes: Aurora, Pixel Core, ASCII, and Void.
- No dependencies, no bundler, no install step.

## Run Locally

From this folder:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:4173/
```

You can also serve it with any static-file server.

## Platform Support

ParticleLife is not macOS-only. It is a static browser app and should run on any operating system with a modern browser that supports WebGL2 and floating-point render targets.

Supported targets include:

- macOS with Chrome, Edge, Firefox, or recent Safari versions.
- Windows with Chrome, Edge, or Firefox.
- Linux with Chrome, Chromium, or Firefox.
- Some Android browsers, depending on browser and GPU WebGL2 support.

The local run command uses Python's built-in static server, but any static-file server works. You can host ParticleLife on GitHub Pages, Netlify, Vercel, nginx, Apache, or any equivalent static hosting service.

## Controls

- `Particles`: number of simulated particles.
- `Types`: number of particle species.
- `World size`: size of the wrapped 2D simulation plane.
- `Camera zoom`: visible scale of the world.
- `Speed`: integration speed multiplier.
- `Interaction radius`: maximum distance for pairwise forces.
- `Motion randomness`: stochastic jitter added to particle movement.
- `Friction`: velocity damping.
- `Glow`: visual glow intensity.
- `Particle size`: rendered point size.
- Drag the canvas to pan.
- Use the mouse wheel over the canvas to zoom.
- Use `Center View` to reset the camera.

## Rule Matrix

The rule matrix is indexed as:

```js
matrix[actorType][neighborType]
```

- Positive values attract.
- Negative values repel.
- Values should stay between `-1` and `1`.

You can paste JSON directly into the prompt field:

```json
[[0.2, -0.7], [0.8, -0.1]]
```

If you type prose instead, ParticleLife hashes the prompt into a deterministic random matrix and applies local word hints such as `calm`, `orbit`, `hostile`, `galaxy`, `pixel`, and `ascii`. This is intentionally offline and free: no external model or service is called.

At high type counts, the rule matrix is uploaded as a GPU texture instead of a shader uniform array. This keeps 50x50 rules practical in WebGL2.

## Project Structure

```text
.
├── index.html
├── styles.css
└── src
    ├── app.js
    ├── gpu-particle-life.js
    └── rules.js
```

- `src/gpu-particle-life.js`: WebGL2 engine, GPU state textures, shaders, rendering, camera transform, and ASCII rendering.
- `src/rules.js`: seeded randomness, prompt parsing, matrix generation, and palettes.
- `src/app.js`: UI state, controls, theme switching, camera gestures, and matrix editor wiring.
- `styles.css`: layout and visual themes.

## Performance Notes

Particle Life is pairwise by nature: each particle may inspect every other particle. This implementation avoids CPU bottlenecks by keeping the update loop on the GPU, but the interaction cost is still roughly `O(n^2)`.

The shader loop is capped at 8,192 particles for broad WebGL2 compatibility. Raising the particle cap requires updating both the UI range and the shader loop bound in `src/gpu-particle-life.js`.

## License

MIT License. See `LICENSE`.
