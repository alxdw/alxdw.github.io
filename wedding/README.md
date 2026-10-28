# Becky & Alex — save the date

Plain HTML/CSS/JS for GitHub Pages. No frontend build or dependencies. All wedding pages are marked `noindex`; `/wedding/` without a valid invitation only shows the image and access message.

## Preview

From the repository root:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

- Locked: <http://localhost:8000/wedding/save-the-date/>
- Interactive sample: <http://localhost:8000/wedding/save-the-date/?preview=1>

The sample is enabled only on `localhost`, `127.0.0.1` or `[::1]`. It uses fictional guests, has a visible preview banner, and never sends data. Adding `preview=1` on w5y.me does not unlock anything. Preview submissions are kept in memory only. Reloading returns to the welcome screen.

## Photographs and copy

Drop photographs in `wedding/assets/images/`:

- `header.jpeg`: full-width hero. Edit `.hero > img` `object-position` in `styles.css` to adjust its crop.
- `thank you.jpeg`: thank-you photograph; either orientation works.

Until present, each image uses a local SVG placeholder. Change filenames and the acceptance/decline follow-up copy in `config.js`. Caladea is self-hosted under `assets/fonts/`, with its SIL Open Font License.

## Prepare the existing Google Sheet

Spreadsheet: `1hCBZGI-zUqS1re1IkxozXr--rFxLbNvRXjlgb3XA5vk`. The code checks these tab names and headers before writing. Preserve column order. Legacy guest columns A:I and their totals are not written by the backend; **Guests!P is the live attendance field**.

1. In **Invites**, use one pre-created household ID per invitation (H0001–H0050). B is a human-readable label, C an optional greeting.
2. In **Guests!K**, assign the same household ID to each named guest on that invitation. Do not infer households from neighbouring rows or duplicate names.
3. Review **Guests!L**: this is the guest-facing name. Keep **J (Guest ID)** unchanged and unique. Keep the whole row together when sorting.
4. Set **M (Guest type)** to `Named guest` or `Plus-one`. Set **O (Plus-one offered)** to `Yes` or `No` for every named guest. `Needs review` blocks opening the invitation.
5. For each offered +1, prepare exactly one slot with its own permanent Guest ID, same household ID, M=`Plus-one`, and N equal to the parent named guest's ID. The display name may be blank. The existing “Patten plus 1” placeholder needs this parent assignment. Do not offer a +1 to a plus-one slot.
6. The backend updates **P (Attendance)**, **Q (Updated at)** and, when provided on an acceptance, the plus-one's **L (Display name)**. Unselected named guests are `Declined`; unused +1s are `Not attending`. An unused +1 does not make the household `Partial`.
7. **Responses** holds the latest household response and address, one row per household. `Yes`/`Partial`/`No` and timestamps are backend-written. A decline requires no address and clears the previously submitted address from that response row.

The backend reads actual sheet IDs and grid sizes at runtime. Add new guests with permanent IDs; never reuse an old ID. Blank/unassigned household rows cannot open a link. Avoid manually sorting/editing the guest list during live submissions: API writes are serialised, but human edits cannot participate in that lock.

## Deploy the backend

The frontend stays on GitHub Pages. The backend is a separate Cloudflare Worker with a SQLite Durable Object (one coordinator for this spreadsheet). It serialises writes and keeps idempotency receipts so retried submissions do not overwrite newer replies. Guest attendance, optional +1 names and postal response are written in one atomic Sheets batch. It stores only hashes of submitted payloads in its receipts, not addresses or tokens.

The production API is deployed at <https://becky-alex-wedding-rsvp.alex-db2.workers.dev> in the account pinned in `wrangler.toml`. Google credentials are installed as encrypted Worker secrets, and the service account has edit access to the wedding spreadsheet. A live test verified invitation lookup, acceptance, retry deduplication, decline and address clearing; all temporary test records were removed and their token revoked. Real invitation tokens still need to be issued after household assignments and eligibility are reviewed. Google Maps autocomplete needs its separate browser key.

1. In a Google Cloud project, enable the **Google Sheets API**, create a service account, and obtain a JSON key. Keep that key outside this public repository.
2. Share this one spreadsheet with the service account's email as **Editor**. Do not publish the sheet or grant domain-wide delegation.
3. Use Node 22 or newer (Node 24 LTS is suitable). The backend has its own pinned development tools; the GitHub Pages frontend still has no dependencies or build step. From `wedding/backend/`:

```sh
npm ci
npx wrangler login
npx wrangler secret put GOOGLE_CLIENT_EMAIL
npx wrangler secret put GOOGLE_PRIVATE_KEY
npx wrangler deploy
```

Paste the service account email and PEM private key at the secret prompts. Both real newlines and JSON-style `\n` escapes are supported. Do not paste credentials into the website's config. `wrangler.toml` already contains this spreadsheet ID, the namespace/migration, and `https://w5y.me` as the allowed browser origin. Add other origins only if deliberately used.

4. Put the returned Worker origin into `apiBase` in `wedding/config.js`. Until configured, real links show an unavailable message and cannot submit. Guests see thanks only after a readable `saved: true` response.
5. Publish the static changes through the repository's usual GitHub Pages workflow. No SPA fallback or routing rules are required: `wedding/save-the-date/index.html` is a real directory page.

For local backend testing, copy `.dev.vars.example` to `.dev.vars`, fill secrets, then run `npx wrangler dev`. Temporarily set `apiBase` to its printed local URL. Use a designated test household in a separate test spreadsheet, or explicitly accept that real-token tests write real responses. The preview mode never calls this backend.

The steps above describe how to reproduce or update the existing deployment. Keep service-account key files outside this repository; deployed secrets are managed separately from GitHub Pages files.

## Issue a personal link

After a household is fully prepared:

```sh
node wedding/tools/create-link.mjs H0001
```

This prints an offline-generated URL, SHA-256 token hash and issue timestamp. Put the hash into that household's **Invites!D** and timestamp into **E**; ensure **F (Link revoked?)** is false. Share the URL privately. The tool does not write the sheet or save the usable token. Keep the printed link privately if you need to resend it. Generating a new link and replacing D invalidates the old one. Checking F revokes access.

Treat the URL as a bearer credential: anyone holding it can view and update that household's response and address. Names are looked up server-side, rather than Base64-encoded into public query parameters. Invalid or missing links never receive guest data. API requests send tokens in POST bodies, not backend URLs, use `no-store`, and omit cookies. Worker diagnostics record only fixed error-event names and status codes. Automatic invocation logs are disabled, query strings are redacted, and traces are sampled at 1%; do not add names, addresses, credentials or request bodies to diagnostics.

GitHub Pages assets and source are public. The lake photograph and event copy are not access-controlled; backend guest records are. `noindex` discourages indexing, but is not authentication. Google autocomplete is loaded only after opening a valid invitation and proceeding to the address view. There are no analytics.

## Google address autocomplete

Enable **Maps JavaScript API** and **Places API (New)** with billing in Google Cloud. Create a browser key restricted to the w5y.me website and those APIs; add budget alerts/quotas. Put it in `googleMapsApiKey` in `config.js`. This browser key is intentionally public and must be restricted. The service-account private key must never appear here.

The current `PlaceAutocompleteElement` uses `gmp-select` and requests only `addressComponents`. Selected values fill editable postal fields; manual entry always works, including Google outages and countries without postcodes. UK addresses require a postcode on the server. Preserve Google's attribution in the widget.

Live address autocomplete must be tested once its browser key is configured. The Sheets backend has already been verified separately. See [Google's widget guide](https://developers.google.com/maps/documentation/javascript/place-autocomplete-new) and [key restrictions](https://developers.google.com/maps/api-security-best-practices).

## Verification

```sh
node --test wedding/backend/test/rsvp.test.mjs
```

Tests cover token isolation/revocation, eligibility and household validation, optional +1 names, partial attendance, declines, address requirements, atomic write plans, retries, serialisation, error privacy, CORS/body limits, and real cryptographic verification of the Google service-account assertion with a generated test key. They do not use real credentials or call Google.

For deployment validation and the integration test, from `wedding/backend/` with Node 22+:

```sh
npm ci
npm run check
npm run test:integration
```

The integration test compiles the production entry point with Wrangler and runs it in the actual local Worker runtime with a SQLite Durable Object. OAuth and Sheets requests are intercepted by an isolated, fictional fixture; it cannot write to Google. It checks acceptance, partial attendance, an unnamed +1, returning-guest data, duplicate submissions, failed writes, retries and declines. Temporary build/state data is removed when the test finishes.

`worker.mjs` is the Cloudflare adapter; `service.mjs` holds the portable request handling and coordinator. The Google fetch adapter is bound to its global receiver because Cloudflare's fetch rejects other receivers. This is covered by both a regression test and the runtime integration test.

Browser checks: locked page; sample accept/partial/+1/decline; back/refresh and retry behaviour; keyboard navigation; iPhone-size and desktop layouts; reduced motion. Live writes/autocomplete still require configured services.
