import { useState, useRef, useEffect } from 'react';
import { supabase } from './supabaseClient'; 

export default function WorkerBilling({ inventory, refreshInventory, defaultTab = 'checkout', hideNav = false, shopSettings, cashierName }) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [cart, setCart] = useState([]); 
  const [barcode, setBarcode] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false); 
  const [lastReceipt, setLastReceipt] = useState(null);
  const [alertConfig, setAlertConfig] = useState({ isOpen: false, message: '', title: 'Notification' });
  const [inventorySearch, setInventorySearch] = useState('');

  const scannerInputRef = useRef(null); 

  const showAlert = (message, title = 'Notification') => setAlertConfig({ isOpen: true, message, title });
  const closeAlert = () => {
    setAlertConfig({ ...alertConfig, isOpen: false });
    setTimeout(() => scannerInputRef.current?.focus(), 50);
  };

  useEffect(() => { 
    if (!alertConfig.isOpen && activeTab !== 'inventory') scannerInputRef.current?.focus(); 
  }, [alertConfig.isOpen, activeTab]); 

  const handleBackgroundClick = (e) => {
    if (!alertConfig.isOpen && activeTab !== 'inventory' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
      scannerInputRef.current?.focus();
    }
  };

  const handleScan = async (e) => {
    e.preventDefault(); 
    const cleanBarcode = barcode.trim();
    if (!cleanBarcode) return;

    // ERP FIX: Real-time DB lookup if not in local cache (Scalability)
    let item = inventory.find(i => i.barcode === cleanBarcode);
    if (!item) {
      const { data } = await supabase.from('inventory').select('*').eq('barcode', cleanBarcode).single();
      if (data && data.is_active !== false) item = data;
    }

    if (item) {
      const existingItemIndex = cart.findIndex(cartItem => cartItem.barcode === cleanBarcode);
      if (existingItemIndex >= 0) {
        const updatedCart = [...cart];
        updatedCart[existingItemIndex].quantity = (Number(updatedCart[existingItemIndex].quantity) || 1) + 1;
        setCart(updatedCart);
      } else {
        setCart([...cart, { ...item, id: Date.now(), barcode: cleanBarcode, discountPct: 0, quantity: 1, unit: item.unit || 'PCS' }]);
      }
      setTimeout(() => scannerInputRef.current?.focus(), 10);
    } else {
      showAlert(`Barcode ${cleanBarcode} not recognized.`, "Invalid Scan");
    }
    setBarcode(''); 
  };

  const updateQuantity = (id, newQty) => {
    if (newQty === '') return setCart(cart.map(item => item.id === id ? { ...item, quantity: '' } : item));
    const validQty = Number(newQty);
    if (validQty <= 0) setCart(cart.filter(item => item.id !== id));
    else setCart(cart.map(item => item.id === id ? { ...item, quantity: validQty } : item));
  };

  const updateDiscount = (id, newDiscount) => {
    const validDiscount = Math.min(100, Math.max(0, Number(newDiscount)));
    setCart(cart.map(item => item.id === id ? { ...item, discountPct: validDiscount } : item));
  };

  const calculateTotal = () => cart.reduce((total, item) => {
    const qty = item.quantity === '' ? 1 : Number(item.quantity);
    return total + ((item.price * (1 - item.discountPct / 100)) * qty);
  }, 0);

  const handleCompleteTransaction = async () => {
    if (cart.length === 0) return;
    if (!navigator.onLine) return showAlert("You are offline.", "Network Error");
    setIsCheckingOut(true);

    try {
      let dbAction = activeTab === 'receive' ? 'RECEIVE' : activeTab === 'transfer' ? 'TRANSFER' : 'SALE';
      let logLocation = activeTab === 'receive' ? 'Warehouse-Inbound' : activeTab === 'transfer' ? 'Warehouse-Transfer' : 'Store';
      let successMsg = activeTab === 'checkout' ? 'Sale complete. Printing receipt...' : 'Inventory updated successfully.';

      // ERP FIX: ATOMIC TRANSACTION via JSON Array
      const payload = {
        p_action: dbAction,
        p_location: logLocation,
        p_cashier_name: cashierName || 'Unknown',
        p_items: cart.map(item => ({
          barcode: item.barcode,
          name: item.name,
          quantity: item.quantity === '' ? 1 : Number(item.quantity),
          price: item.price,
          discountPct: item.discountPct,
          unit: item.unit
        }))
      };

      const { data, error } = await supabase.rpc('process_pos_transaction', payload);
      if (error) throw new Error(error.message); // Will throw stock errors from DB safely

      // ERP FIX: GST Tax Calculations for Receipt
      const total = calculateTotal();
      let totalTaxAmount = 0;
      let totalBaseAmount = 0;

      const receiptCart = cart.map(item => {
        const qty = item.quantity === '' ? 1 : Number(item.quantity);
        const finalRate = item.price * (1 - item.discountPct / 100);
        const lineTotal = finalRate * qty;
        
        const taxRate = item.tax_rate || 18;
        const lineBase = lineTotal / (1 + (taxRate / 100));
        const lineTax = lineTotal - lineBase;

        totalBaseAmount += lineBase;
        totalTaxAmount += lineTax;

        return { ...item, quantity: qty, finalRate, lineTotal, taxRate };
      });

      setLastReceipt({ 
        id: data.bill_id.split('-')[0], 
        items: receiptCart, 
        total, 
        baseAmount: totalBaseAmount,
        taxAmount: totalTaxAmount,
        date: new Date(), 
        type: activeTab,
        cashierName: cashierName || 'Unknown'
      });
      
      setCart([]);
      if (refreshInventory) refreshInventory();
      showAlert(successMsg, "Transaction Complete");
      
      if (activeTab === 'checkout' || activeTab === 'transfer') setTimeout(() => { window.print(); }, 100);

    } catch (error) {
      showAlert(`Transaction Failed: ${error.message}`, "Error");
    } finally {
      setIsCheckingOut(false);
    }
  };

  const processedInventory = inventory.filter(item => 
    item.name.toLowerCase().includes(inventorySearch.toLowerCase()) || 
    item.barcode.includes(inventorySearch)
  ).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100);

  return (
    <>
      {alertConfig.isOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in print:hidden px-4">
          <div className="bg-white border border-gray-400 w-full max-w-sm rounded-none shadow-[4px_4px_0px_rgba(0,0,0,0.15)]">
            <div className="bg-[#f3f3f3] p-2 border-b border-gray-400 flex justify-between"><span className="text-sm font-semibold">{alertConfig.title}</span><button onClick={closeAlert} className="text-gray-500 hover:text-red-600">×</button></div>
            <div className="p-6"><p className="text-sm">{alertConfig.message}</p></div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-400 flex justify-end"><button onClick={closeAlert} className="px-6 py-1.5 bg-[#0078D7] text-white text-sm rounded-none">OK</button></div>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center print:hidden h-full" onClick={handleBackgroundClick}>
        {!hideNav && (
          <div className="w-full max-w-6xl mb-4 flex flex-wrap gap-2 overflow-x-auto whitespace-nowrap">
            <button onClick={() => { setActiveTab('receive'); setCart([]); }} className={`px-4 py-2 text-sm border border-gray-400 rounded-none ${activeTab === 'receive' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Receive Inbound</button>
            <button onClick={() => { setActiveTab('transfer'); setCart([]); }} className={`px-4 py-2 text-sm border border-gray-400 rounded-none ${activeTab === 'transfer' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Move to Store</button>
            <button onClick={() => { setActiveTab('checkout'); setCart([]); }} className={`px-4 py-2 text-sm border border-gray-400 rounded-none ${activeTab === 'checkout' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Customer Checkout</button>
            <button onClick={() => setActiveTab('inventory')} className={`px-4 py-2 text-sm border border-gray-400 rounded-none ${activeTab === 'inventory' ? 'bg-[#0078D7] text-white' : 'bg-white text-black hover:bg-gray-100'}`}>Live Inventory</button>
          </div>
        )}

        <div className="w-full max-w-6xl bg-white border border-gray-400 rounded-none shadow-none h-full min-h-125">
          {activeTab === 'inventory' ? (
            <div className="p-4 md:p-6 animate-fade-in">
              <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-6">
                <h1 className="text-2xl font-light text-black">Master Inventory View</h1>
                <input type="text" placeholder="Search item..." value={inventorySearch} onChange={(e) => setInventorySearch(e.target.value)} className="w-full md:w-auto px-3 py-1.5 border border-gray-400 text-sm focus:outline-none focus:border-[#0078D7] rounded-none" />
              </div>
              <div className="border border-gray-400 overflow-x-auto max-h-150">
                <table className="w-full text-left border-collapse min-w-[500px]">
                  <thead className="sticky top-0 bg-[#e6e6e6]">
                    <tr className="text-black text-xs uppercase border-b border-gray-400">
                      <th className="p-3">Barcode</th>
                      <th className="p-3">Item Name</th>
                      <th className="p-3 text-center">Unit</th>
                      <th className="p-3 text-center">Whse Stock</th>
                      <th className="p-3 text-center">Store Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {processedInventory.map(item => (
                      <tr key={item.id} className="hover:bg-[#f0f0f0]">
                        <td className="p-3 text-sm text-[#0078D7] font-medium">{item.barcode}</td>
                        <td className="p-3 text-sm text-black">{item.name}</td>
                        <td className="p-3 text-sm text-center text-gray-600">{item.unit}</td>
                        <td className={`p-3 text-sm text-center font-bold ${item.stock_warehouse < 10 ? 'text-[#e81123]' : 'text-black'}`}>{item.stock_warehouse || 0}</td>
                        <td className={`p-3 text-sm text-center font-bold ${item.stock_store < 10 ? 'text-[#e81123]' : 'text-black'}`}>{item.stock_store || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="animate-fade-in flex flex-col h-full">
              <div className={`p-4 flex justify-between items-center border-b border-gray-400 ${activeTab === 'receive' ? 'bg-[#e6f4ea]' : activeTab === 'transfer' ? 'bg-[#fff4ce]' : 'bg-[#f3f3f3]'}`}>
                <div>
                  <h1 className="text-lg md:text-xl font-light text-black">
                    {activeTab === 'receive' && 'Receive Wholesaler Shipment'}
                    {activeTab === 'transfer' && 'Transfer Items to Store'}
                    {activeTab === 'checkout' && 'Customer Checkout'}
                  </h1>
                  <p className="text-gray-500 text-xs mt-1 hidden md:block">Ready to scan barcodes...</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 uppercase">Total Value</p>
                  <p className="text-2xl md:text-3xl font-light text-[#0078D7]">₹{calculateTotal().toFixed(2)}</p>
                </div>
              </div>

              <form onSubmit={handleScan} className="opacity-0 h-0 w-0 overflow-hidden"><input ref={scannerInputRef} type="text" value={barcode} onChange={(e) => setBarcode(e.target.value)} autoFocus /><button type="submit">Scan</button></form>

              <div className="flex-1 overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead>
                    <tr className="bg-[#e6e6e6] text-black text-xs uppercase border-b border-gray-400">
                      <th className="p-3 border-r border-gray-300 w-1/3">Item Name</th>
                      <th className="p-3 border-r border-gray-300 w-32 text-center">Qty</th>
                      <th className="p-3 border-r border-gray-300 text-right">Unit Price</th>
                      <th className="p-3 border-r border-gray-300 w-28 text-center">Discount (%)</th>
                      <th className="p-3 text-right bg-[#e6e6e6]">Line Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {cart.length === 0 ? (<tr><td colSpan="5" className="p-8 text-center text-gray-500 text-sm">No items scanned.</td></tr>) : (
                      cart.map((item) => {
                        const safeQty = item.quantity === '' ? 1 : Number(item.quantity);
                        return (
                          <tr key={item.id} className="hover:bg-[#f0f0f0]">
                            <td className="p-3 border-r border-gray-200 text-sm text-black">{item.name} <span className="text-gray-400 text-xs block">#{item.barcode}</span></td>
                            <td className="p-3 border-r border-gray-200">
                              <div className="flex items-center justify-center">
                                <button type="button" onClick={() => updateQuantity(item.id, (Number(item.quantity) || 1) - 1)} className="px-2 py-1 bg-[#e6e6e6] hover:bg-[#cccccc] border border-gray-400 border-r-0 text-black font-bold">-</button>
                                <input type="number" min="1" value={item.quantity} onChange={(e) => updateQuantity(item.id, e.target.value)} className="w-12 px-1 py-1 border border-gray-400 text-sm text-center focus:outline-none rounded-none" />
                                <button type="button" onClick={() => updateQuantity(item.id, (Number(item.quantity) || 1) + 1)} className="px-2 py-1 bg-[#e6e6e6] hover:bg-[#cccccc] border border-gray-400 border-l-0 text-black font-bold">+</button>
                              </div>
                            </td>
                            <td className="p-3 border-r border-gray-200 text-sm text-right text-black">{item.price.toFixed(2)}</td>
                            <td className="p-3 border-r border-gray-200"><input type="number" min="0" max="100" value={item.discountPct === 0 ? '' : item.discountPct} onChange={(e) => updateDiscount(item.id, e.target.value)} placeholder="0" className="w-full px-2 py-1 border border-gray-400 text-sm text-center rounded-none" disabled={activeTab !== 'checkout'} /></td>
                            <td className="p-3 text-right text-sm font-semibold text-[#0078D7]">₹{((item.price * (1 - item.discountPct / 100)) * safeQty).toFixed(2)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {cart.length > 0 && (
                <div className="p-4 bg-[#f3f3f3] border-t border-gray-400 flex justify-end">
                  <button onClick={handleCompleteTransaction} disabled={isCheckingOut} className="px-8 py-2 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm disabled:opacity-50 rounded-none w-full md:w-auto">
                    {isCheckingOut ? 'Processing...' : 'Confirm & Complete'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* ERP FIX: Official GST Format Receipt */}
      {lastReceipt && (lastReceipt.type === 'checkout' || lastReceipt.type === 'transfer') && (
        <div className="hidden print:block text-black font-mono text-xs w-[80mm] mx-auto bg-white p-4">
          
          <div className="text-center mb-3">
            <h1 className="text-xl font-bold uppercase">{lastReceipt.type === 'transfer' ? 'INTERNAL TRANSFER' : shopSettings?.shop_name || 'STORE RECEIPT'}</h1>
            {lastReceipt.type === 'checkout' && <p className="text-[10px]">Owner: {shopSettings?.owner_name}</p>}
            {lastReceipt.type === 'checkout' && <p className="text-[10px]">TAX INVOICE</p>}
          </div>

          <div className="mb-3 text-[10px] flex justify-between border-b border-black border-dashed pb-2">
            <div>
              <p>Bill No: {lastReceipt.id}</p>
              <p>Date: {lastReceipt.date.toLocaleDateString()}</p>
              <p className="capitalize">Cashier: {lastReceipt.cashierName}</p>
            </div>
            <div className="text-right">
              <p>Type: {lastReceipt.type === 'transfer' ? 'TRANSFER' : 'CASH SALE'}</p>
              <p>Time: {lastReceipt.date.toLocaleTimeString()}</p>
            </div>
          </div>
          
          <table className="w-full mb-3 text-[10px]">
            <thead>
              <tr className="border-b border-black border-dashed">
                <th className="text-left font-semibold pb-1 w-1/2">Item</th>
                <th className="text-center font-semibold pb-1 w-1/6">Qty</th>
                <th className="text-right font-semibold pb-1 w-1/6">Rate</th>
                <th className="text-right font-semibold pb-1 w-1/6">Amt</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {lastReceipt.items.map((item, i) => (
                <tr key={i}>
                  <td className="py-1 pr-1 text-wrap">
                    {item.name}
                    {item.discountPct > 0 && <span className="block text-[8px] text-gray-600">(-{item.discountPct}%)</span>}
                  </td>
                  <td className="py-1 text-center">{item.quantity} {item.unit}</td>
                  <td className="py-1 text-right">{item.finalRate.toFixed(2)}</td>
                  <td className="py-1 text-right">{item.lineTotal.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {lastReceipt.type === 'checkout' && (
            <div className="border-t border-black border-dashed pt-2 mb-2 text-[10px]">
              <div className="flex justify-between"><span className="text-gray-600">Taxable Base Amt:</span><span>₹{lastReceipt.baseAmount.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">CGST:</span><span>₹{(lastReceipt.taxAmount / 2).toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">SGST:</span><span>₹{(lastReceipt.taxAmount / 2).toFixed(2)}</span></div>
            </div>
          )}
          
          <div className="border-t border-black pt-2 flex justify-between items-center mb-4">
            <span className="font-bold text-sm">TOTAL AMOUNT</span>
            <span className="font-bold text-lg">₹{lastReceipt.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </div>

          {lastReceipt.type === 'checkout' && (
            <div className="text-center text-[10px] border-t border-black border-dashed pt-2 mt-2">
              <p>Thank You For Your Business!</p>
              <p>Goods once sold will not be taken back.</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}