// Rule helpers are intentionally plain JavaScript. They are the easiest place to
// experiment with the personality of the simulation without touching shaders.

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function seedFromString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomMatrix(size, seed) {
  const random = mulberry32(seed);
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => {
      const bias = row === col ? -0.18 : 0;
      const curve = Math.pow(random(), 1.35) * 2 - 1;
      return clamp(curve + bias, -1, 1);
    })
  );
}

export function matrixFromPrompt(text, size) {
  const trimmed = text.trim();
  if (!trimmed) {
    return { matrix: randomMatrix(size, seedFromString("empty")), themeHint: null };
  }

  const parsed = parseJsonMatrix(trimmed, size);
  if (parsed) {
    return { matrix: parsed, themeHint: null };
  }

  const lower = trimmed.toLowerCase();
  const seed = seedFromString(trimmed);
  const matrix = randomMatrix(size, seed);

  // Prompt words act as deterministic sculpting hints. This keeps the app local
  // and free while still making prompts feel direct and repeatable.
  const tweaks = [
    { words: ["calm", "orbit", "rings", "gentle"], diagonal: -0.08, off: 0.18 },
    { words: ["hostile", "chaos", "war", "predator"], diagonal: -0.45, off: -0.1 },
    { words: ["cluster", "cells", "organic", "life"], diagonal: 0.34, off: -0.22 },
    { words: ["galaxy", "spiral", "nebula"], diagonal: -0.22, off: 0.32 },
    { words: ["crystal", "lattice", "pixel"], diagonal: -0.55, off: 0.12 },
  ];

  for (const tweak of tweaks) {
    if (tweak.words.some((word) => lower.includes(word))) {
      for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
          matrix[row][col] = clamp(matrix[row][col] + (row === col ? tweak.diagonal : tweak.off), -1, 1);
        }
      }
    }
  }

  let themeHint = null;
  if (lower.includes("ascii") || lower.includes("terminal")) themeHint = "ascii";
  if (lower.includes("pixel") || lower.includes("8-bit") || lower.includes("8 bit")) themeHint = "pixel";
  if (lower.includes("void") || lower.includes("midnight")) themeHint = "void";
  if (lower.includes("neon") || lower.includes("aurora")) themeHint = "aurora";

  return { matrix, themeHint };
}

export function parseJsonMatrix(text, size) {
  try {
    const value = JSON.parse(text);
    if (!Array.isArray(value) || !Array.isArray(value[0])) return null;
    return Array.from({ length: size }, (_, row) =>
      Array.from({ length: size }, (_, col) => clamp(Number(value[row]?.[col] ?? 0), -1, 1))
    );
  } catch {
    return null;
  }
}

export function makePalette(theme, count) {
  const palettes = {
    aurora: ["#52ffd2", "#ff72c6", "#ffe45e", "#75a7ff", "#ff8b54", "#b2ff67", "#e583ff", "#ffffff", "#69f0ff", "#ffc857"],
    pixel: ["#00ff99", "#fff700", "#ff4fd8", "#31a2ff", "#ff7a00", "#f8ffe8", "#8cff00", "#ff3355", "#7df9ff", "#b967ff"],
    ascii: ["#d8ffd2", "#a8ff78", "#fff3a3", "#72ffc8", "#ffcf8a", "#caffbf", "#f1ffde", "#92e889", "#d9ff8c", "#ffffff"],
    void: ["#78a6ff", "#ff72b6", "#6ef3ff", "#ffe082", "#b48cff", "#ff8a65", "#c5ff7a", "#ffffff", "#8ce0ff", "#ffbad9"],
  };
  const source = palettes[theme] || palettes.aurora;
  return Array.from({ length: count }, (_, index) => {
    const base = hexToRgb(source[index % source.length]);
    const spin = index / Math.max(1, count);
    return base.map((channel, axis) => clamp(channel * (0.78 + 0.32 * Math.sin(spin * 6.283 + axis * 2.1)), 0.12, 1));
  });
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}
