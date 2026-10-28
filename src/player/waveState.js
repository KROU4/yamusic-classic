// Current My Wave settings, shared by the player engine (which knows what the server actually started)
// and the UI (hero, settings panel, sidebar pins). null until loaded from the server.
import { signal } from "@preact/signals";

export const DEFAULT_WAVE_SETTINGS = { activity: "any", diversity: "default", moodEnergy: "all", language: "any" };

export const waveSettings = signal(null);

export function setWaveSettings(s) {
  waveSettings.value = { ...DEFAULT_WAVE_SETTINGS, ...(s || {}) };
}
