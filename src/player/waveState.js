// Current My Wave settings, shared by the player engine (which knows what the server actually started)
// and the UI (hero, settings panel, sidebar pins). null until loaded from the server.
import { signal } from "@preact/signals";

export const DEFAULT_WAVE_SETTINGS = { activity: "any", diversity: "default", moodEnergy: "all", language: "any" };

export const waveSettings = signal(null);

/**
 * Counter of local edits in the settings panel. A wave start remembers it and does not overwrite
 * the chips with its (older) settings if the user changed them while the request was in flight.
 */
export const waveEdits = { gen: 0 };

export function setWaveSettings(s) {
  waveSettings.value = { ...DEFAULT_WAVE_SETTINGS, ...(s || {}) };
}

/** A settings change made by the user in the UI. */
export function editWaveSettings(s) {
  waveEdits.gen++;
  setWaveSettings(s);
}

const KEYS = Object.keys(DEFAULT_WAVE_SETTINGS);
/** Same settings after filling in defaults (missing keys are the defaults). */
export function sameWaveSettings(a, b) {
  const x = { ...DEFAULT_WAVE_SETTINGS, ...(a || {}) };
  const y = { ...DEFAULT_WAVE_SETTINGS, ...(b || {}) };
  return KEYS.every((k) => x[k] === y[k]);
}
