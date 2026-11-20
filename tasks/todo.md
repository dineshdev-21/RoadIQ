# RoadIQ redesign: Hallmark full redesign + frontend migration

Request: `/hallmark redesign` the whole project and its framework for efficiency.
Answers: migrate the frontend to a component framework · full recomposition · utilitarian tone. Plan approved.

## Picks (Hallmark v2.0.0)

- **Redesign** · full · 1 app screen (`/`) · scope app
- **Before** · Floor 38 FAIL · Reflex 5 · a dark neon console: 18 emoji icons, tracked-caps labels, glow cards, no focus rings, page scrolls sideways on phones. The map-beside-feed split and the severity equation panel work and stay.
- **Keeps** · every API endpoint and payload field the edge units post · all 8 fields (search, severity, class, ward, basemap, status, crew, notes) and both links · the corridor figures already on screen (87 ms, 94.3%, 4.1%, 12 km, r = 0.87), carried over as found for the owner to verify
- **Theme** · Furrow, dealt 2/3 (manila paper, ink rules, Red Hat Display/Text with Red Hat Mono for figures, one tangerine signal, green for "in date"). Waived: its "no map tiles" rule, because the map is the real GIS and has to stay.
- **Screen** · top bar (wordmark, corridor, live status, UTC clock, Simulate, Export) · ruled stat strip · **the repair queue** (ruled ledger sorted by severity, with tabs, search and filters) beside the map · inspection opens as a notebook card docked over the map instead of a modal · states: loading skeleton, empty with "Clear filters", error with "Retry"
- **Signature** · the repair queue: each row is a severity numeral, the road, depth in cm, cars confirmed, status, and the time

## Framework (efficiency)

Frontend: **Vite + Preact + TypeScript**; Leaflet and leaflet.heat as npm deps instead of CDN tags. The build goes into `static/` and is committed, so `uvicorn server:app` still works without Node.

Measured before: `GET /api/alerts?limit=200` = 292 KB, of which 228 KB is dashcam SVGs only the inspection uses.

- [x] Backend: list, GeoJSON, CSV and WebSocket broadcasts drop `image_base64` and carry `has_image`; `GET /api/alerts/{id}` keeps the image, fetched on inspection open
- [x] Backend: GZip middleware; `get_stats` as one query instead of 11
- [x] Frontend: keyed marker updates; heat layer only while visible
- [x] Frontend: JSX escaping replaces raw `innerHTML` (XSS via road names from the unauthenticated POST)
- [x] Frontend: handle `UPDATED_CONFIRMATION` and `DELETE_ALERT` live events; WS reconnect with backoff
- [x] Frontend: filters and tab in the URL
- [x] Tests: pytest (lean list, detail with image); vitest (filter and counter logic)
- [x] Sweep: sloplint `--render --kept` to 0 FAIL; adversarial review; re-measure payload

## Files

- edit: `server.py`, `database.py`, `README.md`, `.gitignore`
- create: `web/` (Vite app source), `tests/test_api.py`, `requirements-dev.txt`, `tasks/todo.md`
- replace: `static/index.html`, `static/css/style.css`, `static/js/app.js` deleted; Vite build output takes their place in `static/`
- untouched: `models.py`, `severity.py`, `seed_data.py`; `roadiq.db` restored after verification

## Review

- **Payload:** `GET /api/alerts?limit=200` was 292 KB, now 65 KB raw (−78%) and 6.7 KB gzipped (−98%). Dashcam frames (~6 KB each) load only when a report opens.
- **Stats:** one SQL query instead of 11.
- **Bundle:** 70 KB gzipped JS (Leaflet, heat and cluster plugins included; these were CDN tags before), 12 KB CSS.
- **Hallmark sweep:** before, 38 FAIL and 5 Reflex; after, 0 FAIL and 0 open Reflex (39b waived for queue rows). Before and after are side by side in `.hallmark/compare.html`.
- **Kept:** both links, all 8 field ids, every endpoint. The work-order fields render inside the inspector once a report opens. The README figures (87 ms, 94.3%, 4.1%, r = 0.87, 12 km) are carried over as found: verify them.
- **Fixed along the way:** XSS through `innerHTML` with alert fields; `UPDATED_CONFIRMATION` and `DELETE_ALERT` live events were ignored; the page scrolled sideways on phones; no focus rings; stale index caching; overlapping pins (now clustered).
- **Adversarial review** (3 lenses plus 1 skeptic): 6 confirmed, all fixed. Stale form overwrote another operator's status (now syncs untouched fields and PATCHes only changed ones; verified in the browser); a save in flight reported under the next report (inspector keyed per report); "Zoom to it" landed under the card; no resync after a socket reconnect; a pin click didn't scroll the queue; a de-duplicated simulated hit gave no feedback. 1 refuted.
- **Tests:** pytest 10/10 (API contract), vitest 10/10 (queue logic).
- **Not done:** no end-to-end browser test suite; the live flow (simulate, toast, save) was checked by hand in the browser.

## Merge with collaborators' main (8 PRs, #1 to #7)

- **Kept from main:** ML road-risk module (`ml/`, `POST /api/predict-risk`), ward analytics and SLA tracking (`GET /api/analytics/wards`, SLA fields on every alert), export filters, the single-query stats from #5 (kept instead of mine, which was the same change), and every test.
- **Conflicts:** `.gitignore` (kept both), `database.py` (`LIST_COLUMNS` plus their `row_to_dict(now=...)`; their stats query), `tests/test_api.py` (theirs kept; mine moved to `tests/test_payloads.py`), old `static/` files (replaced by the Preact build).
- **Ported to Preact:**
  - an Overdue tab and SLA chips on queue rows
  - a repair-window block in the report card
  - a predicted-risk section, with a not-trained state
  - a ward analytics drawer: health, compliance, severity mix, pipeline, ward table (click to filter), SLA watchlist
  - filtered CSV export
  - a Normal Road class and an SVG favicon
- **Fixed in their code:** the ML import guard caught only `ImportError`; a missing OpenMP runtime raises `XGBoostError`, which crashed the server. It now falls back to "prediction unavailable".
- **Checks:** pytest 50 passed; `tests/test_prediction.py` was not run because it needs `brew install libomp` on macOS. vitest 12 passed. Sweep 0 FAIL.
- **Not verified:** the predicted-risk section with a trained model (no model and no libomp on this machine).
