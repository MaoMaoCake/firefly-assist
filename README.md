# Firefly Assist

Svelte + TypeScript companion PWA targeting Firefly III 6.7.9. No external database or application server. Run `npm install` and `npm run dev`. Validate with `npm run check`, `npm test`, and `npm run build`; deploy `dist/` to an HTTPS static host.

## Docker

With Docker and Docker Compose installed, run from this repository:

```bash
docker compose up -d --build
```

Open **http://localhost:8080** and configure your Firefly URL and PAT in Settings. To choose another port, run `PORT=8090 docker compose up -d --build`.

```bash
docker compose logs -f       # view logs
docker compose down          # stop and remove the container
docker compose up -d --build # rebuild after updating the source
```

The multi-stage image builds and checks the app with Node, then serves only the compiled static files with Nginx. No database, volumes, or PAT environment variables are needed. Settings and pending purchases remain in each browser's IndexedDB; replacing the container does not erase them. Keep the same public origin to retain access to that browser data.

For phone installation and remote use, put this container behind your HTTPS reverse proxy on a dedicated domain, forwarding to port 8080 on the Docker host (or `firefly-assist:80` from a proxy on the same Docker network). Serve at the domain root. TLS is terminated by the proxy; this container serves HTTP. Configure Firefly CORS to permit the companion's HTTPS origin. A plain LAN HTTP URL cannot provide the PWA's secure-context features.

Without Compose:

```bash
docker build -t firefly-assist:local .
docker run -d --name firefly-assist --restart unless-stopped -p 8080:80 firefly-assist:local
```

## Setup

### Browser in Docker

A dedicated [Selenium Chromium container](https://github.com/SeleniumHQ/docker-selenium)
provides automation and a live desktop without a host browser extension:

```bash
docker compose --profile firefly --profile browser up -d browser-localhost
python3 scripts/connect-browser.py
```

The connection script uses the existing ignored `.env.firefly-user.json` dummy
credentials, connects Assist through its UI, selects the dummy cash account and
checks that the preference survives reload. It does not create purchases.
The file must contain `token` and `cash` from the local fixture setup.

Open **http://localhost:7900** to view/control Chromium (VNC password: `secret`).
WebDriver is at `http://localhost:4444`; both ports bind only to host loopback.
Inside Chromium, Assist is `http://localhost:8080` and Firefly is
`http://localhost:8081`. A proxy sharing the browser network namespace routes
those addresses to the Compose services, retaining browser secure-context APIs.
No host browser profile, credentials directory, or Docker socket is mounted.

Sessions are disposable and expire after one idle hour. To reconnect after a
restart, rerun the Python script. Before starting a second session, stop and
start the browser stack (only one session is allowed):

```bash
docker compose --profile firefly --profile browser stop browser-localhost browser
docker compose --profile firefly --profile browser up -d browser-localhost
```

This is a local functional-test browser, not the fully isolated security-audit
sandbox. Keep it for dummy data; its network can reach external sites.

With a connected Docker browser session, run `python3 scripts/browser-test.py`
for the local end-to-end suite. It creates/reuses Audit Card and Audit Reserve,
links them through the UI, and writes four uniquely labeled dummy ledger entries
per successful run. It checks cash and credit purchases, zero-amount rejection,
retry duplication, transfer completion, offline queuing, reconnect and reload.
Entries are retained for inspection. The suite clears service-worker app-shell
caches in this disposable browser to load the current build, preserving IndexedDB.
Results are written to `/tmp/firefly-e2e-results.json`.

### Local Firefly test service

The optional `firefly` Compose profile provides Firefly III 6.7.9 (the version
targeted by this app) and MariaDB 11.4 with separate persistent volumes:

```bash
python3 scripts/init-firefly.py
docker compose --profile firefly up -d firefly
```

Open http://localhost:8081 and register a dummy test user. Generate a personal
access token in Firefly's profile, then connect Assist to `http://localhost:8081`
with that token. Use the same single Firefly user in this browser; switching
users with queued purchases is not supported. Start Assist separately with
`docker compose up -d --build firefly-assist` and open http://localhost:8080.

The initializer preserves an existing `.env.firefly`; newly generated files are
owner-readable/writable and ignored by Git. Preserve this file along with the
volumes across restarts. Firefly binds only to loopback, the database has no host
port, and the database is isolated on an internal network. Firefly also uses a
bridge network for its localhost port. This is a
local fixture for dummy data, not a production deployment or the full audit
execution sandbox. No cron or email delivery is configured.

Check status with `docker compose --profile firefly ps`; stop the fixture with
`docker compose --profile firefly stop firefly firefly-db`. Stopping retains data.
The existing `scripts/live-test.ts` targets a remote demo; do not use it for this
local fixture. Startup verification returned HTTP 302 from Firefly and HTTP 204
for a GET API preflight from `http://localhost:8080`, allowing Authorization and
Content-Type. Authenticated browser flows still need validation after registration.

Configuration follows the [official Firefly Docker example](https://github.com/firefly-iii/docker/blob/main/docker-compose.yml)
and [6.7.9 environment reference](https://github.com/firefly-iii/firefly-iii/blob/v6.7.9/.env.example).

In Settings enter the Firefly base URL and personal access token. Your Firefly server/reverse proxy must allow the PWA's exact origin, Authorization and Content-Type headers, and GET/POST/PUT/OPTIONS methods through CORS. Never embed the PAT into deployed assets. The PAT is stored in IndexedDB on this device, accessible to scripts on this origin. Use a dedicated trusted origin.

Select one primary cash asset. Purchases omit the destination account; Firefly uses its internal cash account for the blank withdrawal destination. Link existing credit liabilities to separate savings assets. Links live in a versioned `[firefly-assist]` JSON block in liability notes; other notes are preserved. Account preferences are local to each device. Purchases use the current time and a single currency. Negative balances are allowed.

## Offline and retries

The service worker caches the app shell after the first successful online load. Accounts and the purchase queue are in IndexedDB. Each purchase is persisted before any network calls. Sync runs on opening the app and after online saves; the Sync / retry button retries manually. Web Locks serialize sync across tabs. Each credit purchase has independently persisted withdrawal and reserve-transfer components. Firefly rules and webhooks are disabled for these writes to preserve the intended accounting.

Stable UUID component identifiers are stored in both transaction notes and external_id. Before posting, sync searches Firefly for that external_id and verifies notes; duplicate hash rejection is also requested. Ambiguous POST failures are never blindly resubmitted: later retries reconcile by searching again. If an uncertain write never appears, the queue remains blocked for manual investigation in Firefly. This favors avoiding duplicates over automatic recovery. There is no claim of server-enforced exactly-once delivery. Clearing browser data loses unsynced purchases. Different devices have independent queues.

Live API integration was verified on the supplied Firefly demo deployment on 2026-11-16: cash withdrawal, liability withdrawal, savings transfer, account-note linking, and reconciliation after simulated lost acknowledgements passed. Cross-origin GET/POST/PUT preflights passed. Browser offline/install behavior still needs end-to-end validation. Refunds, repayments, multi-currency, account creation, and editing/deleting recorded purchases are outside v1.


## Repeat the demo integration test

`node --import tsx scripts/live-test.ts` prompts for the demo PAT without storing it. This is a **live write test**: it reuses or creates a named TEST reserve account, links CREDIT CARD to the test reserve, and creates one 0.01 cash purchase plus one 0.01 credit purchase (two entries). Withdrawals leave the destination blank for Firefly to resolve. It leaves those labeled entries for inspection and tests reconciliation without duplicate POSTs. Do not run it against a production account.


## Manual savings transfers

Credit purchases still record both ledger entries in Firefly. The reserve transfer's notes contain `firefly-assist.transferred: false`. The Transfers tab lists companion reserve transfers from Firefly across all pages; after moving the money in your bank, Mark transferred updates the existing notes to `true`. No additional ledger transaction is created. Loading and marking require an internet connection. Older companion reserve transfers without the flag appear as completion unknown and can also be marked. Other transfers are excluded.


## Install on a device

Build with `npm run build` and serve `dist/` from an HTTPS static host at the domain root. The app includes a standalone manifest, 192/512 PNG icons, an Apple touch icon, and a precaching service worker. Installation is under Settings: supported Chromium browsers show Install app when the browser offers an install prompt. On iPhone/iPad use Safari → Share → Add to Home Screen (enable Open as Web App if shown); on Mac Safari use File → Add to Dock.

For local desktop testing, run `npm run build` then `npm run preview` and open http://localhost:4173. The development server does not enable the production service worker. For installation on a phone, use an HTTPS deployment: `http://192.168.x.x` is not a secure context. Open once online to cache the app before using it offline. The Firefly server URL is the API connection; the companion PWA needs its own HTTPS hosting. No native app store or database is required.

## Appearance and faster Transfers

Settings → Appearance offers System/Light/Dark modes and six Material 3-inspired accent palettes, persisted per browser using localStorage. Standalone PWAs cannot read Android wallpaper-derived colors, so accent selection is manual. The status-bar theme meta color follows the chosen mode where the browser supports it.

Transfers stores the last successful Firefly response in IndexedDB, scoped to the instance URL and a SHA-256 hash of its PAT. Cached transfers appear immediately while an online refresh runs; an offline copy is for viewing only and may be outdated. A successful completion removes its entry from the local cache. Refresh still reads Firefly transfer history because the companion metadata cannot be filtered server-side, but pages are now fetched with up to four in flight.

## Cyan UI refresh

The default accent is the Firefly Assist brand color `#00A3CE`. The interface now uses responsive tonal surfaces, high-contrast text on cyan controls, rounded navigation, elevated activity panels, and compact mobile forms. Existing browser appearance preferences continue to work; users who selected another accent keep their choice.
