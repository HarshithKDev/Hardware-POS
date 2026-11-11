# Hardware-POS — Flaw Audit (2026-11-10)

Scope: everything in this repo (React/Vite frontend, offline sync, PWA, CI).
**Not in scope / not verifiable:** the Supabase database itself. The RLS
policies, the `process_pos_transaction_unsafe` / `adjust_batch_stock` /
`lock_pending_cart` functions, triggers and the `*_public` views are **not in
this repo**, so any finding marked 🔎 depends on what the DB actually does.

Severity: 🔴 Critical (money/stock/security loss) · 🟠 High · 🟡 Medium · ⚪ Low

---

## Fix status

Legend: ✅ fixed · 🟡 partly fixed in the app, rest needs the database · ⛔ needs the database / Supabase settings · ➖ intentionally not changed (reason given)

### Critical
| # | Status | What was done |
|---|--------|---------------|
| A1 | ✅ | Offline flush runs once at a time (in-tab + cross-tab lock); sales claimed as `submitting`; interrupted sends go to Failed Syncs instead of being re-sent. |
| A2 | 🟡 | Payment details retried and parked for background retry. Full fix = one RPC that saves everything atomically. |
| A3 | ⛔ | Price/MSP must be enforced inside the sale RPC. |
| B1 | ✅ | Compare-and-swap stock writes (`src/services/atomicStock.js`). |
| C1 | 🟡 | Role verified against the signed-in account. RLS still required. |
| C2 | 🟡 | Known non-billable workers blocked offline. Sale RPC must check it too. |

### High
| # | Status | What was done |
|---|--------|---------------|
| A4 | ✅ | Connection drop during checkout → clear "check Sales & Returns before re-billing" message; never auto-queued (could duplicate). |
| A5 | 🟡 | Partial returns keep Cash/UPI consistent with the new total; per-item stock failures are reported. Atomic returns + credit notes need a DB function/table. |
| A6 | ➖ | Ledger auto-reclassify only touches bills with total 0 and no payment method; after A2 a real sale no longer ends up in that state. |
| B2 | ✅ | The buggy code was in an unused function; removed. |
| B3 | ➖ | Verified: on-screen stock is the sum of batches, so restoring to the batch is correct. |
| B4 | ✅ | Offline receipts made with warehouse disabled are routed to store after sync. |
| C3 | ✅ (app) | Removed staff are signed out on their device within 5 minutes. Deleting the Auth user still needs a server function. |
| C4 | ⛔ | Legacy login emails can only be removed after migrating those accounts in Supabase Auth. |
| C5 | ✅ | Owner logout strips cost prices from the device; owner's next login re-syncs them. |
| D1 | ✅ | Single service-worker registration; unused `public/sw.js` removed. |
| D2 | ✅ | Hourly update check; auto-reload waits until no sale/sync/return is in progress. |
| F1 | ⛔ | Needs a schema/RLS export from Supabase. |
| F2 | ✅ | CI runs lint (errors), unit tests and build. |

### Medium
| # | Status | What was done |
|---|--------|---------------|
| A7 | ✅ | NET DUE and UPI QR = amount charged; paise difference shown as "Round Off". |
| A8 | ✅ | Split payments record cash kept (Cash + UPI = total); UPI part can't exceed total. |
| A9 | ⛔ | Linking offline receipt numbers to real bills needs a column on `bills`. |
| A10 | ✅ | Failed syncs are also written to the audit log. |
| B5 | ✅ | Peer-terminal broadcast schedules a reconcile sync. |
| B6 | ✅ | Watermark = sync start time; full refresh every 6 hours. |
| B7 | ✅ | One sync at a time, follow-ups merged, realtime triggers debounced. |
| B8 | ✅ | Was in the removed unused function. |
| C6 | ⛔ | Disabling public sign-up is a Supabase setting (staff creation must move to a server function first). |
| C7 | ➖ | Staff names on the login screen is a UX choice; left for the owner. |
| C8 | ✅ (app) | Audit logs record the actual staff member. Server-written logs need DB triggers. |
| C9 | ⛔ | `process_pos_transaction_unsafe` lives in the DB. |
| C10 | ✅ | `npm audit fix`: 20 → 9 (high 9 → 1). Remaining fixes are major downgrades or build-time-only. |
| D3 | ➖ | Queued sales keep the original cashier name; flushing needs a login by design. |
| D4 | ✅ | Covered by A4. |
| E1 | ✅ | Ledger, stats and audit logs use local (IST) day boundaries. |
| E2 | ✅ | Export pages past the 1000-row limit and never mixes other shops' rows. |
| F3 | ✅ | All test files pass; lint 0 errors (`set-state-in-effect` downgraded to warning). |
| F4 | ➖ | Splitting the 3,000-line components is a risky refactor; recommended as separate work. |

### Low
| # | Status | What was done |
|---|--------|---------------|
| A11 | ⛔ | Sequential invoice numbers need a DB sequence. |
| A12 | ✅ | Synchronous double-submit guard. |
| D5 | ✅ | Launcher serves the production build, or opens `POS_URL` (e.g. the Vercel URL). |
| D6 | ✅ | PWA dev mode disabled. |
| E3 | ✅ | Export filenames use the local date. |
| F5 | ➖ | Fallback logic left in place until the schema is versioned (F1). |
| F6 | ➖ | Settings duplication is harmless (DB value wins); revisit with F1. |
| F7 | ✅ / ➖ | Last native `alert()` replaced. Pinch-zoom stays disabled on purpose for counter tablets. |

### New finding
| # | Sev | Flaw |
|---|-----|------|
| G1 | 🟡 | Inventory "Global Edit" upserts a full product snapshot (incl. stock) into `product_master`, while on-screen stock comes from batches — edited stock may not take effect and stale values can overwrite. Needs testing against the live DB. (`src/OwnerInventory.jsx` saveBulkEdits) |

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

---

# Second review (2026-11-10): database schema + remaining areas

## S. Database schema
| # | Sev | Flaw |
|---|-----|------|
| S1 | 🔴 | **`expenses` has no `shop_id`.** All shops' expenses share one table; the app downloads every row and filters by a text note (`shop:<id>`). Unless RLS blocks it, any shop can read/insert another shop's expenses. Also gets slower as the table grows. |
| S2 | 🟠 | **`shop_settings.owner_password` column.** Unused by the app. If it contains passwords in plain text, anyone who can read `shop_settings` (staff load this row at start-up) can read them. Clear it and drop the column. |
| S3 | 🟠 | **`workers` is not linked to Supabase Auth users** (no auth user id), so logins are matched by name-derived emails. Root cause of C3/C4: a removed worker's login can't be revoked reliably. |
| S4 | 🟡 | **`bills.payment_method` defaults to `'CASH'`.** If the payment update after a sale fails, a UPI sale shows as cash. Receipts with the warehouse disabled are saved with location `Store` and may appear in the sales ledger as cash bills — verify with data. |
| S5 | 🟡 | No invoice-number column/sequence (A11). |
| S6 | 🟡 | **Half-built features:** `returns`/`return_items` (proper return records — the app deletes bill lines instead), `register_sessions` (cash drawer open/close), `stock_instances` (cut-piece tracking) exist but are never used. |
| S7 | ⚪ | No `sound_enabled` column: every Settings save fails once and retries; the sound setting is only saved on the device. |
| S8 | ⚪ | `gstin` and `bill_footer` exist but can't be edited in Settings; GSTIN prints only on thermal (ESC/POS) receipts. |
| S9 | — | RLS policies, functions and triggers were not part of this schema; still needed to fix A3/C1/C2/C9. |

## CL. Cut-length items
| # | Sev | Flaw |
|---|-----|------|
| CL1 | 🟠 | **Stock is one total length per batch; leftover offcuts aren't tracked.** E.g. 10 pipes × 12 ft = 120 ft. Sell ten 10-ft cuts → system shows 20 ft available, but reality is ten 2-ft offcuts, and it will happily sell a 10-ft cut from it. Scrap/discard is never recorded (always null), so stock is overstated and wastage is invisible. |
| CL2 | 🟡 | With the warehouse disabled, the cut screen counts warehouse stock as available, but the sale deducts from store → shows "available" then fails at checkout. |
| CL3 | 🟡 | Piece barcodes (`1002-0104`) assume a 2-digit batch number; from batch 100 onward scans resolve to the wrong batch. |
| CL4 | ⚪ | `CutLengthModal`, `ReceiveLengthModal`, `SelectPieceModal`, `ManualInstanceBarcodeModal` are never shown (dead code); the scanner still parses piece barcodes but discards the piece id. |
| CL5 | ⚪ | Cart `quantity` means "pieces" when receiving but "length" at checkout — fragile, easy to break. |

## BI. Bulk catalog import / adding products
| # | Sev | Flaw |
|---|-----|------|
| BI1 | 🟠 | **Barcode lookup isn't paginated (1000-row limit).** With 1000+ products the existing-barcode list is incomplete → generated barcodes collide → the whole import fails. "Add Product" uses the same lookup and can fail with "Failed to generate a unique barcode". |
| BI2 | 🟠 | **A row whose barcode already exists silently gets a new barcode** → duplicate product instead of an update; labels already on shelves still point to the old product. |
| BI3 | 🟡 | No validation: text/negative prices become NaN/negative; MSP > MRP or cost > MRP accepted; any unit text accepted. |
| BI4 | 🟡 | All rows in one insert: one bad row fails the whole file, with a raw database error and no row number. |
| BI5 | ⚪ | Category auto-create failures are only logged; the product insert then fails with an unexplained foreign-key error. |

## BP. Barcode label printing
| # | Sev | Flaw |
|---|-----|------|
| BP1 | 🟡 | Label quantity has no limit — a typo like 1000 renders 1000 barcodes, can freeze the counter and waste the roll. |
| BP2 | 🟡 | Labels show the batch price at print time; after a price change, old labels show the old MRP while checkout charges the new one. No "reprint labels for changed prices" flow. |
| BP3 | ⚪ | Two separate label layouts (Print Barcodes screen vs batch print modal) produce different-looking labels. |

## SR. Showroom dispatch
| # | Sev | Flaw |
|---|-----|------|
| SR1 | 🟠 | **No way to close a showroom dispatch:** no "payment received" or "returned from showroom" action, and the ledger hides showroom bills so they can't be returned there either. Goods leave stock permanently and the money never enters revenue. |
| SR2 | 🟡 | Dispatch goes through the sale checkout: MSP rules and a "negotiated amount" are enforced for an internal transfer; value recorded at selling price, not cost. |
| SR3 | 🟡 | Showroom status is set in the second save step (A2/S4) — if it fails, the dispatch is recorded as a CASH sale and counted as revenue until the retry succeeds. |
| SR4 | ⚪ | "Total value" on the Showroom page sums only the current page. |

## EX. Expenses
| # | Sev | Flaw |
|---|-----|------|
| EX1 | 🔴 | Shop isolation — see S1. |
| EX2 | 🟠 | **If saving to the database fails, it still says "Recorded"**, keeps it only in browser storage, and the next page load from the database overwrites it → expense silently lost. |
| EX3 | 🟡 | Every expense is saved with category "Staff Advance" (DB default), even "General Shop" expenses like electricity; payment mode always CASH. |
| EX4 | 🟡 | No edit or delete — mistakes are permanent. |
| EX5 | 🟡 | Expenses aren't included in profit/stats, and cash paid out isn't reflected in expected cash. |

## Second review — fix status

| # | Status | What was done |
|---|--------|---------------|
| S1 / EX1 | 🟡 | App writes and reads `expenses.shop_id` once the column exists. SQL in `supabase/migrations/20261110_audit_fixes.sql` (step 1 adds + backfills it; step 2 restricts access per shop — review first). |
| S2 | ⛔ SQL ready | Step 3 of the migration file clears/drops `owner_password` (review first). |
| S3 | ⛔ | Needs auth/RLS definitions. |
| S4 | ✅ | Stock receipts are tagged `Warehouse-Inbound` when saved; migration step 4 fixes old ones. |
| S5 | ⛔ | Needs the sale function (A11). |
| S6 | ➖ | Unused tables left in place; `stock_instances` is no longer needed (cut-length items are tracked by total). |
| S7 | ✅ | Settings save no longer drops "disable warehouse"; migration step 5 adds `sound_enabled`. |
| S8 | ✅ | GSTIN and bill footer editable in Settings and printed on both receipt types. |
| CL1 | ✅ (by design change) | Per client: cut-length items are tracked by total only; offcuts are written off with the new per-batch **Scrap** action. |
| CL2 | ✅ | The cut-length dialog uses the same stock rule as the sale. |
| CL3 | ✅ | Batch barcodes use the exact batch number; old piece labels still scan. |
| CL4 / CL5 | ✅ | Piece-tracking dialogs and code removed; cart quantity is the total in every tab. |
| BI1–BI5 | ✅ | Paged barcode lookup, existing barcodes skipped and listed, row validation, category errors stop the import, chunked insert with exact report. |
| BP1–BP3 | ✅ | 300-label cap, reprint prompt after MRP change, one shared label layout. |
| SR1 | ✅ (by design change) | Per client: showroom is only a stock-out record — deducted from store stock and inventory value, no revenue/settlement. |
| SR2 | ✅ | No MSP / negotiated amount / payment for showroom dispatch; slip says "not a sale", no UPI QR. |
| SR3 | 🟡 | Covered by the retried bill details (A2); fully fixed when the sale function saves everything at once. |
| SR4 | ✅ | Total covers all dispatches. |
| EX2 | ✅ | Unsaved expenses stay on the device as "Not synced" and upload automatically. |
| EX3 | ✅ | Category and payment mode selectable. |
| EX4 | ✅ | Owner can delete an expense (audit logged). |
| EX5 | ✅ | Profit view shows expenses and profit after expenses. |

New finding while fixing: in the mobile scanner, editing a quantity changed only the display for cut-length items while the sale deducted the old amount — fixed.

---

## Database security review (2026-11-11)

Based on `supabase/diagnostics/security_check.sql` output from the live project.
Fix: `supabase/migrations/20261111_security_hardening.sql` — **applied to the live database on 2026-11-11** (0 expenses left without a shop). Tested first on a local copy that
reproduces the live rules: before → after for logged-out visitors, staff and owner).

| # | Finding (live) | Fix |
|---|---|---|
| S-1 | `expenses` had "Allow all" for everyone, including logged-out visitors | Own-shop rule; old expenses without a shop attached when there is one shop |
| S-2 | `product_master_public` / `inventory_batches_public` views bypassed shop rules (readable logged-out) | `security_invoker = true`; no logged-out access |
| S-3 | Staff table fully readable by logged-out visitors and other shops (emails, billable flag) | Logged-out: names only (login dropdown); signed-in: own shop |
| S-4 | Staff could update `shop_settings` (incl. owner email → owner takeover) | Only the owner (admin email) can update |
| S-5 | Staff could edit `workers` (e.g. make themselves billable) and delete audit logs | Staff table writes owner-only; audit logs insert + read only |
| S-6 | `returns`, `return_items`, `register_sessions` readable/writable by any signed-in user of any shop | Own shop only |
| S-7 | All database functions callable by logged-out visitors | Revoked from anon/public; `process_return`, `close_register` locked |
| S-8 | Any signed-in user could replace/delete any shop's logo | Only the uploader / shop owner |
| S-9 | TRUNCATE/TRIGGER/REFERENCES and logged-out write grants on all tables | Removed |

Still open (needs moving writes into database functions first):
- Staff devices can read cost prices from `product_master` / `inventory_batches` directly
  through the API (the app uses the cost-free views, but the base tables are readable for
  the own shop), and can change prices/stock or edit bills of their own shop via the API.
- Staff names (only names) of all shops are visible before login.
