# Hardware-POS — Flaw Audit (2026-11-10)

Scope: everything in this repo (React/Vite frontend, offline sync, PWA, CI).
**Not in scope / not verifiable:** the Supabase database itself. The RLS
policies, the `process_pos_transaction_unsafe` / `adjust_batch_stock` /
`lock_pending_cart` functions, triggers and the `*_public` views are **not in
this repo**, so any finding marked 🔎 depends on what the DB actually does.

Severity: 🔴 Critical (money/stock/security loss) · 🟠 High · 🟡 Medium · ⚪ Low

---

## A. Money & billing correctness

| # | Sev | Flaw | Where |
|---|-----|------|-------|
| A1 | 🔴 | **Offline queue can post the same sale twice.** `flushOfflineQueue` has no lock and is fired from 4 places at once (startup, 60s interval, window focus, `online` event). Two runs read the same queue and both call the RPC → duplicate bill + stock deducted twice. No idempotency key is sent either. | `src/services/sync.js` (flushOfflineQueue, startBackgroundSync) |
| A2 | 🔴 | **Bill is saved in two non-atomic steps.** The RPC creates the bill, then a separate `bills.update` writes payment method, cash/UPI split, total and customer. If that second call fails, the error is only `console.warn`ed — the sale exists with no payment method / wrong total, and the next ledger load treats it as an "inbound orphan" (see A6). Same for the Screws line item insert. | `src/WorkerTerminal.jsx` ~1682-1740, `src/services/sync.js` ~370-415 |
| A3 | 🔴 🔎 | **Prices, MSP and cost come from the browser.** `final_price`, `system_price`, `msp`, `purchase_cost` are all in the RPC payload, and `total_amount` is overwritten by the client. MSP check is client-only. Anyone with devtools (or a buggy cart) can bill below MSP or record any total. Server should look up prices itself and enforce MSP. | `src/WorkerTerminal.jsx` ~1636-1665, 1336-1350 |
| A4 | 🟠 | **Ambiguous network errors are treated as hard failures.** Only `"Failed to fetch"` / code `503` are queued offline. A timeout or dropped response after the server committed shows an error, the cashier retries → duplicate bill. Conversely an RPC that *did* succeed while the response was lost can't be detected (no idempotency key). | `src/WorkerTerminal.jsx` ~1740-1756 |
| A5 | 🟠 | **Returns/voids are not atomic and rewrite history.** Bill total update, stock restore, audit log and `bill_items` edits are separate calls; a failure midway leaves a half-applied return. Partial returns **delete or shrink the original `bill_items` rows** (no credit-note record), and `cash_amount` / `upi_amount` are never adjusted, so the payment split no longer matches the total. | `src/OwnerLedger.jsx` executeReturnItems (~410-545) |
| A6 | 🟠 | **Reading the ledger silently writes to the DB.** Every ledger load finds bills with no payment method and total 0 and moves them to `Warehouse-Inbound`. Combined with A2, a real sale whose metadata update failed can be reclassified automatically. | `src/OwnerLedger.jsx` ~246-252 |
| A7 | 🟡 | **Negotiated-discount allocation can leave a remainder.** The loop stops after 10 iterations and per-item prices are rounded to 2 decimals, so line totals on the receipt can differ from the negotiated total / cash+UPI amounts recorded. | `src/WorkerTerminal.jsx` ~1555-1610, 1614-1628 |
| A8 | 🟡 | **Split payment isn't validated against the total on the server path.** `cash_amount + upi_amount` is stored as typed; nothing guarantees it equals `total_amount`. | `src/WorkerTerminal.jsx` ~1620-1628 |
| A9 | 🟡 | **Offline receipts get a fake bill number** (`OFFL-xxxxx`) that is never linked to the real bill once synced, so a printed receipt can't be found in the ledger. | `src/WorkerTerminal.jsx` ~1745, 1758 |
| A10 | 🟡 | **Failed offline syncs = lost revenue in the books.** If a queued sale is rejected on sync (e.g. stock check), it's only marked `failed` locally on that one device; the cash was already collected. Owner only sees it if they open the failed-syncs modal on that same device. | `src/services/sync.js`, `src/OwnerFailedSyncsModal.jsx` |
| A11 | ⚪ | Bill / receipt numbers are UUID prefixes (`id.split('-')[0]`), not sequential. Not GST-invoice friendly and can collide visually. | `WorkerTerminal.jsx`, `OwnerLedger.jsx` |
| A12 | ⚪ | Checkout double-click guard uses React state (`isCheckingOut`), which isn't updated synchronously; a fast double-click/Enter can start two transactions. Use a ref. | `src/WorkerTerminal.jsx:1332` |

## B. Stock / inventory correctness

| # | Sev | Flaw | Where |
|---|-----|------|-------|
| B1 | 🔴 | **Read-modify-write stock updates (lost updates under concurrency).** Several paths read stock, compute in JS, then write the absolute value: returns/voids, "warehouse disabled" receive routing, batch edits. Two terminals at once → one change is lost. These should be atomic `stock = stock + x` in an RPC. | `OwnerLedger.jsx` ~455-470, `WorkerTerminal.jsx` ~1830-1890, `BatchDetailsView.jsx` |
| B2 | 🟠 | **Manual stock edit sets the product *total* onto the *oldest batch*.** `adjust_batch_stock` gets `newItem.stock_store` (product total) but applies it to batch #1 only. With 2+ batches the total inflates (e.g. 5+5=10, edit to 12 → 12+5=17). 🔎 verify against the RPC. | `src/OwnerInventory.jsx` ~214-235 |
| B3 | 🟠 | **Returns restore stock only to `inventory_batches`**, not `product_master.stock_store` (🔎 unless a DB trigger syncs them); if the bill item has no `batch_id`, stock goes to an arbitrary batch. Cut-length items restore billable qty, not actual length. | `src/OwnerLedger.jsx` ~445-470 |
| B4 | 🟠 | **"Warehouse disabled" receive is a 2-step hack.** Stock is first received into the warehouse, then moved to store by separate client writes — and only if online. Offline receipts stay in the warehouse forever. | `src/WorkerTerminal.jsx` ~1820-1895 |
| B5 | 🟡 | **Local stock gets double-decremented on peer terminals.** Peers apply the broadcast decrement *and* the realtime `postgres_changes` sync; until the next full sync they can show too-low stock and block valid sales. | `src/services/realtimeStock.js`, `src/services/sync.js` |
| B6 | 🟡 | **Delta sync uses the device clock.** `last_sync` is the browser's time; if a terminal's clock is >30s ahead, server updates are skipped until a full sync. Use the max `updated_at` received instead. Also only products whose own `updated_at` changed get their batches refreshed (🔎 needs a trigger bumping the product on batch change). | `src/services/sync.js` ~90-100, 155-165 |
| B7 | 🟡 | **Sync storm.** Every realtime change (no `shop_id` filter on the subscription) triggers a full `syncInventoryToLocal`, with no debounce or in-flight lock. A 20-line bill → ~20+ parallel syncs on every open terminal, plus every other shop's changes if RLS doesn't filter realtime. | `src/services/sync.js` startRealtimeSync |
| B8 | 🟡 | **Product edit dialog logs price/MSP/cost changes it doesn't save.** The `product_master.update` only writes name/category/unit/etc., but the audit log records MRP/MSP/Cost changes. 🔎 confirm whether prices live only on batches. | `src/OwnerInventory.jsx` ~188-250 |

## C. Security & access control

| # | Sev | Flaw | Where |
|---|-----|------|-------|
| C1 | 🔴 🔎 | **Owner role is just a localStorage value.** After *any* successful login, `posUserRole` decides owner vs staff. A staff member can set `localStorage.posUserRole = 'owner'` and get the full owner UI. Safe only if RLS blocks every owner-only table/RPC for worker accounts — which can't be verified from this repo. | `src/App.jsx`, `src/AppContext.jsx` |
| C2 | 🔴 🔎 | **Billable vs non-billable is client-only**, stored as a magic string in `workers.password` (`SECURED_IN_AUTH:NON_BILLABLE`). Nothing on the server stops a warehouse helper from calling the sale RPC. | `src/App.jsx:71`, `src/OwnerStaff.jsx` |
| C3 | 🟠 | **Removing a staff member doesn't revoke their login.** It only deletes the `workers` row; the UI itself tells the owner to go delete them in the Supabase dashboard. An already-logged-in session keeps its token. | `src/OwnerStaff.jsx` ~88-112 |
| C4 | 🟠 | **Legacy un-scoped worker emails** (`name@hardwarepos.com`) are still accepted as a login fallback, and worker emails use only 8 chars of `shop_id`. Two shops with a "Raju" can collide. | `src/EntryFlow.jsx` ~238-252, `src/constants.js` |
| C5 | 🟠 | **Shared terminal leaks owner data to staff.** Logout doesn't clear IndexedDB; the owner's synced catalog (with `cost_price` / `purchase_cost`) stays on the device and staff read the same store. MSP "blur" is cosmetic — the value is in the DOM/IDB. | `src/App.jsx` confirmLogout, `src/services/db.js` |
| C6 | 🟡 | **Sign-up flow on public URL.** Anyone who opens the Vercel URL can register a new shop and create rows (`shop_settings`, `shop-logos` storage uploads with `upsert:true`). 🔎 check RLS/storage policies. | `src/EntryFlow.jsx` handleSetup |
| C7 | 🟡 | **Staff names are listed before login** (`workers` readable anonymously by shop_id) — makes PIN guessing easier; no lockout/rate-limit beyond Supabase defaults. | `src/EntryFlow.jsx` ~34-56 |
| C8 | 🟡 | **Audit logs are written by the client** with `performed_by` taken from localStorage (`owner_name`, which is only set after visiting Settings → otherwise "Owner"/"Staff"). Logs can be skipped or forged; who-did-what is unreliable. Should be written server-side from `auth.uid()`. | many files (`audit_logs.insert`) |
| C9 | 🟡 | **The sale RPC is literally named `process_pos_transaction_unsafe`.** Whatever the "safe" version checked is being bypassed. 🔎 | `WorkerTerminal.jsx:1682`, `sync.js:355` |
| C10 | 🟡 | **Known vulnerable deps:** 9 high / 7 moderate in prod deps (`npm audit`), incl. direct `vite`, `react-router-dom`, `exceljs`, `vite-plugin-pwa`. | `package.json` |

## D. Reliability, offline & PWA

| # | Sev | Flaw | Where |
|---|-----|------|-------|
| D1 | 🟠 | **Two service workers fight each other.** `vite-plugin-pwa` registers its generated SW from `main.jsx`, *and* `index.html` registers `public/sw.js` (cache-first, never versioned). Same scope → whichever wins can serve stale app code after a deploy; the shop may keep running an old build. | `index.html`, `public/sw.js`, `src/main.jsx`, `vite.config.js` |
| D2 | 🟠 | **No "update available" prompt.** `onNeedRefresh` only logs; counters that are never reloaded run old code indefinitely. | `src/main.jsx` |
| D3 | 🟡 | **Offline queue is tied to the device and the logged-in user.** Sync stops on logout; if another user logs in, queued sales post under their session. Sales sit unsynced until someone logs in again on that device. | `src/services/sync.js` |
| D4 | 🟡 | **Offline check is `navigator.onLine`**, which is `true` on Wi-Fi with no internet → checkout waits on a failing request instead of queueing. | `src/WorkerTerminal.jsx` |
| D5 | ⚪ | `start-pos.command` launches the **Vite dev server** (`npm run dev`) for "kiosk printing", not the production build — dev mode is slower and unregisters service workers. | `start-pos.command` |
| D6 | ⚪ | `devOptions.enabled: true` for the PWA plugin while `main.jsx` unregisters SWs on localhost — contradictory config. | `vite.config.js`, `src/main.jsx` |

## E. Reports & data

| # | Sev | Flaw | Where |
|---|-----|------|-------|
| E1 | 🟡 | **Day filters ignore timezone.** `${day}T00:00:00`–`T23:59:59.999` is sent without an offset, so Postgres treats it as UTC. In IST each "day" is 05:30→05:29 next day — late-night/early-morning sales land on the wrong date in Ledger, Stats and Audit Logs. | `OwnerLedger.jsx:234`, `OwnerStats.jsx:671-716`, `OwnerAuditLogs.jsx:179` |
| E2 | 🟡 | **Export falls back to *all* `bill_items` with no shop filter** if the scoped query fails (🔎 RLS-dependent). Also loads entire tables into the browser — will get slow as data grows. | `src/services/dataExport.js:165-172` |
| E3 | ⚪ | Excel export filename uses UTC date (`toISOString`), so exports after 18:30 IST are named with tomorrow's date. | `OwnerLedger.jsx:344`, `dataExport.js:1330` |

## F. Code health & engineering process

| # | Sev | Flaw | Where |
|---|-----|------|-------|
| F1 | 🟠 | **Database schema, RLS policies and RPCs are not version-controlled.** All the 🔎 items above can't be reviewed or reproduced; a Supabase mistake can't be rolled back. Add `supabase/migrations/`. | repo |
| F2 | 🟠 | **CI is broken / useless.** The workflow runs Playwright, but there is no Playwright config or test. The 111 Vitest unit tests are never run in CI (no `test` script). | `.github/workflows/playwright.yml`, `package.json` |
| F3 | 🟡 | **Unit tests currently failing** (2 files: `supabaseUrl is required` — tests import the real client without env). Lint: 6 errors, 429 warnings. | `src/__tests__/`, `eslint` |
| F4 | 🟡 | **God components.** `WorkerTerminal.jsx` 2,939 lines, `OwnerStats.jsx` 1,557, `BatchDetailsView.jsx` 1,437, `dataExport.js` 1,339. Checkout, receive, transfer, discounts, printing and sync all live in one function — the root cause of many bugs above. Business logic belongs in DB RPCs / services. | `src/` |
| F5 | ⚪ | Lots of "try A, fall back to B" logic (`_unsafe` → normal RPC, `product_master` → `_public`, insert → retry with fewer columns) that hides schema drift instead of failing loudly. | `sync.js`, `OwnerCatalog.jsx` |
| F6 | ⚪ | Duplicate source of truth for settings: `disable_warehouse` in both DB and two localStorage keys; `shop_id` in localStorage drives every query. | `src/AppContext.jsx` |
| F7 | ⚪ | Mixed native `alert()` still used (e.g. batch delete) despite custom dialogs; `index.html` blocks pinch-zoom (`user-scalable=no`) — accessibility. | `OwnerInventory.jsx:474`, `index.html` |

---

### Suggested fix order
1. **A1, A2, A4** (duplicate/half-saved bills) — move the whole sale into one RPC with an idempotency key.
2. **C1, C2, C3, C9 + F1** — export Supabase schema/RLS into the repo so we can verify and harden server-side enforcement.
3. **B1, B2, B3, A5** — atomic stock math in RPCs; proper returns table.
4. **D1, D2** — single service worker + update prompt.
5. **A3** — server-side pricing/MSP.
6. Then E-series, remaining B/D, and F cleanup.
