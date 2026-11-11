# Desktop UI review (2026-11-11)

Scope: owner and counter screens on desktop. Based on the code (`src/`) and the
live screenshots. Priority: **P1** = affects speed/accuracy at the counter or
readability · **P2** = consistency / polish · **P3** = nice to have.

What already works well: dark theme with a calm blue accent, consistent dark
surfaces, sticky table headers, keyboard shortcuts at the counter, Indian number
formatting, centered tables, clear status badges (CASH / COMPLETED / SALE).

---

## 1. Design system (the root cause of most inconsistencies)

| # | P | Finding (measured in the code) | Recommendation |
|---|---|---|---|
| DS1 | P1 | No shared Button / Input / Modal / Table / Badge components. Every screen styles its own, with **907 inline `style={{}}`** blocks. | Create a small component set (`Button`, `IconButton`, `Input`, `Select`, `Modal`, `Table`, `Badge`, `StatCard`, `PageHeader`) and migrate screen by screen. Fixes most items below at once. |
| DS2 | P2 | **7 different corner radii** in use (`rounded` 81, `-sm` 18, `-md` 164, `-lg` 138, `-xl` 57, `-2xl` 7, `-none` 15). | 3 radii only: **6px** controls (buttons, inputs, badges), **10px** cards/panels/tables, **14px** modals; `full` only for avatars/pills. |
| DS3 | P2 | **7 button heights** (h-7 … h-14). | 3 sizes: **32px** (table/inline actions), **40px** (default), **48px** (primary counter actions: Complete Sale, Add). |
| DS4 | P1 | Text sizes down to **6–9px** (`text-[6px]`…`text-[9px]`: 18 uses) and 184 uses of 10–11px. | Minimum **12px** for any text, **13–14px** for table body, 11px only for uppercase labels. Type scale: 12 / 14 / 16 / 20 / 24 / 32. |
| DS5 | P2 | **308 uppercase + letter-spacing** labels (buttons, headers, badges, titles). Everything shouts, so nothing stands out. | Uppercase only for small labels/badges and table headers. Buttons, titles and menu items in sentence case ("Print labels", "Add batch"). |
| DS6 | P2 | 57 hard-coded hex colours + 131 raw Tailwind palette colours (`red-500`, `amber-400`, `emerald-…`) next to the CSS variables. | All colours through tokens. Add missing semantic tokens: `--color-warning-bg`, `--color-info`, `--color-neutral-badge`. |
| DS7 | P3 | Leftover "md3-*" aliases and "linear-*" naming in `index.css`. | Keep one naming scheme (`--bg-*`, `--text-*`, `--border-*`, `--color-*`); delete aliases after migration. |
| DS8 | P2 | **13 different z-index values** up to `99999`, modals at 50/100/150/500/600/10000. | Fixed layers: base 0, sticky 10, dropdown 20, navbar 30, overlay/modal 40, toast 50. |
| DS9 | P3 | 64 hand-written inline SVG icons alongside `lucide-react`. | Use lucide everywhere (consistent stroke width 1.75–2, sizes 16/20). |

## 2. Colour and contrast (accessibility, long shifts at the counter)

| # | P | Finding | Recommendation |
|---|---|---|---|
| C1 | P1 | Tertiary text `#52525B` on the dark background has **2.4–2.6 : 1** contrast (minimum for text is 4.5 : 1). Used for hints, "PCS", timestamps, secondary table text. | Raise to about `#8B8B95` (≈5 : 1). |
| C2 | P1 | White text on **green success** buttons/badges is **2.3 : 1**; on blue accent **3.7 : 1**; on red **3.8 : 1**. | Darker fills for solid buttons: blue `#2563EB` (5.2 : 1), red `#DC2626` (4.8 : 1), green `#15803D` (5.0 : 1); keep the brighter shades for text/icons on dark. |
| C3 | P1 | Red is used for normal things: the large **Sign Out** button, all values in **Dead Stock** ("Capital tied up" all red), Delete-style outlines. Red loses meaning as "danger". | Red only for destructive actions and errors. Sign out → neutral ghost button in a user menu. Money values → normal text; use amber only for warning thresholds. |
| C4 | P2 | Batch screen shows 5 outline buttons in 5 colours (blue, green, amber, red, neutral). | One **primary** (solid accent) per screen, others **secondary** (neutral outline); only Delete in red. |
| C5 | P3 | No light theme (a dark-mode toggle exists in code but there are no light tokens). Bright shops/daylight counters can find dark UIs harder to read. | Optional light theme via the same tokens (cheap once DS1/DS6 are done). |

## 3. Tables (the heart of an ERP)

| # | P | Finding | Recommendation |
|---|---|---|---|
| T1 | P2 | Numbers are centered (by request). ERP convention is **right-aligned numbers** so ₹ values line up by digit; text left-aligned. | Optional: right-align money/quantity columns only, keep everything else centered. Already use `tabular-nums` (46 places) — apply to every number column. |
| T2 | P2 | Row heights and paddings differ per table (p-2 … p-4). | Standard row 44px (compact 36px option), header 40px, 12–16px cell padding. |
| T3 | P2 | No zebra striping or clear hover on most tables; dense data blends together. | Subtle hover row (`--bg-hover`), optional zebra at 2–3% white. |
| T4 | P1 | Totals are scattered (cards above, chips in rows). | Footer total row in money tables (Ledger, Expenses, Showroom, Dead stock). |
| T5 | P2 | Sorting only in some lists; no column sort indicators. | Click-to-sort headers with an arrow on Inventory, Dead stock, Ledger, Expenses. |
| T6 | P2 | Audit Logs "Changes" column is a row of many chips; hard to scan. | One readable sentence per row, details in an expandable row. |
| T7 | P3 | Long names truncate without a tooltip. | `title` tooltip on truncated cells. |

## 4. Forms and inputs

| # | P | Finding | Recommendation |
|---|---|---|---|
| F1 | P1 | **149 `focus:outline-none` and 0 `focus-visible` styles**: keyboard users (and barcode/keyboard-driven cashiers) can't see which field or button is focused. | Global visible focus ring (2px accent + 2px offset) on `:focus-visible` for every control. |
| F2 | P1 | Date fields use the browser's format; on these PCs it shows **10/11/2026** for 10 Nov — reads as 10 Oct to Indian users. | Show dates as **10 Nov 2026** (or dd/mm/yyyy) with a custom date picker label; keep the native picker underneath. |
| F3 | P2 | Field labels are tiny uppercase; required marks inconsistent; errors appear in alerts instead of next to the field. | Sentence-case labels 13px, `*` for required, inline error text under the field, disable Save until valid. |
| F4 | P2 | ₹ prefix and unit suffix (ft, PCS) styled differently per form. | One `Input` with `prefix`/`suffix` slots. |
| F5 | P3 | Number inputs show browser spinners in some places, hidden in others. | Hide spinners everywhere; use +/- buttons only where quantity stepping is useful. |

## 5. Buttons and actions

| # | P | Finding | Recommendation |
|---|---|---|---|
| B1 | P1 | Several screens have no clear primary action (all outlines, similar weight). | One solid primary per view (e.g. "Complete sale", "Save item", "Add batch"). |
| B2 | P2 | Icon-only buttons without labels/tooltips in places (back arrow, edit pencil). | Tooltip + `aria-label` on every icon-only button. |
| B3 | P2 | Destructive actions use the same shape as normal ones; confirmation wording varies. | Red solid only inside the confirm dialog; consistent "Delete X? This can't be undone." copy. |
| B4 | P2 | Loading state differs (spinner replaces text, sometimes nothing). | Button keeps its width, shows spinner + "Saving…", disabled while busy. |

## 6. Layout and navigation

| # | P | Finding | Recommendation |
|---|---|---|---|
| L1 | P2 | Top bar shows only the user name and a big red Sign Out; shop name/logo, online status, current page and date are missing. | Top bar: shop logo + name (left), page title/breadcrumb, online/sync indicator, user menu (name, role, dark/light, sign out). |
| L2 | P2 | Page header style differs per screen (title size 16–24px, actions placed differently). | One `PageHeader`: title 24px, optional subtitle, actions right-aligned, filters row below. |
| L3 | P2 | Content spans full width on large monitors (long lines in forms, wide tables). | Max content width ~1440px for forms/detail pages; tables may stretch. |
| L4 | P3 | Sidebar has no grouping. | Group: **Sales** (Checkout, Sales & Returns, Showroom), **Stock** (Inventory, Add items, Categories), **Money** (Expenses, Overview), **Admin** (Staff, Audit logs, Settings). |
| L5 | P3 | No breadcrumb/back consistency (some screens have a Back button, some an arrow). | Same back control everywhere in the page header. |

## 7. Feedback, states and messages

| # | P | Finding | Recommendation |
|---|---|---|---|
| S1 | P1 | **126 blocking alert dialogs** (`showAlert`) vs 3 toasts. Every "Saved", "Stock updated" interrupts work and needs a click. | Toasts (auto-dismiss, bottom-right) for success/info; dialogs only for errors that need a decision. |
| S2 | P2 | Loading is mostly a full-page spinner; only 5 skeleton loaders. | Skeleton rows for tables and cards so the layout doesn't jump. |
| S3 | P2 | Empty states are plain text in many places. | Icon + one line + the next action button ("No expenses yet — Add expense"). |
| S4 | P2 | Offline is a red pulsing banner (alarming, animated all day). | Calm amber bar "Offline — sales are saved on this device", no pulse; green "Back online, synced" toast. |
| S5 | P3 | Error text sometimes shows raw database messages. | Map known errors to plain messages (partly done); "Copy details" for the rest. |

## 8. Typography and copy

| # | P | Finding | Recommendation |
|---|---|---|---|
| TY1 | P2 | Inter is loaded from Google Fonts — not available offline, so offline counters fall back to a different font and layout shifts. | Bundle Inter locally (woff2) via the app build. |
| TY2 | P3 | Mixed wording: "Store Inventory" vs "Inventory", "Warehouse Low Stock" vs "Shop Low Stock", "Showroom Dispatches". | One glossary (Store / Warehouse / Showroom, Sale / Return / Dispatch) used everywhere. |
| TY3 | P3 | Weight variety (300–800). | 400 body, 500 labels, 600 headings/buttons, 700 only for key numbers. |

## 9. Accessibility & best practices (WCAG 2.1 AA basics)

| # | P | Finding | Recommendation |
|---|---|---|---|
| A1 | P1 | Contrast (C1/C2) and focus (F1). | As above. |
| A2 | P2 | Modals: 16 different overlay implementations; focus isn't trapped or returned; Esc handling varies. | One `Modal` with focus trap, Esc to close, return focus, `role="dialog"` + `aria-labelledby`. |
| A3 | P2 | Information shown only on hover (MSP reveal, 21 hover-only spots) is not reachable by keyboard/touch. | Also reveal on focus/click. |
| A4 | P3 | `user-scalable=no` blocks zoom on touch devices. | Allow zoom on owner screens. |

## 10. Counter-specific (speed at the till)

| # | P | Finding | Recommendation |
|---|---|---|---|
| K1 | P1 | Grand total and change due are not the single most prominent elements on the checkout screen. | Fixed summary panel: Total (32–40px), items count, discount, change due; Complete sale as the largest button. |
| K2 | P2 | Keyboard shortcuts exist but aren't visible on buttons. | Show shortcut hints on buttons ("Complete sale  F4"). |
| K3 | P2 | Success sounds exist; no visual "scan received" flash. | Brief row highlight when an item is scanned/added. |

---

## Suggested order

1. **Foundation (1–2 days):** tokens for radius/size/z-index/colours (DS2–DS8, C1–C2), global focus ring (F1), local Inter (TY1).
2. **Components (2–3 days):** Button, Input, Modal, Table, Badge, PageHeader, Toast (DS1) — then migrate the busiest screens first: Checkout, Inventory/Batch, Sales & Returns, Dashboard.
3. **Behaviour (1–2 days):** toasts instead of success alerts (S1), date display (F2), red only for danger (C3), primary/secondary buttons (B1, C4), table footers/sorting (T4, T5).
4. **Polish:** top bar & sidebar grouping (L1, L4), skeletons/empty states, optional light theme.
