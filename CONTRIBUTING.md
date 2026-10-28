# Contributing to YM Classic

Bug reports, fixes and features are welcome. For larger changes, open a [discussion](https://github.com/KROU4/yamusic-classic/discussions) or an issue first so we can agree on the approach.

## Requirements

- Windows 10/11 (the app targets Windows; the backend and UI build also run on Linux/macOS, which is what CI uses).
- Node.js 24 and npm.
- The **official Yandex Music app installed and logged in on the same PC**. YM Classic signs in with its session; without it the client cannot talk to Yandex.

## Setup

```bash
npm ci
```

If Electron was not downloaded (npm 11 blocks install scripts), run `npm approve-scripts electron`.

| Command | What it does |
|---|---|
| `npm start` | Builds the UI and opens the Electron window |
| `npm run dev` | Builds the UI and serves it with the backend for a regular browser; the URL with its key is printed to the console |
| `npm test` | Unit tests (vitest) |
| `npm run build` | Production UI build (`vite build`) into `dist/` |
| `npm run dist` | Installer and portable exe into `release/` |
| `node scripts/smoke.js` | Live backend check against your own session; prints summaries only, never the token |

## Project layout

```
electron/   main process: window, tray, mini player, hotkeys, autostart, updater,
            smoke/screenshot mode (YMC_SHOTS)
server/     local API on 127.0.0.1 that proxies Yandex: session lookup, request signing,
            My Wave, anti-repeat rules, uncensor, lyrics, stats, podcasts, Ynison
src/        Preact + signals UI (pages/, components/, player/, styles/)
scripts/    dev server, smoke checks, screenshot matrix, icon rendering (npx electron scripts/render-icons.cjs)
test/       vitest unit tests
```

### Screenshot runs

`YMC_SHOTS=<path to a JSON scenario>` starts the app in smoke mode with a throwaway profile and muted audio, runs the steps (window size, route, JS, wait) and saves screenshots. See `scripts/e2e.json` and `scripts/shots-matrix.js`. Use it to check UI changes at several window sizes before opening a PR.

## Conventions

- **Commits and PR titles:** [Conventional Commits](https://www.conventionalcommits.org/), e.g. `feat(ui): pin wave settings to the sidebar`, `fix: resume podcast position after restart`, `docs: ...`, `test: ...`. PRs are squash-merged, so the PR title becomes the commit message.
- **Language:** code, comments and docs in English; UI strings in Russian.
- **Secrets:** never log, commit or screenshot the OAuth token, cookies or the per-launch server key.
- **Tests:** add or update unit tests for backend logic (`server/`) and pure helpers. `npm test` and `npm run build` must pass; CI runs both on every push and PR.
- **UI changes:** attach before/after screenshots to the PR.

## Releases

Maintainers release by pushing a tag:

```bash
git tag v1.2.3
git push origin v1.2.3
```

`.github/workflows/release.yml` sets the `package.json` version from the tag, runs the tests, builds the NSIS installer and the portable exe, writes `SHA256SUMS.txt` and publishes a GitHub release with `latest.yml`, which installed copies use to update themselves. Release notes are generated from PR labels (see `.github/release.yml`); label a PR `skip-changelog` to leave it out.
