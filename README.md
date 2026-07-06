# Shop Management Prototype

A minimal full-stack prototype covering four modules: **Inventory**, **Sales Orders**,
**Purchase Orders**, and **Daily Transactions**.

No authentication — single user, open access. Not production-hardened; this is a prototype.

Built and verified by a three-agent workflow: a Developer Agent wrote the code, a Tester
Agent found 3 bugs (negative-number validation gaps on Inventory, and a missing Edit UI),
the Developer Agent fixed them, the Tester Agent independently re-verified with a full
regression pass (no bugs found), and a Judge Agent reviewed the code against the original
requirements and approved it as ready to hand off.

## Tech stack

- **Backend**: Node.js + Express, using `firebase-admin` talking ONLY to a local
  **Firestore Emulator** (no real Firebase project, no billing, no login).
- **Emulator**: `firebase-tools` (installed as a dev dependency), Firestore emulator
  on port **8090**, Emulator UI on port **4010**. Project id: `demo-shop-management`.
- **Frontend**: React + Vite, calling the backend via plain `fetch`. Plain CSS, no UI
  framework. Dev server proxies `/api/*` to the backend.

## Ports

| Service                    | Port |
|-----------------------------|------|
| Firestore Emulator          | 8090 |
| Firestore Emulator UI       | 4010 |
| Backend (Express API)       | 4000 |
| Frontend (Vite dev server)  | 5173 |

## One-time setup

From the project root:

```sh
npm run install:all
```

This installs the root dev dependency (`firebase-tools`), the `server` dependencies,
and the `client` dependencies.

## Running the app (3 terminals, in this order)

**Terminal 1 — start the Firestore emulator:**

```sh
npm run emulator
```

Wait until you see `All emulators ready!`. The emulator UI is at http://localhost:4010.
On first run this downloads the real Firestore emulator binary — this requires normal
internet access and a Java runtime (JRE 11+) on your machine. Firestore data lives only
in memory for the life of the emulator process (it resets every time you restart it,
unless you pass `--export-on-exit`/`--import` flags yourself).

**Terminal 2 — start the backend (after the emulator is up):**

```sh
npm run server
```

This starts the Express API on http://localhost:4000 and connects to the emulator via
the `FIRESTORE_EMULATOR_HOST` environment variable (defaults to `localhost:8090`,
see `server/firestore.js`). You should see:

```
Shop Management server listening on http://localhost:4000
Connected to Firestore emulator at localhost:8090
```

**Terminal 3 — start the frontend:**

```sh
npm run client
```

Open http://localhost:5173 in your browser. The Vite dev server proxies `/api/*`
requests to the backend on port 4000 (see `client/vite.config.js`), so the React app
never needs to know the backend's host directly.

### Stopping everything

Press `Ctrl+C` in each of the three terminals (frontend, backend, emulator).

## Project layout

```
shop-management-app/
  firebase.json          Firestore emulator config (ports 8090 / UI 4400)
  .firebaserc             Project alias -> demo-shop-management
  firestore.rules         Open rules (emulator only, no real project ever touches this)
  firestore.indexes.json  Empty indexes file required by firebase.json
  package.json            Root scripts: emulator / server / client / install:all
  server/                 Express app
    index.js              App entry point, mounts routes, error handling
    firestore.js          Initializes firebase-admin against the emulator only
    routes/
      inventory.js
      salesOrders.js
      purchaseOrders.js
      transactions.js
  client/                 Vite + React app
    src/
      main.jsx
      App.jsx             Top nav + routes
      api.js              fetch() wrapper for the REST API
      App.css
      pages/
        Inventory.jsx
        SalesOrders.jsx
        PurchaseOrders.jsx
        Transactions.jsx
```

## REST API contract

All responses are JSON. All errors are `{ "error": "message" }` with an appropriate
HTTP status code (400 / 404 / 500).

### Inventory

- `GET /api/inventory` — list all products. Each item includes a computed
  `isLowStock: quantity <= lowStockThreshold`.
- `POST /api/inventory` — body `{ sku, name, category, quantity, unitPrice, lowStockThreshold }`.
  Rejects negative `quantity`/`unitPrice`/`lowStockThreshold` with 400 (0 is allowed).
- `PUT /api/inventory/:id` — partial update, same fields/validation as above.
- `DELETE /api/inventory/:id`.

The Inventory page in the UI has a full Edit flow (inline edit row with Save/Cancel) in
addition to Add and Delete.

### Sales Orders

Line items support a per-item `discountPercent` (0-100) and the order supports an overall
`taxPercent` (0-100). `paymentMethod` is one of `cash` | `card` | `upi` | `credit`; a
`credit` sale doesn't create a `cash_in` transaction at all — it starts `unpaid` with the
full `total` as `amountDue`, and cash only moves in when a payment is recorded.

- `GET /api/sales-orders` — list all orders (most recent first).
- `GET /api/sales-orders/:id` — full detail with line items.
- `POST /api/sales-orders` — body
  `{ customerName, paymentMethod, taxPercent, items: [{ productId, qty, discountPercent }] }`.
  Validates stock for every line item first; if any item doesn't have enough stock,
  the whole order is rejected with `400` and a message naming the insufficient
  product, with **no partial inventory decrement** even if only one of several line
  items is short. On success: decrements inventory quantities, computes each line's
  `unitPrice` from current inventory, applies the discount/tax to get `subtotal` /
  `discountTotal` / `taxAmount` / `total`, saves the order with `status: "completed"`,
  and — unless `paymentMethod` is `credit` — creates a Daily Transaction
  `{ type: "cash_in", amount: total, note: "Sales order <id> (<paymentMethod>)" }`.
- `PATCH /api/sales-orders/:id` — metadata-only edit, body `{ customerName }`. Always
  allowed; fixes a typo without touching inventory or cash.
- `PUT /api/sales-orders/:id` — full edit (customer, items, discount, tax, payment
  method), same body shape as `POST`. Only allowed while `status: "completed"` and,
  if the order is `credit`, only before any payment has been recorded (400 otherwise —
  cancel and re-create instead). Restocks the original items, re-validates and applies
  the new items, and replaces the original cash transaction (if any) with a fresh one
  for the corrected total.
- `POST /api/sales-orders/:id/return` — body `{ items: [{ productId, qty }] }`. Partial
  or full return of specific line items (can't exceed what's still outstanding per
  line). Restocks the returned quantities and settles the refund: reduces `amountDue`
  for `credit` orders (issuing a `cash_out` for any already-paid excess), or issues a
  `cash_out` refund directly for already-paid orders. Sets `status` to
  `partially_returned` or `returned`.
- `POST /api/sales-orders/:id/cancel` — returns every remaining (not yet returned) line
  item in one shot via the same settlement logic as `/return`, and sets
  `status: "canceled"`.
- `POST /api/sales-orders/:id/payments` — body `{ amount }`. Records a customer payment
  against an order's outstanding `amountDue` (e.g. a credit sale), creating a `cash_in`
  transaction and moving `paymentStatus` toward `paid`.

### Purchase Orders

Same discount/tax/payment-method shape as Sales Orders, but on the supplier side:
`discountPercent` per line, order-level `taxPercent`, and `paymentMethod` decided at
creation time. Inventory and cash effects still only happen at receive time, not at
creation — a `credit` purchase order increments inventory on receive but does **not**
create a `cash_out` transaction until a payment is recorded.

- `GET /api/purchase-orders` — list all orders.
- `POST /api/purchase-orders` — body
  `{ supplierName, paymentMethod, taxPercent, items: [{ productId, qty, cost, discountPercent }] }`.
  Saved with `status: "pending"`; inventory is **not** changed yet.
- `PUT /api/purchase-orders/:id` — full edit, same body shape as `POST`. Only allowed
  while `status: "pending"` (before receipt, nothing needs to be reversed).
- `POST /api/purchase-orders/:id/cancel` — only allowed while `status: "pending"`; sets
  `status: "canceled"`.
- `PATCH /api/purchase-orders/:id/receive` — increments inventory quantities by the
  ordered qty, sets `status: "received"`, and — unless `paymentMethod` is `credit` —
  creates a Daily Transaction `{ type: "cash_out", amount: total, note: "Purchase order <id>" }`.
  A `credit` order instead starts `unpaid` with the full `total` as `amountDue`.
  Rejects with `400` if not currently `pending`, `404` if the order doesn't exist.
- `POST /api/purchase-orders/:id/payments` — body `{ amount }`. Records a payment to the
  supplier against a `received` order's outstanding `amountDue`, creating a `cash_out`
  transaction.

### Daily Transactions

- `GET /api/transactions?date=YYYY-MM-DD` — `date` is optional (omit for all
  transactions). Returns `{ transactions: [...], summary: { totalIn, totalOut, net } }`,
  with the summary computed against the filtered set.
- `POST /api/transactions` — manual entry, body
  `{ type: "cash_in" | "cash_out", amount, note }`, for cases not tied to an order
  (e.g. a misc expense). Rejects non-positive `amount` or invalid `type` with 400.

## How this was built and verified

This was built through a three-agent loop:

1. **Developer Agent** built the full stack per the spec above.
2. **Tester Agent** ran a full functional test pass and found 3 bugs: negative
   `quantity`/`unitPrice` accepted on Inventory create/update, and a missing Edit UI
   on the Inventory page (the backend `PUT` endpoint existed but nothing in the
   frontend called it).
3. **Developer Agent** fixed all 3 (added a negativity check shared by all three
   numeric Inventory fields; added a working inline Edit flow to the Inventory page).
4. **Tester Agent** independently re-verified from the actual code (not the fix
   report) with a full regression pass across all 4 modules — no bugs found, including
   boundary checks (e.g. exactly 0 is allowed, only negative is rejected).
5. **Judge Agent** reviewed the entire implementation line-by-line against the
   original requirements and returned **APPROVED** — every requirement passes, no
   spec violations found.

### Sandbox testing caveat

The environment this was built in blocks downloading the real Firestore emulator
binary (network allowlist blocks `storage.googleapis.com`, which `firebase-tools`
needs). All agents worked around this by using `@firestore-emulator/server` (a pure-JS,
protocol-compatible stand-in) purely as a temporary test backend — it was never added
to this project's dependencies or code. The shipped `firebase.json`/`.firebaserc`/npm
scripts are untouched and target the real `firebase-tools` emulator. On your machine
(with normal internet access and Java installed), `npm run emulator` will download and
run the real emulator on first use, and everything above applies unchanged. This is
worth a first-run sanity check on your end since the real emulator binary itself
wasn't exercised during development.

## Known limitations / things to know

- Firestore emulator data is in-memory only by default — restarting `npm run emulator`
  clears all data. Add `--export-on-exit=./emulator-data --import=./emulator-data` to
  the `firebase emulators:start` command yourself if you want persistence across
  restarts.
- No authentication (by design, for this prototype stage).
- No automated test suite is checked into the repo; testing so far was done ad hoc by
  the agents against a running instance. Consider adding real tests (e.g. Jest +
  supertest) before this becomes more than a prototype.
- Concurrent double-receive of the same purchase order is protected via a Firestore
  transaction + status check, but per-product inventory writes aren't independently
  locked — fine for a single-user prototype, worth revisiting before multi-user use.
