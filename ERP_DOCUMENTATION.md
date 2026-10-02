# Hardware POS & ERP System - Documentation

## 1. Overview
This application is a modern, cloud-connected Point of Sale (POS) and Enterprise Resource Planning (ERP) system tailored for a hardware retail and wholesale business. Built as a multi-tenant SaaS application, it is designed to run efficiently on desktops for owners and cashiers, while remaining highly optimized for mobile devices so warehouse helpers can scan items using their phone cameras.

**Technology Stack:**
- **Frontend Framework:** React (Vite)
- **Styling:** Vanilla CSS + Tailwind CSS (Dynamic Utility Classes)
- **Backend & Database:** Supabase (PostgreSQL)
- **Authentication:** Supabase Auth + Custom PIN-based Worker Auth
- **Scanner:** `html5-qrcode` for mobile camera integration

---

## 2. Architecture & Multi-Tenancy (SaaS)
The application is built with a multi-tenant architecture. 
- **Tenants (`shop_id`)**: Every table in the database is scoped to a specific `shop_id`.
- **Row Level Security (RLS)**: Supabase PostgreSQL RLS policies enforce that users can only read, write, and modify data that strictly belongs to their `shop_id`.
- **State Management**: The application utilizes `localStorage` to securely anchor the current browser to a specific `shop_id` and `owner_email` after successful login or registration, seamlessly routing subsequent visits.

---

## 3. User Roles & Access Control
The application operates on a dual-login system separating the **Owner/Admin** from the **Staff/Workers**.

### A. Owner (Admin)
- **Authentication:** Standard Email & Password via Supabase Auth.
- **Capabilities:**
  - Full access to all dashboards and financial metrics.
  - Create, modify, and delete inventory (`product_master`).
  - View real-time sales history and generate reports.
  - Manage staff accounts (Add/Remove workers, set passwords).
  - Configure shop settings (UPI ID, GST details, thresholds).

### B. Billable Staff (Cashiers)
- **Authentication:** Select name from list + Password/PIN.
- **Capabilities:**
  - **Checkout Customer:** Access to the POS terminal to bill customers. Can hold carts, split payments (Cash/UPI), and view total sales.
  - **Receiving Stock:** Add inbound stock from wholesalers to the warehouse.
  - **Sending Stock:** Transfer stock from the warehouse to the store front.
  - **Check Price:** Scan an item (via mobile camera) to quickly check its price and stock levels across warehouse/store.

### C. Non-Billable Staff (Warehouse Helpers)
- **Authentication:** Select name from list + Password/PIN.
- **Capabilities:**
  - **Receiving Stock & Sending Stock:** Full access to inventory movement.
  - **Check Price:** Mobile-only access for quick inventory lookup.
  - **Blocked:** No access to the Checkout/POS Terminal.

---

## 4. Key Workflows & Features

### 1. The POS Terminal (Checkout)
- **Cart Management:** Supports adding items by barcode or manual search. Carts can be saved to a "Held" state to service another customer quickly.
- **MSP Masking:** The Minimum Selling Price (MSP) is heavily protected. It is globally blurred out (`.blur-sm`) on the UI and is only revealed when an employee physically hovers their mouse or taps on it.
- **Split Payments:** A custom checkout modal allows the cashier to split a single bill precisely between **Cash** and **UPI**, with the software accurately calculating the change required.
- **Receipt Generation:** Automatically generates a formatted receipt (Standard Thermal size) that hides the store's UPI ID (for privacy) while displaying the required bill details.

### 2. Inventory Management (Store vs Warehouse)
- The system independently tracks **Store Stock** and **Warehouse Stock** for every single item.
- Low-stock alerts are completely separated. Owners and staff can set custom thresholds and immediately view a list of items running low in either the storefront or the warehouse.
- **Dynamic Filtering:** The inventory UI allows instant dropdown filtering by **Category** (e.g., Cuttables, Fasteners, Home Needs) and Stock Status.

### 3. Staff Dashboard (Worker UI)
- Built for extreme ease-of-use and muscle memory.
- Uses massive, brightly colored, contrasting action blocks (Receiving, Sending, Checkout, Check Price) so workers can navigate intuitively.
- The UI dynamically adapts based on the user's role (hiding checkout for non-billable staff) and device (hiding the camera scanner on desktop).

### 4. Dynamic Cloud Assets
- Logos are not hardcoded. The application fetches the specific shop's logo directly from the Supabase Storage bucket (`shop-logos`) based on their `shop_id`, allowing a completely white-labeled experience for different tenants.

---

## 5. Core Database Schema (Supabase)

1. **`shop_profiles`**: Tracks the individual businesses using the software (Shop Name, Owner Email, Address, Phone, Config).
2. **`product_master`**: The global catalog for a shop. Contains Name, Barcode, Categories, MRP, MSP, Store Stock, Warehouse Stock.
3. **`stock_instances`**: *(In Progress)* Tracks unique, fractional pieces (like individual cuts of mesh or gate sheets that are sold by square feet or meters).
4. **`workers`**: Tracks staff members, their hashed/stored passwords, and whether they are `NON_BILLABLE`.
5. **`pending_carts`**: Allows carts to be synchronized or held in the database temporarily.
6. **`receipts`**: Archives all completed transactions, including split payment metadata.

---

## 6. Design Philosophy & Aesthetics
- **Dark Mode Native:** The entire application runs on a sleek, modern dark theme designed to reduce eye strain in retail environments.
- **Subtle Micro-interactions:** Uses custom CSS animations like the `premium-wave-loader` for loading states and scale-transforms on buttons to make the app feel alive and responsive.
- **System Modals:** Browser-native `prompt()` and `alert()` popups have been entirely eradicated in favor of custom, highly styled React Modals to maintain immersion.
