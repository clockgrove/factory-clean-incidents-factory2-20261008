# Synthetic support-incident explorer

This is an empty application starter with a deterministic fictional dataset. The application architecture, API, frontend structure, and implementation are deliberately open.

The qualification environment uses Node.js 24. Run `npm run seed` from this directory to create `.runtime/incidents.json`. The generator requires no packages or network access. Every invocation produces the same bytes. See `data/FIELDS.md` for the record meanings.

Keep `data/generate.mjs` and `data/FIELDS.md` unchanged. The application must treat the generated dataset as read-only. Add application code, useful verification, and startup instructions as needed. The installed browser-verification tooling and its exact command will be documented in the shared execution environment before either route begins; this starter does not claim that a browser is already installed.

## Exact shared commands

Generate the supplied canonical data:

npm run seed

Run complete verification, including meaningful application HTTP and browser checks you add:

npm test

The baseline uses Node's built-in `node:test` runner (generic `node --test` discovery). Its immutable data prerequisite runs before the test suite and installs the exact pinned development tooling with package lifecycle scripts disabled when needed. Keep the seed, pretest and test script bodies unchanged; add application verification in locations the generic Node test runner discovers. The initial passing data/tooling prerequisite is a tooling/data prerequisite, not application acceptance. Preserve `scripts/prepare.mjs` and the two `data/*` sources. Add the app, its startup instructions and meaningful real HTTP/browser verification without replacing these checks. Choose application architecture, API, UI and work breakdown freely.

Declare and implement a local startup script for this exact command, then document the actual URL/port and shutdown procedure:

npm run start

## Installed browser environment

All arms use the same pinned Playwright 1.64.0 and sandbox-enabled headless Chromium 156.0.8078.4. The provided package lock pins the Node browser tooling. Before importing Playwright for browser tests, set `PLAYWRIGHT_BROWSERS_PATH` to the provided browser directory. Use `{channel:'chromium', headless:true, chromiumSandbox:true}`; never add `--no-sandbox` or relax controls to pass a test.

The qualification host exposes the real `qualification-chromium` executable through a dedicated read-only tool prefix on PATH. Locate its alias using `command -v qualification-chromium`; the alias directory contains no application or account data. The browser directory is `../browsers` and the local library directory is `../host-libs/usr/lib/x86_64-linux-gnu` relative to that alias directory. Resolve those local tooling paths dynamically; do not hardcode a contributor workspace path in application code. Pass that library directory as `LD_LIBRARY_PATH` in Chromium's explicit child environment, with `ALSA_CONFIG_PATH` pointing to `../host-libs/usr/share/alsa/alsa.conf`. Do not assume arbitrary inherited environment variables survive worker isolation. Browser profiles and temporary files belong under the current checkout's ignored `.runtime/`; an explicit relative `TMPDIR='.runtime/browser-tmp'` (also TMP/TEMP) avoids Chromium's Linux socket-path length limit while keeping files in that workspace. Create that directory before launch, preserve the current checkout as cwd, and close the browser and any owned HTTP server in finally blocks. The controller's later shared screenshot assessment uses its independently proved short alias, retained separately.

Run actual local HTTP requests and real browser interactions against your implemented backend. Include data/sort/filter/pagination/whole-result-summary/details/export correctness and the human Objective's saved-view, keyboard, responsive, loading, empty, genuine failure and retry journeys. Do not mock or replace responses, generate screenshots of an imagined app, or treat this browser prerequisite as proof of application acceptance. Tests and app-local screenshots may use ignored `.runtime/`; commit source/verification/startup instructions, not runtime profiles or node_modules. Report an exact environment limitation if a required operation remains unavailable.

The same dedicated tool prefix also provides this actual browser/HTTP prerequisite command, after the data/tooling prerequisite has installed Playwright:

qualification-browser-smoke

It starts and closes a tiny real loopback HTTP page and sandbox-enabled Chromium, records actual process identities/launch argv and closure under ignored `.runtime/`, and reports the receipt path. It verifies the installed browser environment; it never supplies the application's behavior, design, API or passing acceptance.

## Run Incident atlas

From this checkout, run `npm run pretest` to prepare the read-only canonical data and pinned tooling, then `npm run start`. Open **http://127.0.0.1:3000**. The Node backend binds only to loopback. Press **Ctrl+C** in that terminal to close the server. No external services or accounts are used.

Search matches literal text in IDs, titles, and descriptions, ignoring capitalization. Values within each filter are alternatives; separate filters apply together. Both opened-date endpoints include their whole UTC day. Defaults are newest first, 25 rows, and no filters. Sort ties use ascending incident ID. Severity descending means critical, high, medium, low. Summaries and daily counts cover every matching record, even across pages. Open an incident to read every field; Back preserves the table and page.

Saved views stay in this browser's local storage and retain search, filters, sort, and page size. Open or delete them in the sidebar. CSV export includes all matching records in the current sort order, with every field; `tags` is a JSON array in a quoted CSV cell and unresolved `resolvedAt` is empty. Standard CSV quoting preserves commas, quotes, and multiline descriptions.

For fresh verification, run these commands in order:

```sh
npm run pretest
qualification-browser-smoke
npm test
```

The unchanged Node test command discovers `test/explorer.test.mjs`. It compares actual HTTP results, summaries, date boundaries, ties, and parsed exports with expectations independently derived from the dataset. Real sandboxed Chromium exercises filters, sorting, page sizes, details, saved views across reload, keyboard focus, narrow screens, empty/loading/error states and retry. Backend request gates hold actual requests and destroy connections to verify obsolete query, details, and export completions cannot change the current screen or Retry. This includes an export followed by failing details, and late export success while details are pending, displayed, or closed. Tests close their loopback server and browser in finally blocks. Evidence and a mobile screenshot are kept only under ignored `.runtime/`.
