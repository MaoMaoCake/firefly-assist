# Firefly Assist

Svelte + TypeScript companion PWA targeting Firefly III 6.7.9. No external database or application server. Run `npm install` and `npm run dev`. Validate with `npm run check`, `npm test`, and `npm run build`; deploy `dist/` to an HTTPS static host.

## Setup

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
