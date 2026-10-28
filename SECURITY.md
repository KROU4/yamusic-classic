# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 1.x (latest release) | Yes |
| < 1.0 | No, please update |

Only the latest release receives fixes. Installed copies update themselves from GitHub Releases.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through GitHub:
[Report a vulnerability](https://github.com/KROU4/yamusic-classic/security/advisories/new).

Include the version, steps to reproduce and the impact you see. Do not include your own Yandex token or cookies.

## Scope

In scope:

- **Local API server** (`server/`, bound to `127.0.0.1`): access without the per-launch key, Host/Origin check bypasses, DNS rebinding, requests from web pages or other local users reaching it.
- **Token handling**: the Yandex OAuth token is read from the official app's session and stays inside the local server process; it is never sent to the UI, written to logs or sent anywhere except Yandex's own API. Anything that leaks it is in scope.
- **Electron shell** (`electron/`): renderer escapes, the preload bridge, navigation or `window.open` to untrusted origins.
- **Update channel**: electron-updater fetching `latest.yml` and installers from GitHub Releases, and the release workflow that produces them.

Out of scope: vulnerabilities in Yandex services themselves, the official Yandex Music app, or issues that require an attacker who already controls the user's Windows account.

## What to expect

- Acknowledgement within 7 days.
- An assessment and a fix plan within 30 days for confirmed issues.
- A fixed release, followed by a published advisory crediting you unless you prefer otherwise.
