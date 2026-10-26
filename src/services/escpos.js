/**
 * Direct ESC/POS Thermal Printing Service
 * Communicates directly with POS thermal receipt printers (Epson, TVS, NGX, Rongta, Munbyn, Xprinter, etc.)
 * via WebSerial or WebUSB for instant (sub-100ms) printing, native paper cutting, and cash drawer kick pulses.
 */

// Global active port reference
let activeSerialPort = null;
let activeUsbDevice = null;
let activeUsbEndpoint = null;

export const isWebSerialSupported = () => {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
};

export const isWebUsbSupported = () => {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
};

export const isDirectEscPosSupported = () => {
  return isWebSerialSupported() || isWebUsbSupported();
};

/**
 * Connect to a thermal printer via WebSerial
 */
export async function connectSerialPrinter(baudRate = 9600) {
  if (!isWebSerialSupported()) {
    throw new Error('WebSerial is not supported by this browser. Use Chrome, Edge, or Opera.');
  }

  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate });
    activeSerialPort = port;
    return { success: true, type: 'serial', port };
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return { success: false, cancelled: true };
    }
    throw err;
  }
}

/**
 * Connect to a thermal printer via WebUSB
 */
export async function connectUsbPrinter() {
  if (!isWebUsbSupported()) {
    throw new Error('WebUSB is not supported by this browser.');
  }

  try {
    // Request thermal printer device (class 0x07 is printers)
    const device = await navigator.usb.requestDevice({
      filters: [{ classCode: 0x07 }]
    });

    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }
    await device.claimInterface(0);

    // Find OUT endpoint for writing raw bytes
    const endpoint = device.configuration.interfaces[0].alternate.endpoints.find(
      ep => ep.direction === 'out'
    );

    activeUsbDevice = device;
    activeUsbEndpoint = endpoint;

    return { success: true, type: 'usb', device };
  } catch (err) {
    if (err.name === 'NotFoundError') {
      return { success: false, cancelled: true };
    }
    throw err;
  }
}

/**
 * Disconnect current thermal printer
 */
export async function disconnectThermalPrinter() {
  if (activeSerialPort) {
    try {
      await activeSerialPort.close();
    } catch (e) {
      console.warn("Error closing serial port:", e);
    }
    activeSerialPort = null;
  }
  if (activeUsbDevice) {
    try {
      await activeUsbDevice.close();
    } catch (e) {
      console.warn("Error closing USB device:", e);
    }
    activeUsbDevice = null;
    activeUsbEndpoint = null;
  }
}

/**
 * Returns connection status of thermal printer
 */
export function getThermalPrinterStatus() {
  if (activeSerialPort) {
    return { isConnected: true, type: 'serial' };
  }
  if (activeUsbDevice) {
    return { isConnected: true, type: 'usb', deviceName: activeUsbDevice.productName };
  }
  return { isConnected: false, type: null };
}

/**
 * ESC/POS Binary Command Generator for Receipts
 */
export function buildEscPosReceipt(receiptData, shopSettings = {}, options = {}) {
  const {
    charsPerLine = 32, // 32 for 58mm thermal rolls, 48 for 80mm rolls
    openDrawer = false,
    cutPaper = true
  } = options;

  const commands = [];

  // Helper to append ASCII string
  const addText = (text) => {
    // Replace rupee symbol and non-ascii characters with clean ASCII representations
    const clean = String(text ?? '')
      .replace(/₹/g, 'Rs.')
      .replace(/[^\x00-\x7F]/g, '');
    const encoder = new TextEncoder();
    commands.push(...encoder.encode(clean));
  };

  const addBytes = (...bytes) => {
    commands.push(...bytes);
  };

  // 1. Initialize Printer (ESC @)
  addBytes(0x1B, 0x40);

  // 2. Open Cash Drawer Kick Pulse (ESC p 0 25 250)
  if (openDrawer) {
    addBytes(0x1B, 0x70, 0x00, 0x19, 0xFA);
  }

  // 3. Header: Shop Name (Double Height & Width, Centered)
  addBytes(0x1B, 0x61, 0x01); // Align Center
  addBytes(0x1D, 0x21, 0x11); // Double width & height
  addBytes(0x1B, 0x45, 0x01); // Bold ON

  const shopName = shopSettings?.shop_name || 'HARDWARE & ELECTRICALS';
  addText(shopName + '\n');

  addBytes(0x1D, 0x21, 0x00); // Normal text
  addBytes(0x1B, 0x45, 0x00); // Bold OFF

  const shopAddr = shopSettings?.shop_address?.replace('HIDDEN::', '') || '';
  if (shopAddr) addText(shopAddr + '\n');
  if (shopSettings?.phone) addText(`Tel: ${shopSettings.phone}\n`);
  if (shopSettings?.gstin) addText(`GSTIN: ${shopSettings.gstin}\n`);

  addBytes(0x1B, 0x61, 0x00); // Align Left

  // Separator
  const divider = '-'.repeat(charsPerLine) + '\n';
  addText(divider);

  // Bill Metadata
  const billId = receiptData?.id || receiptData?.bill_id || 'RECEIPT';
  const billDate = receiptData?.date ? new Date(receiptData.date) : new Date();
  const dateStr = billDate.toLocaleDateString('en-IN');
  const timeStr = billDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  addText(`Bill No: #${billId}\n`);
  addText(`Date: ${dateStr} ${timeStr}\n`);
  if (receiptData?.customerName) {
    addText(`Customer: ${receiptData.customerName}\n`);
  }
  if (receiptData?.customerPhone) {
    addText(`Phone: ${receiptData.customerPhone}\n`);
  }

  addText(divider);

  // Table Header
  const colFormat = charsPerLine === 48
    ? { name: 24, qty: 8, rate: 8, amt: 8 }
    : { name: 16, qty: 5, amt: 11 };

  if (charsPerLine === 48) {
    addText('ITEM                     QTY     RATE    AMOUNT\n');
  } else {
    addText('ITEM             QTY      AMOUNT\n');
  }
  addText(divider);

  // Items
  const items = receiptData?.items || [];
  items.forEach(item => {
    const isScrew = Boolean(item.is_screw || item.barcode === 'SCREWS');
    const itemName = item.name || (isScrew ? 'Screws' : 'Item');
    const qty = isScrew ? 1 : Number(item.quantity || 1);
    const unit = isScrew ? 'SET' : (item.unit || 'PCS');
    const rate = Number(item.finalRate || item.selling_price || item.price || 0);
    const amt = Number(item.lineTotal || (qty * rate)).toFixed(2);

    if (charsPerLine === 48) {
      const namePart = itemName.slice(0, colFormat.name).padEnd(colFormat.name);
      const qtyPart = isScrew ? '1 SET'.padStart(colFormat.qty) : `${qty}${unit}`.slice(0, colFormat.qty).padStart(colFormat.qty);
      const ratePart = isScrew ? '—'.padStart(colFormat.rate) : rate.toFixed(1).padStart(colFormat.rate);
      const amtPart = amt.padStart(colFormat.amt);
      addText(`${namePart}${qtyPart}${ratePart}${amtPart}\n`);
    } else {
      // 58mm wrap: Print full item name on first line, then qty & amount on second line
      addText(`${itemName}\n`);
      const qtyStr = isScrew ? `  1 SET` : `  ${qty} ${unit} @ ${rate.toFixed(2)}`;
      const amtStr = `Rs.${amt}`;
      const spaces = Math.max(1, charsPerLine - qtyStr.length - amtStr.length);
      addText(`${qtyStr}${' '.repeat(spaces)}${amtStr}\n`);
    }
  });

  addText(divider);

  // Totals Section
  const grandTotal = Number(receiptData?.total || 0).toFixed(2);
  const totalUnits = items.reduce((sum, i) => sum + (Number(i.quantity) || 1), 0);

  // Subtotal line
  const unitsStr = `Total Items: ${items.length} (${totalUnits} units)`;
  addText(`${unitsStr}\n`);

  // Grand Total (Bold, Double height)
  addBytes(0x1B, 0x45, 0x01); // Bold ON
  addBytes(0x1D, 0x21, 0x01); // Double height
  addBytes(0x1B, 0x61, 0x02); // Align Right
  addText(`TOTAL: Rs.${grandTotal}\n`);

  addBytes(0x1D, 0x21, 0x00); // Normal size
  addBytes(0x1B, 0x45, 0x00); // Bold OFF
  addBytes(0x1B, 0x61, 0x00); // Align Left

  // Payment Breakdown
  const method = receiptData?.paymentMethod || 'CASH';
  addText(`Payment Mode: ${method}\n`);

  if (method === 'CASH' && receiptData?.cashAmount) {
    const cashGiven = Number(receiptData.cashAmount);
    addText(`Cash Tendered: Rs.${cashGiven.toFixed(2)}\n`);
    const change = Math.max(0, cashGiven - Number(grandTotal));
    if (change > 0) {
      addText(`Change Returned: Rs.${change.toFixed(2)}\n`);
    }
  } else if (method === 'SPLIT') {
    if (receiptData?.upiAmount) addText(`UPI: Rs.${Number(receiptData.upiAmount).toFixed(2)}\n`);
    if (receiptData?.cashAmount) addText(`Cash: Rs.${Number(receiptData.cashAmount).toFixed(2)}\n`);
  }

  addText(divider);

  // Footer Message
  addBytes(0x1B, 0x61, 0x01); // Align Center
  addText("THANK YOU FOR YOUR BUSINESS!\n");
  addText("Goods once sold can be exchanged\nwithin 7 days with this bill.\n");
  addText(divider);

  // Feed 4 lines
  addBytes(0x0A, 0x0A, 0x0A, 0x0A);

  // Paper Cut (GS V 65 3)
  if (cutPaper) {
    addBytes(0x1D, 0x56, 0x41, 0x03);
  }

  return new Uint8Array(commands);
}

/**
 * Print raw ESC/POS bytes directly to connected printer
 */
export async function printDirectEscPos(receiptData, shopSettings, options = {}) {
  const binaryData = buildEscPosReceipt(receiptData, shopSettings, options);

  // Try WebSerial first if available and connected
  if (activeSerialPort && activeSerialPort.writable) {
    try {
      const writer = activeSerialPort.writable.getWriter();
      try {
        await writer.write(binaryData);
      } finally {
        writer.releaseLock();
      }
      return { success: true, method: 'webserial' };
    } catch (err) {
      console.warn("Error writing to active serial port, clearing cache:", err);
      activeSerialPort = null;
    }
  }

  // Try WebUSB if available and connected
  if (activeUsbDevice && activeUsbEndpoint) {
    try {
      await activeUsbDevice.transferOut(activeUsbEndpoint.endpointNumber, binaryData);
      return { success: true, method: 'webusb' };
    } catch (err) {
      console.warn("Error writing to active USB printer, clearing cache:", err);
      activeUsbDevice = null;
      activeUsbEndpoint = null;
    }
  }

  // If not currently connected, attempt interactive connect via WebSerial if supported
  if (isWebSerialSupported()) {
    try {
      const conn = await connectSerialPrinter();
      if (conn.success && activeSerialPort?.writable) {
        const writer = activeSerialPort.writable.getWriter();
        try {
          await writer.write(binaryData);
        } finally {
          writer.releaseLock();
        }
        return { success: true, method: 'webserial' };
      }
      if (conn.cancelled) {
        return { success: false, cancelled: true };
      }
    } catch (err) {
      console.warn("Interactive WebSerial connect failed:", err);
    }
  }

  // Attempt interactive connect via WebUSB if supported
  if (isWebUsbSupported()) {
    try {
      const conn = await connectUsbPrinter();
      if (conn.success && activeUsbDevice && activeUsbEndpoint) {
        await activeUsbDevice.transferOut(activeUsbEndpoint.endpointNumber, binaryData);
        return { success: true, method: 'webusb' };
      }
      if (conn.cancelled) {
        return { success: false, cancelled: true };
      }
    } catch (err) {
      console.warn("Interactive WebUSB connect failed:", err);
    }
  }

  throw new Error("No connected thermal printer found.");
}
