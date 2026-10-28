// Builds a smoke-mode spec that screenshots the main screens at the window sizes Windows snapping produces
// on a 1080p display (plus a small laptop window). Usage:
//   node scripts/shots-matrix.js <out-dir> > spec.json && YMC_SHOTS=spec.json npx electron .
// Smoke mode is muted and isolated (see electron/main.js), so this is safe to run while the app is in use.
const out = (process.argv[2] || "shots").replace(/\\/g, "/");

const SIZES = {
  full: [1920, 1032], // maximized
  half: [960, 1032], // snapped left/right
  quarter: [960, 516], // snapped to a corner
  third: [640, 1032], // snap layouts, thirds
  laptop: [1280, 720],
};

const wait = (ms) => `await new Promise((r) => setTimeout(r, ${ms}));`;
const SCREENS = [
  { name: "home", hash: "#/", js: `if (!document.querySelector('.play-main [d^="M7 5h3.5"]')) document.querySelector('.vibe-title')?.click(); ${wait(5000)}` },
  { name: "album", hash: "#/album/3389008" },
  { name: "collection", hash: "#/collection" },
  { name: "podcasts", hash: "#/podcasts" },
  { name: "stats", hash: "#/stats" },
  { name: "settings", hash: "#/settings" },
  { name: "nowplaying", hash: "#/", js: `document.querySelector('.player-cover')?.click(); ${wait(1200)}`, after: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));` },
];

const steps = [];
for (const [size, wh] of Object.entries(SIZES)) {
  steps.push({ size: wh, wait: 300 });
  for (const s of SCREENS) {
    steps.push({ hash: s.hash, wait: 2500, js: s.js ? `${s.js} return 1` : undefined, file: `${out}/${size}-${s.name}.png` });
    if (s.after) steps.push({ js: `${s.after} return 1`, wait: 300 });
  }
}
// leave playback paused at the end
steps.push({ js: `if (document.querySelector('.play-main [d^="M7 5h3.5"]')) document.querySelector('.play-main').click(); return 1`, wait: 200 });
process.stdout.write(JSON.stringify(steps, null, 1));
