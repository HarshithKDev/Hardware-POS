# Enterprise Security & Architecture Triage Report

As requested, I have performed a ruthless, zero-knowledge audit of the POS & ERP application. Vibe-coded applications often look beautiful on the surface while masking catastrophic structural flaws. Below are the critical vulnerabilities discovered across the 5 specified vectors, completely devoid of generic advice.

## 1. Data Integrity & Concurrency (The Database Layer)

**[Severity Level]**: CRITICAL (Silent Data Loss & Race Condition)
**[File Name & Exact Line Numbers]**: `src/OwnerInventory.jsx` (Lines 92-140), `src/InventoryRow.jsx` (Lines 152, 161)
**[The Flaw]**: 
In `InventoryRow.jsx`, the owner is presented with `<input>` fields to manually adjust `stock_warehouse` and `stock_store`. When edited, `OwnerInventory.jsx`'s `updateItemMutation` fires. It meticulously logs the stock change to the `audit_logs` table (Line 112: `Whse Stock: ${oldItem...} -> ${newItem...}`), tricking the user into believing the database was updated. However, the actual Supabase `.update()` payload (Line 94) explicitly drops the stock fields and only updates metadata like `name` and `category`. Furthermore, `stock_store` resides in `inventory_batches`, not `product_master`. 
Even if you added `stock_store` to the payload, it would create a massive concurrency race condition: if an owner edits stock from 10 to 12, but a cashier sells 2 items during those 5 seconds, the owner's client overwrites the cashier's sale.
**[The Fix]**: 
1. **React Refactor**: Remove the manual `.update()` logic for stock in `OwnerInventory.jsx`. 
2. **SQL Migration**: Create a dedicated atomic RPC `adjust_batch_stock(p_batch_id UUID, p_new_store_stock NUMERIC, p_new_whse_stock NUMERIC)` that calculates the delta (`new_stock - current_stock`) inside PostgreSQL using a `FOR UPDATE` row lock, applies the delta, and creates an audit log atomically.

## 2. Security & Trust Boundary (The API/Auth Layer)

**[Severity Level]**: HIGH (Network Data Leak)
**[File Name & Exact Line Numbers]**: `src/services/sync.js` (Lines 40-44)
**[The Flaw]**: 
The database correctly uses a secure view (`product_master_public`) to hide the wholesale `cost_price` and `msp` (Minimum Selling Price) from low-level workers. However, `sync.js` fetches batches using `supabase.from('inventory_batches').select('*')` unconditionally for ALL roles. Because `inventory_batches` contains `purchase_cost` and `msp` (as seen in `CreateBatchModal.jsx:30`), every time a cashier's tablet syncs the catalog, the wholesale costs of the entire store's inventory are downloaded to the browser's Network tab.
**[The Fix]**: 
1. **SQL Migration**: Create a secure view `inventory_batches_public` that omits `purchase_cost` and `msp`.
2. **React Refactor**: In `sync.js`, implement `const batchTable = userRole === 'owner' ? 'inventory_batches' : 'inventory_batches_public';` and query against that.

## 3. React Performance & Hardware Lifecycle (The Client Layer)

**[Severity Level]**: MEDIUM (Memory/Hardware Leak)
**[File Name & Exact Line Numbers]**: `src/components/scanner/InlineContinuousScanner.jsx` (Lines 78-82)
**[The Flaw]**: 
The component instantiates `Html5QrcodeScanner` inside a `useEffect`. In the cleanup function, it calls `scannerRef.current.clear().catch(...)`. Because `.clear()` is asynchronous, if the React component unmounts and remounts rapidly (e.g., React Strict Mode, or a cashier frantically toggling tabs), a second camera instance requests hardware access before the first one relinquishes the lock. This crashes the browser's camera API, requiring a hard refresh of the iPad/Tablet.
**[The Fix]**: 
**React Refactor**: Introduce an `isUnmounting` ref flag. Await the `.clear()` function properly before nullifying the reference, and ensure the `useEffect` ignores initialization if a teardown is actively running.

## 4. Retail Edge Cases (The Input/State Layer)

**[Severity Level]**: HIGH (Financial Math Vulnerability)
**[File Name & Exact Line Numbers]**: `src/ReceiptTemplate.jsx` (Line 6)
**[The Flaw]**: 
The receipt calculates the customer's total savings using raw JavaScript floating-point arithmetic: `(Math.max(0, item.mrp - item.finalRate) * item.quantity)`. Because standard IEEE 754 floats cannot precisely represent base-10 decimals, calculations like `(19.99 - 15.00) * 3` result in `14.970000000000002`. This fractional penny will propagate into end-of-day accounting dashboards if relied upon, causing irreconcilable ledger imbalances.
**[The Fix]**: 
**React Refactor**: Convert all currency to integer cents *before* multiplication. 
`((Math.round(item.mrp * 100) - Math.round(item.finalRate * 100)) * item.quantity) / 100`.

## 5. Business Logic Gaps (The Operational Layer)

**[Severity Level]**: CRITICAL (Missing Enterprise Flow)
**[File Name & Exact Line Numbers]**: `src/OwnerLedger.jsx` (Entire File) & `src/WorkerTerminal.jsx`
**[The Flaw]**: 
The system completely lacks a Returns/Refunds workflow. A cashier can finalize a sale via `process_pos_transaction`, but if a customer returns an item 5 minutes later, there is no UI to reverse it. Vibe-coded POS systems usually optimize for the "Happy Path" (Checkout) but fail to account for returns, which require returning stock to the correct `inventory_batch`, issuing a negative cash/UPI entry, and generating a Refund Receipt.
**[The Fix]**: 
1. **React Refactor**: In `OwnerLedger.jsx`, add a "Process Return" modal to historical bills. 
2. **SQL Migration**: Implement the missing `process_return` RPC (referenced in pending migrations) that accepts a `bill_id` and an array of items to return, increments the corresponding `batch_id` stock, inserts a negative `-amount` record into `register_sessions`, and creates a `returns` ledger entry.

---
Review the triage report above. If you approve, I can immediately begin executing the SQL migrations and React refactors to patch these vulnerabilities.
