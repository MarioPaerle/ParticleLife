# ParticleLife

ParticleLife is a free, local, hardware-accelerated WebGL2 particle-life simulator. It runs entirely in the browser with no build step, no paid APIs, and no network dependency after the files are loaded.

The simulation stores particle positions, velocities, rule matrices, and palettes on the GPU. A fragment shader updates the ecosystem each frame, and a point-rendering shader draws glowing particles, pixel-style particles, or an ASCII-inspired view.

## Features

- GPU-accelerated particle simulation with WebGL2 floating-point textures.
- Random rule generation.
- Prompt-based deterministic rule generation.
- JSON rule-matrix import through the prompt field.
- Editable rule matrix with attraction and repulsion values.
- Up to 50,000 particles.
- Up to 75 particle types with a scrollable 75x75 rule matrix.
- Adjustable simulation speed, neighbor density, interaction sample budget, interaction radius, movement randomness, friction, glow, particle size, and connection-line rendering.
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
- `Neighbor density`: target average number of particles inside one interaction-radius disk. Raising it packs more particles into the force neighborhood; lowering it expands the wrapped world.
- `Types`: number of particle species.
- `World size`: size of the wrapped 2D simulation plane.
- `Camera zoom`: visible scale of the world.
- `Speed`: simulation-time multiplier. Speed is integrated through fixed substeps so high speed behaves more like faster time and less like a different ODE.
- `Interaction samples`: number of particles sampled per particle while computing forces. This keeps high particle counts responsive by approximating all-pairs forces with a rotating GPU sample set.
- `Interaction radius`: maximum distance for pairwise forces.
- `Motion randomness`: stochastic jitter added to particle movement.
- `Friction`: velocity damping.
- `Glow`: visual glow intensity.
- `Particle size`: rendered point size.
- `Connection lines`: toggles capped particle-to-particle line rendering.
- `Line cap`: maximum number of candidate line segments rendered per frame.
- `Line radius`: maximum distance for a line to appear.
- `Line opacity`: line alpha multiplier.
- `Line width`: screen-space thickness for visible GPU-rendered connection bands.
- `Line color mode`: blended particle colors, source particle color, or attraction/repulsion rule color.
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

At high type counts, the rule matrix is uploaded as a GPU texture instead of a shader uniform array. This keeps 75x75 rules practical in WebGL2.

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

Particle Life is pairwise by nature: each particle may inspect every other particle. This implementation avoids CPU bottlenecks by keeping the update loop on the GPU. For very large counts, it uses a rotating interaction sample budget to approximate all-pairs forces while keeping the browser responsive.

`Neighbor density` is computed from the expected number of particles inside a particle's interaction disk:

```text
neighbor density = particle_count * pi * interaction_radius^2 / world_size^2
```

Changing neighbor density adjusts world size while keeping particle count and interaction radius visible as independent controls. Changing world size directly recalculates the displayed neighbor density.

The particle slider reaches 50,000. The interaction loop is capped at 8,192 samples per particle for broad WebGL2 compatibility; use `Interaction samples` to trade accuracy for speed.

Connection lines are also capped. They are sampled on the GPU, fade with distance, and are rendered as thin triangle bands instead of driver-dependent `gl.LINES`, so they remain visible while avoiding every possible pair.

`Speed` does not increase the shader timestep directly. Instead, the app accumulates simulation time and advances the ODE in fixed `1/120s` substeps, capped per rendered frame. This keeps high speed more stable than a single large Euler step.

## License

MIT License. See `LICENSE`.
