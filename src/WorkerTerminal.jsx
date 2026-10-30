import React, { useState, useRef, useEffect, useCallback, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { Spinner } from './SharedUI';
import ReceiptTemplate from './ReceiptTemplate';
import { PrintPreviewModal } from './AppModals';
import { useCart } from './contexts/CartContext';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { useQueryClient } from '@tanstack/react-query';
import { getInventoryItemByBarcode, queueOfflineTransaction, getInventoryByQuery, saveInventoryBatch } from './services/db';
import { syncInventoryToLocal } from './services/sync';
import { useApp } from './AppContext';
import { generateId, formatDateTime, calculateMSP } from './utils';
import { SCAN_TIMEOUT_MS } from './constants';

import InlineContinuousScanner from './components/scanner/InlineContinuousScanner';
import CartTable from './components/cart/CartTable';
import CartMobileView from './components/cart/CartMobileView';
import { playScanSuccessSound, playScanErrorSound, playPaymentSuccessSound } from './services/audio';
import {
  CheckoutModal,
  SelectBatchModal,
  LooseItemModal,
  SelectPieceModal,
  ReceiveLengthModal,
  ManualInstanceBarcodeModal,
  CutLengthModal,
  ScrewsModal
} from './components/terminal';
import { broadcastStockUpdate, subscribeToStockUpdates } from './services/realtimeStock';

// Dynamic smart denomination suggestions for rapid cash checkout
function getQuickTenderOptions(total) {
  if (!total || total <= 0) return [];
  const ceilTotal = Math.ceil(total);
  const pills = [];

  const standardNotes = [50, 100, 200, 500, 1000, 2000];

  // Nearest friendly note (next 50 or 100)
  if (ceilTotal < 500 && ceilTotal % 50 !== 0) {
    const next50 = Math.ceil(ceilTotal / 50) * 50;
    if (next50 > ceilTotal && !standardNotes.includes(next50)) {
      pills.push({ label: `₹${next50}`, value: next50 });
    }
  } else if (ceilTotal >= 500 && ceilTotal < 2000 && ceilTotal % 100 !== 0) {
    const next100 = Math.ceil(ceilTotal / 100) * 100;
    if (next100 > ceilTotal && !standardNotes.includes(next100)) {
      pills.push({ label: `₹${next100}`, value: next100 });
    }
  }

  // Next standard currency notes above total
  standardNotes.filter(n => n > ceilTotal).slice(0, 3).forEach(note => {
    if (!pills.some(p => p.value === note)) {
      pills.push({ label: `₹${note}`, value: note });
    }
  });

  // If bill is large (>= 2000), offer next multiples of 500 and 1000
  if (ceilTotal >= 2000) {
    const next500 = Math.ceil(ceilTotal / 500) * 500;
    if (next500 > ceilTotal && !pills.some(p => p.value === next500)) {
      pills.push({ label: `₹${next500}`, value: next500 });
    }
    const next1000 = Math.ceil(ceilTotal / 1000) * 1000;
    if (next1000 > next500 && !pills.some(p => p.value === next1000)) {
      pills.push({ label: `₹${next1000}`, value: next1000 });
    }
  }

  return pills;
}

// ---------------------------------------------------------------
// Main WorkerTerminal component (orchestrator)
// ---------------------------------------------------------------
export default function WorkerTerminal({ activeTab, shopSettings, cashierName }) {
  const { showAlert, showConfirm, alertConfig, confirmConfig, userRole, isWarehouseDisabled, showToast } = useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (activeTab === 'transfer' && isWarehouseDisabled) {
      navigate('/terminal/checkout', { replace: true });
    }
  }, [activeTab, isWarehouseDisabled, navigate]);

  const { 
    cart, setCart,
    removeItem: handleRemoveItem,
    activeCartTab, setActiveCartTab, switchCartTab,
    cartSessions, setCartSessions, 
    heldCarts, setHeldCarts,
    clearCart,
    cancelHeldCart
  } = useCart();
  const [manualBarcode, setManualBarcode] = useState('');
  const [isMobileScannerOpen, setIsMobileScannerOpen] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [checkoutModal, setCheckoutModal] = useState({ isOpen: false, cashGiven: '', negotiatedTotal: '', paymentMethod: 'CASH', splitUpi: '', splitCash: '', customerName: '', customerPhone: '', error: '' });
  const [screwsModal, setScrewsModal] = useState({ isOpen: false, price: '' });
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [looseItemModal, setLooseItemModal] = useState({ isOpen: false, item: null, qty: '' });
  const [selectedCartIndex, setSelectedCartIndex] = useState(null);

  // Refs for auto-scroll when new items are added
  const cartScrollRef = useRef(null);
  const mobileCartScrollRef = useRef(null);

  useEffect(() => {
    if (cart.length === 0) {
      setSelectedCartIndex(null);
    } else {
      setSelectedCartIndex(prev => {
        if (prev === null || prev >= cart.length) return cart.length - 1;
        return prev;
      });
    }
  }, [cart.length]);

  // Auto-scroll to bottom when a new item is scanned into the cart
  const prevCartLengthRef = useRef(cart.length);
  useEffect(() => {
    if (cart.length > prevCartLengthRef.current) {
      // New item added — scroll to bottom
      if (cartScrollRef.current) {
        cartScrollRef.current.scrollTo({ top: cartScrollRef.current.scrollHeight, behavior: 'smooth' });
      }
      if (mobileCartScrollRef.current) {
        mobileCartScrollRef.current.scrollTo({ top: mobileCartScrollRef.current.scrollHeight, behavior: 'smooth' });
      }
    }
    prevCartLengthRef.current = cart.length;
  }, [cart.length]);

  // Cuttable item states
  const [selectPieceModal, setSelectPieceModal] = useState({ isOpen: false, item: null, instances: [], isLoading: false, action: 'checkout' });
  const [cutLengthModal, setCutLengthModal] = useState({ isOpen: false, item: null, instance: null, cutQty: '', discardScrap: false });
  const [receiveLengthModal, setReceiveLengthModal] = useState({ isOpen: false, item: null, length: '', batch: null, instanceBarcode: null });
  const [manualInstanceBarcodeModal, setManualInstanceBarcodeModal] = useState({ isOpen: false, item: null, batch: null, barcodeInput: '', prefix: '', error: null });
  
  // Batch selection
  const [selectBatchModal, setSelectBatchModal] = useState({ isOpen: false, item: null, batches: [] });

  // Pending Carts (Mobile Scanner)
  const [pendingCarts, setPendingCarts] = useState([]);
  
  // Offline status
  const [isOnline, setIsOnline] = useState(navigator.onLine);


  const [isInputFocused, setIsInputFocused] = useState(false);
  const barcodeBuffer = useRef('');
  const lastKeyTime = useRef(Date.now());
  const lastScanKeyTime = useRef(0);
  const scanBurstBuffer = useRef('');
  const scanBurstTimestamps = useRef([]);
  const cartRef = useRef(cart);
  // Refs for values used inside the keydown closure (fixes stale closure #18)
  const activeTabRef = useRef(activeTab);
  const showAlertRef = useRef(showAlert);

  useEffect(() => { cartRef.current = cart; }, [cart]);


  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  
  useEffect(() => {
    // Prevent state desync ("COMMAREA Loss") by resetting modals when navigating between tabs
    setCutLengthModal({ isOpen: false, item: null, instance: null, cutQty: '', discardScrap: false });
    setLooseItemModal({ isOpen: false, item: null, qty: '' });
    setManualBarcode('');
    setSuggestions([]);
    setShowSuggestions(false);
  }, [activeTab]);

  useEffect(() => { showAlertRef.current = showAlert; }, [showAlert]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (activeTab === 'checkout') {
      const fetchPending = async () => {
        const shopId = localStorage.getItem('shop_id');
        let q = supabase.from('pending_carts').select('*').eq('status', 'pending').order('created_at', { ascending: true });
        if (shopId) {
          q = q.eq('shop_id', shopId);
        }
        const { data } = await q;
        if (data) setPendingCarts(data);
      };
      fetchPending();
      
      const channel = supabase.channel('pending_carts_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_carts' }, () => {
          fetchPending();
        })
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    }
  }, [activeTab]);

  // Realtime Terminal Stock Broadcasting Listener
  useEffect(() => {
    const currentShopId = shopSettings?.id || (typeof localStorage !== 'undefined' ? localStorage.getItem('shop_id') : null);
    const sub = subscribeToStockUpdates({
      shopId: currentShopId,
      getCartItems: () => cartRef.current || [],
      onStockUpdate: () => {
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
        queryClient.invalidateQueries({ queryKey: ['piece_counts'] });
      },
      onCartConflict: ({ item, remainingStoreStock }) => {
        playScanErrorSound();
        showAlertRef.current?.(
          `Another counter terminal just sold units of "${item.name}". Remaining store stock is now ${remainingStoreStock} ${item.unit}. Please verify cart quantities!`,
          "Stock Depleted by Other Terminal"
        );
      }
    });

    return () => {
      sub.unsubscribe();
    };
  }, [shopSettings?.id, queryClient]);


  const handleHoldCart = () => {
    if (cart.length === 0) return;
    if (activeCartTab !== 'local') {
      showAlertRef.current("You can only hold the Local Cart.", "Notice");
      return;
    }
    const newHeld = {
      id: 'held_' + generateId(),
      name: `Hold ${new Date().toLocaleTimeString([], {hour: 'numeric', minute:'2-digit', hour12: true})}`,
      items: cart
    };
    setHeldCarts(prev => [...prev, newHeld]);
    setCart([]);
    setCartSessions(prev => ({ ...prev, local: [] }));
  };

  useEffect(() => {
    if (manualBarcode.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const fetchSuggestions = async () => {
      try {
        const searchStr = manualBarcode.trim();
        const baseSearch = searchStr;
        const { data: parentData } = await getInventoryByQuery({
          limit: 10,
          offset: 0,
          search: baseSearch,
        });
        
        let finalSuggestions = parentData || [];
        
        // Check if search matches any active stock instances for current shop (when online)
        if (navigator.onLine && supabase) {
          try {
            const shopId = localStorage.getItem('shop_id');
            let instQuery = supabase.from('stock_instances')
              .select('instance_barcode, current_length, parent_barcode, inventory:product_master(name, unit)')
              .ilike('instance_barcode', `%${searchStr}%`)
              .eq('is_active', true);
            if (shopId) {
              instQuery = instQuery.eq('shop_id', shopId);
            }
            const { data: instData } = await instQuery.limit(5);
              
            if (instData && instData.length > 0) {
              const instanceSuggestions = instData.map(inst => {
                const parentName = inst.inventory?.name || 'Unknown Item';
                const parentUnit = inst.inventory?.unit || 'UNIT';
                return {
                  barcode: inst.instance_barcode,
                  name: `${parentName} (Piece #${inst.instance_barcode.slice(-6)}) [${inst.current_length} ${parentUnit === 'SQFT' ? 'ft' : parentUnit}]`,
                  isInstancePlaceholder: true // Just a visual flag
                };
              });
              
              // Add specific instances to the top of the list
              finalSuggestions = [...instanceSuggestions, ...finalSuggestions];
            }
          } catch (instErr) {
            console.warn("Stock instance suggestion error (offline/unavailable):", instErr);
          }
        }
        
        setSuggestions(finalSuggestions);
        setShowSuggestions(true);
      } catch (error) {
        console.error("Suggestion fetch error:", error);
      }
    };
    const timer = setTimeout(fetchSuggestions, 200);
    return () => clearTimeout(timer);
  }, [manualBarcode]);

  const processScan = useCallback(async (scannedCode) => {
    try {
      const cleanBarcode = scannedCode.trim();
      if (!cleanBarcode) return;

      if (activeTab === 'checkout' && cleanBarcode.toUpperCase() === 'SCREWS') {
        const existing = cartRef.current.find(i => i.is_screw || i.barcode === 'SCREWS');
        const currentVal = existing ? (existing.customPriceInput !== undefined ? String(existing.customPriceInput) : String(existing.price || '')) : '';
        setScrewsModal({ isOpen: true, price: currentVal });
        return;
      }

      let scannedInstanceBarcode = null;
      let scannedBatchNumber = null;
    let searchBarcode = cleanBarcode.replace(/\s+/g, '-'); // Scanner keyboard mapping issues sometimes turn hyphens into spaces

    // First try exact match in inventory
    let item = cartRef.current.find(i => i.barcode === searchBarcode && !i.is_cuttable);
    if (!item) {
      item = await getInventoryItemByBarcode(searchBarcode);
    }

    // If exact match fails, check if it's a hyphenated instance barcode for cuttables or batches
    if (!item && searchBarcode.includes('-')) {
      const parts = searchBarcode.split('-');
      if (parts.length === 3 && !isNaN(parts[1]) && !isNaN(parts[2])) {
        const parentItem = await getInventoryItemByBarcode(parts[0]);
        if (parentItem && parentItem.is_cuttable) {
          searchBarcode = parts[0];
          scannedBatchNumber = Number(parts[1]);
          scannedInstanceBarcode = searchBarcode + '-' + parts[1] + parts[2];
          item = parentItem;
        }
      } else if (parts.length === 2 && !isNaN(parts[1])) {
        const parentItem = await getInventoryItemByBarcode(parts[0]);
        if (parentItem) {
          if (parentItem.is_cuttable) {
            searchBarcode = parts[0];
            // Cuttable instance barcodes are printed as [parent]-[batch][piece] (e.g. 1002-0104)
            // Batch is always the first 2 digits of the second part, since batch is padded to 2 chars.
            const batchStr = parts[1].length > 2 ? parts[1].slice(0, 2) : parts[1];
            scannedBatchNumber = Number(batchStr);
            scannedInstanceBarcode = searchBarcode + '-' + parts[1];
            item = parentItem;
          } else {
            searchBarcode = parts[0];
            scannedBatchNumber = Number(parts[1]);
            item = parentItem;
          }
        }
      }
    }

    if (!item) {
      playScanErrorSound();
      return showAlertRef.current(`Barcode ${cleanBarcode} not found in the system.`, "Error");
    }

    if (item) {
      const currentTab = activeTabRef.current;

      // Cuttable items receive logic
      if (item.is_cuttable && currentTab === 'receive') {
        if (scannedInstanceBarcode) {
          // Find the batch to attach its prices
          let batch = null;
          if (scannedBatchNumber !== null) {
            batch = (item.batches || []).find(b => b.batch_number === scannedBatchNumber);
            if (!batch) {
              playScanErrorSound();
              showAlertRef.current(`Batch #${String(scannedBatchNumber).padStart(2,'0')} of ${item.name} not found.`, "Batch Not Found");
              return;
            }
          }
          if (!batch && item.batches && item.batches.length > 0) {
            batch = item.batches[0]; // fallback
          }

          // 1. Initial synchronous check (fast path)
          if (cartRef.current.some(c => c.instance_barcode === scannedInstanceBarcode)) {
            playScanErrorSound();
            showAlertRef.current(`Piece #${scannedInstanceBarcode} is already in the cart!`, "Duplicate Scan");
            return;
          }

          // 2. Asynchronous check against database
          const { data: existingInstance } = await supabase.from('stock_instances')
            .select('id')
            .eq('instance_barcode', scannedInstanceBarcode)
            .maybeSingle();

          if (existingInstance) {
            playScanErrorSound();
            showAlertRef.current(`Piece #${scannedInstanceBarcode} already exists in the warehouse!`, "Already Exists");
            return;
          }

          // 3. Pure state update with race-condition fallback
          playScanSuccessSound();
          setCart(prev => {
            if (prev.some(c => c.instance_barcode === scannedInstanceBarcode)) {
              return prev; // Silently ignore duplicates to maintain purity
            }
            return [...prev, {
              ...item, 
              id: generateId(), 
              instance_barcode: scannedInstanceBarcode,
              scanned_barcode: cleanBarcode,
              batch_id: batch ? batch.batch_id : null,
              batch_number: batch ? batch.batch_number : null,
              customPriceInput: Number(batch?.selling_price ?? (item.price || 0)).toFixed(2), 
              discountPct: 0, 
              quantity: 1, 
              unit: item.unit, 
              length: '', 
              width: '', 
              default_length: item.default_length, 
              default_width: item.default_width, 
              has_preset_length: !!item.default_length, 
              has_preset_width: !!item.default_width, 
              purchase_cost: Number(batch?.purchase_cost ?? (item.cost_price || 0)).toFixed(2), 
              selling_price: Number(batch?.selling_price ?? (item.price || 0)).toFixed(2), 
              msp_price: Number(calculateMSP(batch, item)).toFixed(2),
              price: Number(batch?.selling_price ?? (item.price || 0)).toFixed(2),
              msp: Number(calculateMSP(batch, item)).toFixed(2)
            }];
          });
        } else {
          let autoSelectedBatch = null;
          if (scannedBatchNumber !== null && item.batches) {
            const specificBatch = item.batches.find(b => b.batch_number === scannedBatchNumber);
            if (specificBatch) {
              autoSelectedBatch = specificBatch;
            } else {
              playScanErrorSound();
              return showAlertRef.current(`Batch #${String(scannedBatchNumber).padStart(2,'0')} of ${item.name} not found.`, "Batch Not Found");
            }
          }

          let availableBatches = item.batches ? [...item.batches] : [];

          if (autoSelectedBatch) {
            availableBatches = [autoSelectedBatch];
          }

          if (availableBatches.length > 1 && !autoSelectedBatch) {
            setSelectBatchModal({ isOpen: true, item, batches: availableBatches });
            setManualBarcode('');
            return;
          } else if (availableBatches.length === 1 && !autoSelectedBatch) {
            autoSelectedBatch = availableBatches[0];
          } else if (availableBatches.length === 0) {
            playScanErrorSound();
            return showAlertRef.current(`No batches exist for ${item.name}. Please create a batch first.`, "No Batches");
          }

          setManualInstanceBarcodeModal({
            isOpen: true,
            item,
            batch: autoSelectedBatch,
            prefix: autoSelectedBatch ? `${item.barcode}-${String(autoSelectedBatch.batch_number).padStart(2, '0')}` : item.barcode,
            barcodeInput: ''
          });
        }
        setManualBarcode('');
        return;
      }

      // Cuttable items transfer logic
      if (item.is_cuttable && currentTab === 'transfer') {
        if (scannedInstanceBarcode) {
          // Verify instance exists and get length if transferring
          let instLength = item.default_length;
          let instBatchId = null;
          const shopId = item.shop_id || shopSettings?.id || localStorage.getItem('shop_id');
          let instQuery = supabase.from('stock_instances').select('current_length, batch_id').eq('instance_barcode', scannedInstanceBarcode);
          if (shopId) {
            instQuery = instQuery.eq('shop_id', shopId);
          }
          const { data } = await instQuery.maybeSingle();
          if (!data) {
            playScanErrorSound();
            return showAlertRef.current(`Piece #${scannedInstanceBarcode} does not exist!`, "Not Found");
          }
          if (!data.current_length || data.current_length <= 0) {
            playScanErrorSound();
            return showAlertRef.current(`Piece #${scannedInstanceBarcode} has no length left!`, "Empty Piece");
          }
          instLength = data.current_length;
          instBatchId = data.batch_id;

          // Add the scanned instance barcode directly to the cart as 1 piece
          setCart(prev => {
            const idx = prev.findIndex(c => c.instance_barcode === scannedInstanceBarcode);
            if (idx >= 0) {
              playScanErrorSound();
              showAlertRef.current(`Piece #${scannedInstanceBarcode} is already in the cart!`, "Already Added");
              return prev; // Already scanned
            }
            playScanSuccessSound();
            return [...prev, { ...item, id: generateId(), instance_barcode: scannedInstanceBarcode, batch_id: instBatchId, quantity: 1, unit: item.unit, length: '', width: '', default_length: item.default_length, default_width: item.default_width, pieceLength: instLength }];
          });
          setManualBarcode('');
          return;
        } else {
          // They searched the generic parent name in transfer mode
          setSelectPieceModal({ isOpen: true, item, instances: [], isLoading: true, action: 'transfer' });
          if (navigator.onLine) {
            supabase.rpc('get_stock_instances', { p_barcode: String(item.barcode) })
              .then(({ data }) => {
                const activeWarehousePieces = (data || []).filter(p => p.is_active && p.location === 'Warehouse');
                setSelectPieceModal(prev => ({ ...prev, instances: activeWarehousePieces, isLoading: false }));
              })
              .catch(() => setSelectPieceModal(prev => ({ ...prev, isLoading: false })));
          } else {
            setSelectPieceModal(prev => ({ ...prev, isLoading: false }));
            playScanErrorSound();
            showAlertRef.current("Cannot view active pieces while offline.", "Offline");
          }
          return;
        }
      }

      // Cuttable items logic (only applies in Checkout/Sale mode)
      if (item.is_cuttable && currentTab === 'checkout') {
        if (scannedInstanceBarcode) {
          // They scanned a specific piece directly
          setCutLengthModal({
            isOpen: true,
            item,
            instance: { instance_barcode: scannedInstanceBarcode, current_length: '...' },
            cutQty: '',
            discardScrap: false
          });
          
          if (navigator.onLine) {
            const shopId = item.shop_id || shopSettings?.id || localStorage.getItem('shop_id');
            let instQuery = supabase.from('stock_instances').select('*').eq('instance_barcode', scannedInstanceBarcode);
            if (shopId) {
              instQuery = instQuery.eq('shop_id', shopId);
            }
            instQuery.maybeSingle().then(({ data }) => {
              if (data) {
                setCutLengthModal(prev => prev.instance?.instance_barcode === scannedInstanceBarcode ? { ...prev, instance: data } : prev);
              } else {
                setCutLengthModal(prev => prev.instance?.instance_barcode === scannedInstanceBarcode ? { ...prev, instance: { instance_barcode: scannedInstanceBarcode, current_length: '?' } } : prev);
              }
            });
          }
        } else {
          // They searched the generic parent name
          setSelectPieceModal({ isOpen: true, item, instances: [], isLoading: true, action: 'checkout' });
          if (navigator.onLine) {
            supabase.rpc('get_stock_instances', { p_barcode: String(item.barcode) })
              .then(({ data }) => {
                const activeStorePieces = (data || []).filter(p => p.is_active && p.location === 'Store');
                setSelectPieceModal(prev => ({ ...prev, instances: activeStorePieces, isLoading: false }));
              })
              .catch(() => setSelectPieceModal(prev => ({ ...prev, isLoading: false })));
          } else {
            setSelectPieceModal(prev => ({ ...prev, isLoading: false }));
            showAlertRef.current("Cannot view active pieces while offline.", "Offline");
          }
        }
        return;
      }

      // Normal items batch auto-selection if scanned a specific batch barcode
      let autoSelectedBatch = null;
      if (scannedBatchNumber !== null && item.batches) {
        const specificBatch = item.batches.find(b => b.batch_number === scannedBatchNumber);
        if (specificBatch) {
          autoSelectedBatch = specificBatch;
        } else {
          playScanErrorSound();
          return showAlertRef.current(`Batch #${String(scannedBatchNumber).padStart(2,'0')} of ${item.name} not found.`, "Batch Not Found");
        }
      }

      // Normal items batch selection and stock check
      if (!item.is_cuttable || (item.is_cuttable && currentTab === 'receive')) {
        let availableBatches = item.batches ? [...item.batches] : [];

        if (autoSelectedBatch) {
           if (currentTab === 'checkout' || currentTab === 'transfer') {
             const stockField = currentTab === 'transfer' ? 'stock_warehouse' : 'stock_store';
             const locationName = currentTab === 'transfer' ? 'warehouse' : 'store';
             if (Number(autoSelectedBatch[stockField]) <= 0) {
               playScanErrorSound();
               return showAlertRef.current(`Batch #${String(scannedBatchNumber).padStart(2,'0')} of ${item.name} is out of stock in the ${locationName}.`, "Out of Stock");
             }
           }
           availableBatches = [autoSelectedBatch];
        }

        // Show popup if multiple batches available and none auto-selected
        if (availableBatches.length > 1 && !autoSelectedBatch) {
          setSelectBatchModal({ isOpen: true, item, batches: availableBatches });
          setManualBarcode('');
          return;
        } else if (availableBatches.length === 1 && !autoSelectedBatch) {
          autoSelectedBatch = availableBatches[0];
        } else if (availableBatches.length === 0) {
          playScanErrorSound();
          return showAlertRef.current(`No batches exist for ${item.name}. Please create a batch first.`, "No Batches");
        }
        
        // Stock Limits Check
        if (currentTab === 'checkout' || currentTab === 'transfer') {
          const stockField = currentTab === 'transfer' ? 'stock_warehouse' : 'stock_store';
          const locationName = currentTab === 'transfer' ? 'warehouse' : 'store';
          const totalStock = availableBatches.length === 1 ? Number(autoSelectedBatch[stockField]) : (item.batches ? item.batches.reduce((sum, b) => sum + Number(b[stockField]), 0) : Number(item[stockField] || 0));
          
          const currentCartItem = cartRef.current.find(c => c.barcode === item.barcode && (!autoSelectedBatch || c.batch_id === autoSelectedBatch.batch_id));
          const currentQty = currentCartItem ? (Number(currentCartItem.quantity) || 0) : 0;
          
          if (totalStock <= 0) {
            playScanErrorSound();
            return showAlertRef.current(`${item.name} is out of stock in the ${locationName}.`, "Out of Stock");
          }
          if (currentQty >= totalStock) {
            playScanErrorSound();
            return showAlertRef.current(`You only have ${totalStock} of ${item.name} in the ${locationName}.`, "Stock Limit");
          }
        }
      }

      if (item.is_loose_item) {
        setLooseItemModal({ isOpen: true, item, qty: '' });
        return;
      }

      playScanSuccessSound();
      setCart(prev => {
        const batch = autoSelectedBatch || (item.batches && item.batches.length === 1 ? item.batches[0] : null);
        const defaultPrice = batch?.selling_price ?? item.price;
        const msp = batch?.msp ?? item.msp;
        const batchId = batch ? batch.batch_id : null;
        
        const idx = prev.findIndex(c => c.barcode === item.barcode && c.batch_id === batchId);
        if (idx >= 0) { 
          const up = [...prev]; 
          up[idx] = { ...up[idx], quantity: (Number(up[idx].quantity) || 0) + 1, billableQuantity: (Number(up[idx].quantity) || 0) + 1 }; 
          return up; 
        }
        
        return [...prev, { 
          ...item, 
          id: generateId(), 
          scanned_barcode: (batch && batch.batch_number) ? `${item.barcode}-${String(batch.batch_number).padStart(2, '0')}` : cleanBarcode,
          customPriceInput: Number(defaultPrice || 0).toFixed(2), 
          price: defaultPrice,
          msp: msp,
          batch_id: batchId,
          batch_number: batch ? batch.batch_number : null,
          discountPct: 0, 
          quantity: (item.unit === 'SQFT' && item.is_cuttable) ? 0 : 1, 
          billableQuantity: (item.unit === 'SQFT' && item.is_cuttable) ? 0 : 1, 
          unit: item.unit || 'PCS', 
          length: '', width: '', rolls: '1',
          purchase_cost: Number(batch?.purchase_cost ?? (item.cost_price || 0)).toFixed(2), 
          selling_price: Number(batch?.selling_price ?? (item.price || 0)).toFixed(2),
          msp_price: Number(calculateMSP(batch, item)).toFixed(2)
        }];
      });
    }
    } catch (error) {
      console.error("Scan Error:", error);
      playScanErrorSound();
      showAlertRef.current(error.message || "An error occurred while looking up the barcode.", "Scanner Error");
    }
  }, []);



  const handleLooseItemSubmit = (e) => {
    if (e) e.preventDefault();
    const { item, qty } = looseItemModal;
    const isLooseKg = Boolean(
      item?.is_loose_item && (
        item?.unit?.toUpperCase() === 'KG' ||
        item?.unit?.toUpperCase() === 'KGS' ||
        item?.unit?.toUpperCase() === 'GRAMS' ||
        item?.unit?.toUpperCase() === 'GRAM' ||
        item?.unit?.toUpperCase() === 'G' ||
        item?.unit?.toUpperCase() === 'GM'
      )
    );
    const isCheckout = activeTab === 'checkout';

    // In checkout, loose KG items are entered in grams by the user
    const addQty = (isCheckout && isLooseKg) ? (Number(qty) / 1000) : (Number(qty) || 0);
    const enteredGrams = (isCheckout && isLooseKg) ? Math.round(Number(qty)) : null;

    if (addQty <= 0) {
      setLooseItemModal({ isOpen: false, item: null, qty: '' });
      return;
    }

    if (activeTab === 'checkout') {
      const currentCartItem = cart.find(c => c.barcode === item.barcode);
      const currentQty = currentCartItem ? (Number(currentCartItem.quantity) || 0) : 0;
      const proposedQty = currentQty + addQty;
      const maxStock = Number(item.stock_store || 0);
      if (proposedQty > maxStock) {
        playScanErrorSound();
        if (isLooseKg) {
          showAlert(`You only have ${maxStock} kg of ${item.name} in the store. You tried to add ${enteredGrams} g (${addQty.toFixed(3)} kg).`, "Stock Limit");
        } else {
          showAlert(`You only have ${maxStock} of ${item.name} in the store.`, "Stock Limit");
        }
        return;
      }
    } else if (activeTab === 'transfer') {
      const currentCartItem = cart.find(c => c.barcode === item.barcode);
      const currentQty = currentCartItem ? (Number(currentCartItem.quantity) || 0) : 0;
      const proposedQty = currentQty + addQty;
      const maxWhse = Number(item.stock_warehouse || 0);
      if (proposedQty > maxWhse) {
        playScanErrorSound();
        showAlert(`You only have ${maxWhse} kg of ${item.name} in the warehouse.`, "Stock Limit");
        return;
      }
    }

    playScanSuccessSound();
    setCart(prev => {
      const idx = prev.findIndex(c => c.barcode === item.barcode);
      if (idx >= 0) {
        const up = [...prev];
        const newQty = (Number(up[idx].quantity) || 0) + addQty;
        up[idx] = { 
          ...up[idx], 
          quantity: newQty,
          billableQuantity: newQty,
          grams: isLooseKg ? Math.round(newQty * 1000) : undefined
        };
        return up;
      }
      
      const stockField = activeTab === 'transfer' ? 'stock_warehouse' : 'stock_store';
      let targetBatch = null;
      if (item.batches && item.batches.length > 0) {
        targetBatch = item.batches.find(b => Number(b[stockField]) > 0) || item.batches[0];
      }
      
      return [...prev, {
        ...item,
        id: generateId(),
        scanned_barcode: targetBatch && targetBatch.batch_number ? `${item.barcode}-${String(targetBatch.batch_number).padStart(2, '0')}` : item.barcode,
        batch_id: targetBatch ? targetBatch.batch_id : null,
        batch_number: targetBatch ? targetBatch.batch_number : null,
        customPriceInput: Number(targetBatch ? targetBatch.selling_price : (item.price || 0)).toFixed(2),
        price: targetBatch ? targetBatch.selling_price : item.price,
        msp: calculateMSP(targetBatch, item),
        purchase_cost: Number(targetBatch && targetBatch.purchase_cost !== undefined ? targetBatch.purchase_cost : item.cost_price || 0).toFixed(2),
        selling_price: Number(targetBatch && targetBatch.selling_price !== undefined ? targetBatch.selling_price : item.price || 0).toFixed(2),
        msp_price: Number(calculateMSP(targetBatch, item)).toFixed(2),
        discountPct: 0,
        quantity: addQty,
        billableQuantity: addQty,
        grams: isLooseKg ? Math.round(addQty * 1000) : undefined,
        unit: item.unit || 'PCS',
        length: '', width: '', rolls: '1'
      }];
    });
    setLooseItemModal({ isOpen: false, item: null, qty: '' });
  };
  
  const handleSelectBatchSubmit = (batch) => {
    const item = selectBatchModal.item;
    setSelectBatchModal({ isOpen: false, item: null, batches: [] });
    
    if (item.is_cuttable && activeTabRef.current === 'receive') {
      setManualInstanceBarcodeModal({
        isOpen: true,
        item,
        batch,
        prefix: `${item.barcode}-${String(batch.batch_number).padStart(2, '0')}`,
        barcodeInput: ''
      });
      return;
    }
    
    playScanSuccessSound();
    setCart(prev => {
      const idx = prev.findIndex(c => c.barcode === item.barcode && c.batch_id === batch.batch_id);
      if (idx >= 0) {
        const up = [...prev];
        up[idx] = { ...up[idx], quantity: (Number(up[idx].quantity) || 0) + 1, billableQuantity: (Number(up[idx].quantity) || 0) + 1 };
        return up;
      }
      return [...prev, {
        ...item,
        id: generateId(),
        scanned_barcode: `${item.barcode}-${String(batch.batch_number).padStart(2, '0')}`,
        customPriceInput: Number(batch.selling_price || 0).toFixed(2),
        price: batch.selling_price,
        msp: calculateMSP(batch, item),
        purchase_cost: Number(batch.purchase_cost !== undefined ? batch.purchase_cost : item.cost_price || 0).toFixed(2),
        selling_price: Number(batch.selling_price !== undefined ? batch.selling_price : item.price || 0).toFixed(2),
        msp_price: Number(calculateMSP(batch, item)).toFixed(2),
        batch_id: batch.batch_id,
        batch_number: batch.batch_number,
        discountPct: 0,
        quantity: 1,
        billableQuantity: 1,
        unit: item.unit || 'PCS',
        length: '', width: '', rolls: '1'
      }];
    });
  };

  const handleCutLengthSubmit = (e) => {
    if (e) e.preventDefault();
    const { item, instance, cutQty, discardScrap } = cutLengthModal;
    const addQty = Math.round((Number(cutQty) || 0) * 100) / 100;

    if (addQty <= 0) {
      setCutLengthModal({ isOpen: false, item: null, instance: null, cutQty: '', discardScrap: false });
      return;
    }

    const currentLength = Number(instance.current_length);
    const alreadyInCart = cart.filter(c => c.instance_barcode === instance.instance_barcode).reduce((tot, c) => tot + ((Number(c.length) || Number(c.pieceLength) || 0) * (Number(c.rolls) || 1)), 0);
    const availableLength = Math.round((currentLength - alreadyInCart) * 100) / 100;
    if (!isNaN(currentLength) && addQty > availableLength) {
      playScanErrorSound();
      if (alreadyInCart > 0) {
        showAlert(`You already have ${alreadyInCart}${item.unit} of this piece in the cart. You only have ${availableLength.toFixed(2)}${item.unit} left!`, "Invalid Cut");
      } else {
        showAlert(`You are trying to cut ${addQty}${item.unit}, but the piece only has ${currentLength}${item.unit} left!`, "Invalid Cut");
      }
      return;
    }

    playScanSuccessSound();
    setCart(prev => {
      const batch = item.batches?.find(b => b.batch_id === instance.batch_id);
      const sellingPrice = batch?.selling_price ?? (item.price || 0);
      const purchaseCost = batch?.purchase_cost ?? (item.cost_price || 0);
      const mspPrice = batch?.msp ?? (item.msp || 0);

      return [...prev, {
        ...item,
        id: generateId(),
        instance_barcode: instance.instance_barcode,
        batch_id: instance.batch_id,
        batch_number: batch?.batch_number ?? null,
        purchase_cost: Number(purchaseCost).toFixed(2),
        selling_price: Number(sellingPrice).toFixed(2),
        msp_price: Number(mspPrice).toFixed(2),
        price: Number(sellingPrice).toFixed(2),
        msp: Number(mspPrice).toFixed(2),
        discard_scrap: discardScrap && (availableLength - addQty < 1) && (availableLength - addQty > 0),
        name: item.name,
        customPriceInput: Number(sellingPrice).toFixed(2),
        discountPct: 0,
        quantity: item.unit === 'SQFT' ? parseFloat((addQty * (Number(item.default_width) || 1)).toFixed(2)) : addQty,
        billableQuantity: (item.billing_method || 'exact') === 'round_up' ? Math.ceil(Number(item.unit === 'SQFT' ? parseFloat((addQty * (Number(item.default_width) || 1)).toFixed(2)) : addQty) * 2) / 2 : (item.unit === 'SQFT' ? parseFloat((addQty * (Number(item.default_width) || 1)).toFixed(2)) : addQty),
        unit: item.unit || 'PCS',
        length: addQty, 
        width: Number(item.default_width) || '',
        pieceLength: addQty,
        rolls: '1',
        max_available_length: currentLength
      }];
    });
    setCutLengthModal({ isOpen: false, item: null, instance: null, cutQty: '', discardScrap: false });
  };

  const addReceivedCuttableItem = (item, length, batch, instanceBarcode = null) => {
    playScanSuccessSound();
    setCart(prev => {
      return [...prev, { 
        ...item, 
        id: generateId(),
        instance_barcode: instanceBarcode,
        scanned_barcode: instanceBarcode || (batch ? `${item.barcode}-${String(batch.batch_number).padStart(2, '0')}` : item.barcode),
        quantity: 1, 
        billableQuantity: 1,
        pieceLength: length, 
        batch_id: batch?.batch_id || null,
        batch_number: batch?.batch_number || null,
        customPriceInput: Number(batch?.selling_price ?? (item.price || 0)).toFixed(2),
        purchase_cost: Number(batch?.purchase_cost ?? (item.cost_price || 0)).toFixed(2),
        selling_price: Number(batch?.selling_price ?? (item.price || 0)).toFixed(2),
        msp_price: Number(calculateMSP(batch, item)).toFixed(2),
        price: Number(batch?.selling_price ?? (item.price || 0)).toFixed(2),
        msp: Number(batch?.msp ?? (item.msp || 0)).toFixed(2)
      }];
    });
  };

  const handleReceiveLengthSubmit = (e) => {
    if (e) e.preventDefault();
    if (!receiveLengthModal.length) return;
    addReceivedCuttableItem(receiveLengthModal.item, receiveLengthModal.length, receiveLengthModal.batch, receiveLengthModal.instanceBarcode);
    setReceiveLengthModal({ isOpen: false, item: null, length: '', batch: null, instanceBarcode: null });
  };

  const handleManualInstanceBarcodeSubmit = async (e) => {
    if (e) e.preventDefault();
    const { item, batch, barcodeInput, prefix } = manualInstanceBarcodeModal;
    
    const cleanInput = (barcodeInput || '').trim();
    if (cleanInput.length < 2) {
      playScanErrorSound();
      setManualInstanceBarcodeModal(prev => ({ ...prev, error: "Please enter exactly 2 digits (e.g. 03)." }));
      return;
    }

    const fullBarcode = `${prefix}${cleanInput}`;

    if (cart.some(c => c.instance_barcode === fullBarcode)) {
      playScanErrorSound();
      setManualInstanceBarcodeModal(prev => ({ ...prev, error: `Piece #${fullBarcode} is already in the cart!` }));
      return;
    }

    try {
      const shopId = item.shop_id || shopSettings?.id || localStorage.getItem('shop_id');
      let existQuery = supabase.from('stock_instances').select('id').eq('instance_barcode', fullBarcode);
      if (shopId) {
        existQuery = existQuery.eq('shop_id', shopId);
      }
      const { data: existing } = await existQuery.maybeSingle();
      if (existing) {
        playScanErrorSound();
        setManualInstanceBarcodeModal(prev => ({ ...prev, error: `Piece #${fullBarcode} already exists in the system!` }));
        return;
      }
    } catch (err) {
      console.error(err);
    }

    if (item.default_length) {
      addReceivedCuttableItem(item, item.default_length, batch, fullBarcode);
    } else {
      setReceiveLengthModal({
        isOpen: true,
        item,
        batch,
        length: '',
        instanceBarcode: fullBarcode
      });
    }
    setManualInstanceBarcodeModal({ isOpen: false, item: null, batch: null, barcodeInput: '', prefix: '' });
  };

  const updateQuantity = useCallback((id, val, explicitGrams) => {
    setCart(prev => {
      let limitMsg = '';
      const newCart = prev.map(i => {
        if (i.id === id) {
          let newQty = val === '' ? '' : Math.max(0, Number(val));
          const isLooseKg = Boolean(
            i.is_loose_item && (
              i.unit?.toUpperCase() === 'KG' ||
              i.unit?.toUpperCase() === 'KGS' ||
              i.unit?.toUpperCase() === 'GRAMS' ||
              i.unit?.toUpperCase() === 'GRAM' ||
              i.unit?.toUpperCase() === 'G' ||
              i.unit?.toUpperCase() === 'GM'
            )
          );

          if (activeTab === 'checkout' && val !== '') {
            if (i.is_cuttable && i.instance_barcode && i.unit !== 'SQFT') {
              const maxLength = Number(i.max_available_length || 0);
              if (newQty > maxLength) {
                limitMsg = `You only have ${maxLength} ${i.unit} left on this piece.`;
                newQty = maxLength;
              }
            } else {
              const maxStock = i.batch_id && i.batches ? Number(i.batches.find(b => b.batch_id === i.batch_id)?.stock_store || 0) : Number(i.stock_store || 0);
              if (newQty > maxStock) {
                limitMsg = isLooseKg 
                  ? `You only have ${maxStock} kg in this batch in the store.`
                  : `You only have ${maxStock} in this batch in the store.`;
                newQty = maxStock;
              }
            }
          }
          
          let billableQty = newQty;
          const method = i.billing_method || 'exact';
          if (method === 'round_up' && newQty !== '') {
            billableQty = Math.ceil(Number(newQty) * 2) / 2;
          }
          
          const updatedGrams = explicitGrams !== undefined
            ? explicitGrams
            : (isLooseKg && newQty !== '' ? Math.round(Number(newQty) * 1000) : i.grams);

          return { 
            ...i, 
            quantity: newQty, 
            billableQuantity: billableQty, 
            grams: updatedGrams,
            pieceLength: (i.is_cuttable && i.unit !== 'SQFT') ? newQty : i.pieceLength, 
            customTotalInput: undefined 
          };
        }
        return i;
      }).filter(i => i.quantity !== 0);
      if (limitMsg) setTimeout(() => showAlert(limitMsg, "Stock Limit"), 0);
      return newCart;
    });
  }, [activeTab, showAlert, setCart]);

  const updateDimensions = useCallback((id, field, val) => {
    setCart(prev => {
      let limitMsg = '';
      const newCart = prev.map(i => {
        if (i.id === id) {
          const updated = { ...i, [field]: val };
          if (activeTab === 'receive') {
            return updated;
          }
          let l = Number(updated.length) || 0;
          const w = Number(updated.width) || 0;
          let r = updated.rolls === '' ? 1 : (Number(updated.rolls) || 1);
          let newQty = parseFloat((l * w * r).toFixed(2));
          
          if (activeTab === 'checkout' && newQty > 0) {
            if (updated.is_cuttable && updated.instance_barcode) {
              const maxLength = Number(updated.max_available_length || 0);
              const otherLengths = prev.filter(cartItem => cartItem.id !== id && cartItem.instance_barcode === updated.instance_barcode).reduce((sum, cartItem) => sum + ((Number(cartItem.length) || 0) * (Number(cartItem.rolls) || 1)), 0);
              const availableForThisRow = Math.max(0, maxLength - otherLengths);
              
              if ((l * r) > availableForThisRow) {
                if (field === 'rolls') {
                  r = Math.max(1, Math.floor(availableForThisRow / (l || 1)));
                  updated.rolls = r;
                  limitMsg = `You only have ${availableForThisRow} ft left on this piece. Clamped rolls to ${r}.`;
                }
                
                if ((l * r) > availableForThisRow) {
                  l = Number((availableForThisRow / r).toFixed(2));
                  updated.length = l;
                  limitMsg = `You only have ${availableForThisRow} ft left on this piece. Clamped length to ${l}.`;
                }
                newQty = parseFloat((l * w * r).toFixed(2));
              }
            } else {
              const maxStock = Number(i.stock_store || 0);
              if (newQty > maxStock) { limitMsg = `You only have ${maxStock} of ${i.name} in the store.`; newQty = maxStock; }
            }
          }
          let billableQty = newQty;
          const method = updated.billing_method || 'exact';
          if (method === 'round_up' && newQty !== '') {
            billableQty = Math.ceil(Number(newQty) * 2) / 2;
          }
          return { ...updated, quantity: newQty, billableQuantity: billableQty, customTotalInput: undefined };
        }
        return i;
      });
      if (limitMsg) setTimeout(() => showAlert(limitMsg, "Stock Limit"), 0);
      return newCart;
    });
  }, [activeTab, showAlert, setCart]);


  const handleCustomPriceChange = useCallback((id, val) => setCart(prev => prev.map(i => i.id === id ? { ...i, customPriceInput: val, customTotalInput: undefined } : i)), [setCart]);
  const handleCustomPriceChangeGroup = useCallback((groupKey, val) => setCart(prev => prev.map(i => {
    const iKey = i.barcode + '_' + (i.batch_id || 'default');
    return (iKey === groupKey && i.is_cuttable) ? { ...i, customPriceInput: val, customTotalInput: undefined } : i;
  })), [setCart]);

  const handleCustomTotalChange = useCallback((id, val, qty) => setCart(prev => prev.map(i => {
    if (i.id === id) {
      const numVal = Number(val);
      if (!isNaN(numVal) && qty > 0) {
        return { ...i, customTotalInput: val, customPriceInput: numVal / qty };
      }
      return { ...i, customTotalInput: val };
    }
    return i;
  })), [setCart]);

  const handleCustomTotalChangeGroup = useCallback((groupKey, val, totalQty) => setCart(prev => prev.map(i => {
    const iKey = i.barcode + '_' + (i.batch_id || 'default');
    if (iKey === groupKey && i.is_cuttable) {
      const numVal = Number(val);
      if (!isNaN(numVal) && totalQty > 0) {
        return { ...i, customTotalInput: val, customPriceInput: numVal / totalQty };
      }
      return { ...i, customTotalInput: val };
    }
    return i;
  })), [setCart]);

  const applyCustomPriceBlur = useCallback((id) => setCart(prev => prev.map(i => {
    if (i.id === id) {
      if (i.is_screw || i.barcode === 'SCREWS') {
        const val = Number(i.customPriceInput) || Number(i.price || 0);
        return {
          ...i,
          price: val,
          selling_price: val.toFixed(2),
          customPriceInput: val.toFixed(2),
          customTotalInput: val.toFixed(2),
          discountPct: 0
        };
      }
      const qty = i.billableQuantity !== undefined && i.billableQuantity !== '' ? Number(i.billableQuantity) : (i.quantity === '' ? 0 : Number(i.quantity));
      let val = Number(i.customPriceInput); if (isNaN(val)) val = Number(i.price || 0);
      const msp = Number(i.msp_price) || Number(i.msp) || Number(i.cost_price) || 0;
      const mrp = Number(i.price || 0);
      if (val < msp && msp > 0) {
        setTimeout(() => showAlertRef.current(`Cannot sell ${i.name} below MSP (₹${msp.toFixed(2)})`, "Price Error"), 0);
        val = msp;
      }
      const disc = (mrp > 0 && val < mrp) ? ((mrp - val) / mrp) * 100 : 0;
      return { ...i, customPriceInput: val, customTotalInput: (val * qty).toFixed(2), discountPct: disc };
    }
    return i;
  })), [setCart]);

  const handleCustomPriceBlurGroup = useCallback((groupKey) => {
    setCart(prev => {
      return prev.map(i => {
        const iKey = i.barcode + '_' + (i.batch_id || 'default');
        if (iKey === groupKey && i.is_cuttable) {
          const msp = Number(i.msp_price) || Number(i.msp) || Number(i.cost_price) || 0;
          let val = Number(i.customPriceInput);
          if (isNaN(val) || val <= 0) val = Number(i.price);
          if (val < msp && msp > 0) {
            setTimeout(() => showAlertRef.current(`Cannot sell ${i.name} below MSP (₹${msp.toFixed(2)})`, "Price Error"), 0);
            val = msp;
          }
          let newDisc = 0;
          if (Number(i.price) > 0 && val < Number(i.price)) {
            newDisc = ((Number(i.price) - val) / Number(i.price)) * 100;
          }
          const groupQty = cart.filter(c => (c.barcode + '_' + (c.batch_id || 'default')) === groupKey && c.is_cuttable).reduce((sum, c) => sum + (c.billableQuantity !== undefined && c.billableQuantity !== '' ? Number(c.billableQuantity) : (c.quantity === '' ? 0 : Number(c.quantity))), 0);
          return { ...i, customPriceInput: val, customTotalInput: groupQty > 0 ? (val * groupQty).toFixed(2) : '', discountPct: newDisc };
        }
        return i;
      });
    });
  }, [cart, setCart]);

  const calculateTotal = useCallback(() => cart.reduce((tot, i) => {
    const qty = i.billableQuantity !== undefined && i.billableQuantity !== '' ? Number(i.billableQuantity) : (i.quantity === '' ? 0 : Number(i.quantity));
    const price = i.customPriceInput !== undefined && i.customPriceInput !== '' ? Number(i.customPriceInput) : Number(i.price || 0);
    return tot + Math.round(price * qty * 100);
  }, 0) / 100, [cart]);
  
  const calculateTotalUnits = useCallback(() => cart.reduce((tot, i) => tot + (i.quantity === '' ? 0 : Number(i.quantity)), 0), [cart]);

  const handleRestoreCart = useCallback(async (tabId, overrideItems = null) => {
    if (tabId !== 'local' && !tabId.startsWith('held_')) {
      const { data: lockSuccess, error } = await supabase.rpc('lock_pending_cart', { p_cart_id: tabId });
      if (error || !lockSuccess) {
        showAlertRef.current("Another cashier is already processing this cart.", "Cart Locked");
        return;
      }
    }

    let itemsToRestore = overrideItems;
    if (!itemsToRestore) {
      if (tabId === 'local') {
        itemsToRestore = cartSessions['local'] || [];
      } else {
        const hc = heldCarts.find(c => c.id === tabId);
        itemsToRestore = cartSessions[tabId] || (hc ? hc.items : []);
      }
    }

    if (itemsToRestore.length > 0) {
      let priceChanged = false;
      let itemRemoved = false;
      const updatedItemsRaw = await Promise.all(itemsToRestore.map(async (item) => {
        if (item.is_screw || item.barcode === 'SCREWS') {
          return item;
        }
        const liveItem = await getInventoryItemByBarcode(item.barcode);
        if (!liveItem) {
          itemRemoved = true;
          return null;
        }
        
        let livePrice = Number(liveItem.price || 0);
        if (item.batch_id && liveItem.batches) {
          const liveBatch = liveItem.batches.find(b => b.batch_id === item.batch_id);
          if (!liveBatch) {
            itemRemoved = true;
            return null;
          }
          livePrice = Number(liveBatch.selling_price || 0);
        }
        
        const oldPrice = Number(item.price || 0);
        if (oldPrice !== livePrice) {
          priceChanged = true;
          return {
            ...item,
            price: livePrice,
            selling_price: livePrice,
            customPriceInput: Number(livePrice).toFixed(2),
          };
        }
        return item;
      }));
      
      const updatedItems = updatedItemsRaw.filter(Boolean);

      if (itemRemoved) {
        showAlertRef.current("Some items were removed from the inventory and have been removed from your cart.", "Notice");
      } else if (priceChanged) {
        showAlertRef.current("Some item prices changed while this cart was on hold. Prices have been updated.", "Price Update");
      }
      switchCartTab(tabId, updatedItems);
    } else {
      switchCartTab(tabId);
    }
  }, [cartSessions, heldCarts, switchCartTab]);

  const handleCancelHeldCart = useCallback((cartId) => {
    const targetId = cartId || activeCartTab;
    const targetCart = heldCarts.find(c => c.id === targetId);
    showConfirm(
      `Cancel "${targetCart?.name || 'this held cart'}"? All items will be discarded.`,
      () => {
        cancelHeldCart(targetId);
      },
      'Cancel Held Cart',
      'Cancel Cart',
      'Keep Cart',
      true
    );
  }, [activeCartTab, heldCarts, cancelHeldCart, showConfirm]);

  const handleDiscardPendingCart = useCallback((pcId) => {
    const currentShopId = shopSettings?.id || localStorage.getItem('shop_id');
    let delQuery = supabase.from('pending_carts').delete().eq('id', pcId);
    if (currentShopId) {
      delQuery = delQuery.eq('shop_id', currentShopId);
    }
    delQuery.then().catch(console.error);
    setCartSessions(prev => {
      const next = { ...prev };
      delete next[pcId];
      return next;
    });
    if (activeCartTab === pcId) {
      switchCartTab('local');
    }
    if (showToast) {
      showToast('Worker cart discarded');
    }
  }, [activeCartTab, shopSettings?.id, switchCartTab, showToast]);

  const handleCancelSale = () => {
    if (activeCartTab.startsWith('held_')) {
      cancelHeldCart(activeCartTab);
    } else if (activeCartTab !== 'local') {
      handleDiscardPendingCart(activeCartTab);
    } else {
      setCart([]);
    }
  };

  const handleSaveScrews = useCallback((priceNum) => {
    if (!priceNum || isNaN(priceNum) || priceNum <= 0) {
      showAlertRef.current("Please enter a valid price for the screws.", "Invalid Screws Price");
      return;
    }

    setCart(prev => {
      const existingIdx = prev.findIndex(i => i.is_screw);
      const screwItem = {
        id: existingIdx >= 0 ? prev[existingIdx].id : ('screw_' + Date.now()),
        barcode: 'SCREWS',
        name: 'Screws',
        price: priceNum,
        customPriceInput: priceNum.toFixed(2),
        selling_price: priceNum.toFixed(2),
        purchase_cost: '0.00',
        cost_price: 0,
        msp: priceNum,
        msp_price: priceNum.toFixed(2),
        quantity: 1,
        billableQuantity: 1,
        unit: 'SET',
        discountPct: 0,
        is_loose_item: false,
        is_cuttable: false,
        is_screw: true
      };

      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = screwItem;
        return next;
      }
      return [...prev, screwItem];
    });

    setScrewsModal({ isOpen: false, price: '' });
    playScanSuccessSound();
  }, [playScanSuccessSound, setCart]);

  const handleOpenCheckoutModal = useCallback(() => {
    // Safety check: Ensure no item is below MSP before opening checkout
    let hasClamped = false;
    let clampedNames = [];
    const clampedCart = cart.map(i => {
      if (i.is_screw || i.barcode === 'SCREWS') return i;
      const qty = i.billableQuantity !== undefined && i.billableQuantity !== '' ? Number(i.billableQuantity) : (i.quantity === '' ? 0 : Number(i.quantity));
      const currentPrice = i.customPriceInput !== undefined && i.customPriceInput !== '' ? Number(i.customPriceInput) : Number(i.price || 0);
      const msp = Number(i.msp_price) || Number(i.msp) || Number(i.cost_price) || 0;
      if (msp > 0 && currentPrice < msp) {
        hasClamped = true;
        clampedNames.push(i.name);
        return {
          ...i,
          customPriceInput: msp,
          customTotalInput: (msp * qty).toFixed(2),
          discountPct: Number(i.price) > 0 ? Math.max(0, ((Number(i.price) - msp) / Number(i.price)) * 100) : 0
        };
      }
      return i;
    });

    if (hasClamped) {
      setCart(clampedCart);
      showAlert(`Cannot sell below MSP. ${clampedNames.join(', ')} adjusted to minimum selling price (MSP).`, "Price Below MSP");
      return;
    }

    const initialTotal = calculateTotal();

    setCheckoutModal(prev => ({
      ...prev,
      isOpen: true,
      cashGiven: '',
      negotiatedTotal: initialTotal > 0 ? String(Number(initialTotal.toFixed(2))) : '',
      includeScrews: false,
      screwsPrice: '',
      error: '',
      paymentMethod: 'CASH',
      splitUpi: '',
      splitCash: ''
    }));
  }, [cart, showAlert, setCart, calculateTotal]);

  const handleCompleteTransaction = async () => {
    if (isCheckingOut) return;
    let finalCart = cart.filter(i => Number(i.quantity) > 0);
    if (finalCart.length === 0) return;

    if (activeTab === 'checkout') {
      const subMspItem = finalCart.find(i => {
        if (i.is_screw || i.barcode === 'SCREWS') return false;
        const price = i.customPriceInput !== undefined && i.customPriceInput !== '' ? Number(i.customPriceInput) : Number(i.price || 0);
        const msp = Number(i.msp_price) || Number(i.msp) || Number(i.cost_price) || 0;
        return msp > 0 && price < msp;
      });
      if (subMspItem) {
        const msp = Number(subMspItem.msp_price) || Number(subMspItem.msp) || Number(subMspItem.cost_price) || 0;
        const price = subMspItem.customPriceInput !== undefined && subMspItem.customPriceInput !== '' ? Number(subMspItem.customPriceInput) : Number(subMspItem.price || 0);
        const errMsg = `Cannot sell ${subMspItem.name} below MSP (Price: ₹${price.toFixed(2)}, MSP: ₹${msp.toFixed(2)}).`;
        setCheckoutModal(prev => ({ ...prev, error: errMsg }));
        showAlert(errMsg, "Price Below MSP");
        return;
      }

      if (checkoutModal.negotiatedTotal === '') {
        setCheckoutModal(prev => ({ ...prev, error: "Please enter the Final Negotiated Amount. If there is no discount, enter the exact System Total." }));
        return;
      }
      
      const activeTotal = Number(checkoutModal.negotiatedTotal);
      const activeTotalCents = Math.round(activeTotal * 100);

      if (checkoutModal.paymentMethod === 'CASH') {
        if (checkoutModal.cashGiven !== '') {
          const cashGivenCents = Math.round(Number(checkoutModal.cashGiven) * 100);
          if (cashGivenCents < activeTotalCents) {
            setCheckoutModal(prev => ({ ...prev, error: "Cash given is less than the total due." }));
            return;
          }
        }
      } else if (checkoutModal.paymentMethod === 'SPLIT') {
        if (checkoutModal.splitCash === '' || checkoutModal.splitUpi === '') {
          setCheckoutModal(prev => ({ ...prev, error: "Please enter both Cash and UPI amounts." }));
          return;
        }
        const splitTotalCents = Math.round(Number(checkoutModal.splitCash) * 100) + Math.round(Number(checkoutModal.splitUpi) * 100);
        if (splitTotalCents < activeTotalCents) {
          setCheckoutModal(prev => ({ ...prev, error: "Split payment amounts must equal or exceed the total due." }));
          return;
        }
      }
      // SHOWROOM: No payment validation needed — customer will pay at the showroom
    }

    // --- APPLY CART-LEVEL NEGOTIATED TOTAL DISCOUNT (Proportional) ---
    if (activeTab === 'checkout' && checkoutModal.negotiatedTotal !== '') {
      const targetTotal = Number(checkoutModal.negotiatedTotal);
      const currentCartTotal = calculateTotal();
      let totalDiscountToGive = currentCartTotal - targetTotal;

      if (totalDiscountToGive > 0) {
        const screwItem = finalCart.find(i => i.is_screw || i.barcode === 'SCREWS');
        const screwPrice = screwItem ? Number(screwItem.customPriceInput || screwItem.price || 0) : 0;
        const otherItems = finalCart.filter(item => !item.is_screw && item.barcode !== 'SCREWS');

        if (otherItems.length === 0) {
          const errMsg = `Screws price (₹${screwPrice.toFixed(2)}) is fixed and cannot be discounted. Discount is only applicable to other items.`;
          setCheckoutModal(prev => ({ ...prev, error: errMsg }));
          showAlert(errMsg, "Screws Price Fixed");
          setIsCheckingOut(false);
          return;
        }

        if (targetTotal < screwPrice) {
          const errMsg = `Negotiated amount cannot be less than ₹${screwPrice.toFixed(2)} (Screws price is fixed at ₹${screwPrice.toFixed(2)}).`;
          setCheckoutModal(prev => ({ ...prev, error: errMsg }));
          showAlert(errMsg, "Invalid Total");
          setIsCheckingOut(false);
          return;
        }

        // Prepare items with their discountable room — EXCLUDE SCREWS (screw amount stays constant)
        let discountableItems = otherItems
          .map(item => {
            const qty = item.billableQuantity !== undefined && item.billableQuantity !== '' ? Number(item.billableQuantity) : (item.quantity === '' ? 0 : Number(item.quantity));
            const price = item.customPriceInput !== undefined && item.customPriceInput !== '' ? Number(item.customPriceInput) : Number(item.price || 0);
            const msp = Number(item.msp_price) || Number(item.msp) || Number(item.cost_price) || 0;
            const currentLineTotal = qty * price;
            const minLineTotal = qty * msp;
            return {
              ref: item,
              calcQty: qty,
              currentPrice: price,
              minPrice: msp,
              maxDiscountableTotal: Math.max(0, currentLineTotal - minLineTotal),
              allocatedDiscount: 0
            };
          }).filter(i => i.maxDiscountableTotal > 0);

        const maxTotalDiscountable = discountableItems.reduce((sum, i) => sum + i.maxDiscountableTotal, 0);

        const otherItemsMspTotal = otherItems.reduce((sum, item) => {
          const qty = item.billableQuantity !== undefined && item.billableQuantity !== '' ? Number(item.billableQuantity) : (item.quantity === '' ? 0 : Number(item.quantity));
          const msp = Number(item.msp_price) || Number(item.msp) || Number(item.cost_price) || 0;
          return sum + (qty * msp);
        }, 0);
        const minAllowedTotal = Math.round((otherItemsMspTotal + screwPrice) * 100) / 100;

        if (targetTotal < minAllowedTotal || totalDiscountToGive > maxTotalDiscountable) {
          const errMsg = `Cannot sell for ₹${targetTotal.toFixed(2)}. Absolute minimum allowed total is ₹${minAllowedTotal.toFixed(2)}${screwPrice > 0 ? ` (including ₹${screwPrice.toFixed(2)} for screws)` : ''}. Products cannot be sold below MSP.`;
          setCheckoutModal(prev => ({ ...prev, error: errMsg }));
          showAlert(errMsg, "Minimum Price Error");
          setIsCheckingOut(false);
          return;
        }

      }
    }

    if (activeTab === 'transfer') {
      const missingInstance = finalCart.filter(i => i.unit === 'SQFT' && !i.instance_barcode);
      if (missingInstance.length > 0) {
        showAlert(`For cuttable items, you MUST scan the unique roll barcode to transfer it. You cannot transfer the generic item.`, "Unique Barcode Required");
        return;
      }
    }

    if (activeTab === 'receive') {
      const missingDefaults = finalCart.filter(i => i.unit === 'SQFT' && (!i.default_length || !i.default_width));
      if (missingDefaults.length > 0) {
        showAlert(`Please set Default Roll Dimensions in the Catalog for: ${missingDefaults.map(i => i.name).join(', ')}`, "Missing Dimensions");
        return;
      }
    }

    if (activeTab === 'checkout') {
      const missingInstance = finalCart.filter(i => i.unit === 'SQFT' && !i.instance_barcode);
      if (missingInstance.length > 0) {
        showAlert(`For cuttable items, you MUST scan the unique roll barcode to sell it.`, "Unique Barcode Required");
        return;
      }
      const missingDimensions = finalCart.filter(i => i.unit === 'SQFT' && (!i.length || !i.width));
      if (missingDimensions.length > 0) {
        showAlert(`Please specify Length and Height for all Cuttable Stock items.`, "Missing Dimensions");
        return;
      }
    }

    setIsCheckingOut(true);
    try {
      if ((activeTab === 'checkout' || activeTab === 'transfer') && navigator.onLine) {
        // Untracked screws have no inventory batch or stock records; exclude from stock check
        const stockItems = finalCart.filter(item => !item.is_screw && item.barcode !== 'SCREWS');
        const barcodes = [...new Set(stockItems.map(item => item.barcode))];
        const stockField = activeTab === 'transfer' ? 'stock_warehouse' : 'stock_store';
        const currentShopId = shopSettings?.id || localStorage.getItem('shop_id');
        
        if (barcodes.length > 0) {
          let batchQuery = supabase
            .from('inventory_batches')
            .select('barcode, batch_id, stock_store, stock_warehouse, selling_price, msp')
            .in('barcode', barcodes)
            .eq('is_active', true);
          if (currentShopId) {
            batchQuery = batchQuery.eq('shop_id', currentShopId);
          }
          const { data: liveBatches, error: stockError } = await batchQuery;

          if (stockError) {
            if (stockError.message !== 'Failed to fetch' && stockError.code !== '503') {
              throw stockError;
            }
          } else if (liveBatches) {
            // Sum stock per barcode across all active batches
            const stockByBarcode = {};
            liveBatches.forEach(b => {
              stockByBarcode[b.barcode] = (stockByBarcode[b.barcode] || 0) + Number(b[stockField] || 0);
            });

            for (const cartItem of stockItems) {
              const available = stockByBarcode[cartItem.barcode] ?? 0;
              if (available < cartItem.quantity) {
                const loc = activeTab === 'transfer' ? 'warehouse' : 'shop';
                throw new Error(`Not enough stock for ${cartItem.name}! Only ${available} available in the ${loc}.`);
              }
            }

            // P0 FIX: Live price verification (checkout only)
            if (activeTab === 'checkout') {
              const priceByBatch = {};
              liveBatches.forEach(b => {
                priceByBatch[`${b.barcode}_${b.batch_id}`] = {
                  selling_price: Number(b.selling_price || 0),
                  msp: Number(b.msp || 0)
                };
              });

              let priceChanged = false;
              const priceUpdatedCart = finalCart.map(cartItem => {
                if (cartItem.is_screw || cartItem.barcode === 'SCREWS') return cartItem;
                const key = `${cartItem.barcode}_${cartItem.batch_id}`;
                const live = priceByBatch[key];
                if (live && Math.abs(live.selling_price - Number(cartItem.selling_price || 0)) > 0.01) {
                  priceChanged = true;
                  const wasCustomized = cartItem.customPriceInput != cartItem.selling_price;
                  return {
                    ...cartItem,
                    selling_price: live.selling_price.toFixed(2),
                    price: live.selling_price,
                    msp: live.msp,
                    msp_price: live.msp.toFixed(2),
                    customPriceInput: wasCustomized ? cartItem.customPriceInput : live.selling_price.toFixed(2)
                  };
                }
                return cartItem;
              });

              if (priceChanged) {
                setCart(priceUpdatedCart);
                setIsCheckingOut(false);
                throw new Error('Prices have been updated since items were scanned. The cart has been refreshed with current prices. Please review and try again.');
              }
            }
          }
        }
      }
      
      // Secondary pass to apply the calculated discounts cleanly
      if (activeTab === 'checkout' && checkoutModal.negotiatedTotal !== '') {
        const targetTotal = Number(checkoutModal.negotiatedTotal);
        const currentCartTotal = calculateTotal();
        let totalDiscountToGive = currentCartTotal - targetTotal;

        if (totalDiscountToGive > 0) {
          const screwItem = finalCart.find(i => i.is_screw || i.barcode === 'SCREWS');
          const fixedScrewPrice = screwItem ? Number(screwItem.customPriceInput || screwItem.price || 0) : 0;

          let originalDiscountableItems = finalCart.map((item, index) => {
            if (item.is_screw || item.barcode === 'SCREWS') {
              return {
                __cartIndex: index,
                calcQty: 1,
                currentPrice: fixedScrewPrice,
                maxDiscountableTotal: 0,
                allocatedDiscount: 0
              };
            }
            const qty = item.billableQuantity !== undefined && item.billableQuantity !== '' ? Number(item.billableQuantity) : (item.quantity === '' ? 0 : Number(item.quantity));
            const price = item.customPriceInput !== undefined && item.customPriceInput !== '' ? Number(item.customPriceInput) : Number(item.price || 0);
            const msp = Number(item.msp_price) || Number(item.msp) || Number(item.cost_price) || 0;
            return {
              __cartIndex: index,
              calcQty: qty,
              currentPrice: price,
              maxDiscountableTotal: Math.max(0, (qty * price) - (qty * msp)),
              allocatedDiscount: 0
            };
          }).filter(i => i.maxDiscountableTotal > 0);
          
          let activeDiscountableItems = [...originalDiscountableItems];
          let loopSafety = 0;
          while (totalDiscountToGive > 0.005 && activeDiscountableItems.length > 0 && loopSafety < 10) {
            loopSafety++;
            const currentTotalDiscountable = activeDiscountableItems.reduce((sum, i) => sum + (i.maxDiscountableTotal - i.allocatedDiscount), 0);
            let iterationDiscountToGive = totalDiscountToGive;
            for (let i = 0; i < activeDiscountableItems.length; i++) {
              const item = activeDiscountableItems[i];
              const itemRemDiscountable = item.maxDiscountableTotal - item.allocatedDiscount;
              if (itemRemDiscountable <= 0) continue;
              const discountForThisItem = Math.min(itemRemDiscountable, iterationDiscountToGive * (itemRemDiscountable / currentTotalDiscountable));
              item.allocatedDiscount += discountForThisItem;
              totalDiscountToGive -= discountForThisItem;
            }
            activeDiscountableItems = activeDiscountableItems.filter(i => (i.maxDiscountableTotal - i.allocatedDiscount) > 0.005);
          }

          finalCart = finalCart.map((cartItem, index) => {
            if (cartItem.is_screw || cartItem.barcode === 'SCREWS') {
              // Screw price stays completely untouched — exactly as specified!
              return {
                ...cartItem,
                price: fixedScrewPrice,
                customPriceInput: fixedScrewPrice.toFixed(2),
                selling_price: fixedScrewPrice.toFixed(2),
                discountPct: 0
              };
            }
            const discItem = originalDiscountableItems.find(i => i.__cartIndex === index);
            if (discItem && discItem.allocatedDiscount > 0) {
              const newPriceRaw = discItem.currentPrice - (discItem.allocatedDiscount / discItem.calcQty);
              const newPrice = Math.round((newPriceRaw + Number.EPSILON) * 100) / 100;
              return {
                ...cartItem,
                customPriceInput: newPrice,
                discountPct: Number(cartItem.price) > 0 ? ((Number(cartItem.price) - newPrice) / Number(cartItem.price)) * 100 : 0
              };
            }
            return cartItem;
          });
        }
      }

      // Compute payment amounts for the payload
      const paymentMethod = activeTab === 'checkout' ? (checkoutModal.paymentMethod || 'CASH') : null;
      let cashAmount = 0;
      let upiAmount = 0;
      let totalForPayment = 0;
      if (activeTab === 'checkout') {
        totalForPayment = checkoutModal.negotiatedTotal !== '' ? Number(checkoutModal.negotiatedTotal) : calculateTotal();
        if (paymentMethod === 'CASH') {
          cashAmount = totalForPayment;
        } else if (paymentMethod === 'UPI') {
          upiAmount = totalForPayment;
        } else if (paymentMethod === 'SPLIT') {
          cashAmount = Math.round(Number(checkoutModal.splitCash || 0) * 100) / 100;
          upiAmount = Math.round(Number(checkoutModal.splitUpi || 0) * 100) / 100;
        }
      }

      const payload = {
        shop_id: shopSettings?.id || localStorage.getItem('shop_id'),
        p_action: activeTab === 'receive' ? 'RECEIVE' : activeTab === 'transfer' ? 'TRANSFER' : 'SALE',
        p_location: activeTab === 'receive' ? 'Warehouse-Inbound' : activeTab === 'transfer' ? 'Warehouse-Transfer' : 'Store',
        p_cashier_name: cashierName || 'System',
        p_payment_method: paymentMethod,
        p_cash_amount: cashAmount,
        p_upi_amount: upiAmount,
        p_customer_name: checkoutModal.customerName || null,
        p_customer_phone: checkoutModal.customerPhone || null,
        screw_item: finalCart.find(i => i.is_screw || i.barcode === 'SCREWS') || null,
        p_items: finalCart.filter(i => !i.is_screw && i.barcode !== 'SCREWS').map(i => {
          let calcQuantity = Number(i.quantity);
          if (i.is_cuttable) {
            if (i.unit === 'SQFT') {
              if (activeTab === 'receive') {
                calcQuantity = Number(i.quantity) * Number(i.default_length) * Number(i.default_width);
              } else if (activeTab === 'transfer') {
                let pl = Number(i.pieceLength);
                if (isNaN(pl)) pl = Number(i.default_length);
                calcQuantity = pl * Number(i.default_width);
              }
            } else {
              // For METER/FT etc, receive/transfer quantity is just the length
              if (activeTab === 'receive') {
                calcQuantity = Number(i.quantity) * Number(i.default_length);
              } else if (activeTab === 'transfer') {
                let pl = Number(i.pieceLength);
                if (isNaN(pl)) pl = Number(i.default_length);
                calcQuantity = pl;
              }
            }
          }
          const finalPrice = i.customPriceInput !== undefined && i.customPriceInput !== '' ? Number(i.customPriceInput) : Number(i.price || 0);
          return {
            barcode: i.barcode,
            name: i.name,
            batch_id: i.batch_id || null,
            actual_quantity: calcQuantity,
            billable_quantity: i.billableQuantity !== undefined && i.billableQuantity !== '' ? Number(i.billableQuantity) : calcQuantity,
            system_price: i.selling_price !== undefined ? Number(i.selling_price) : Number(i.price || 0),
            final_price: finalPrice,
            negotiated_discount: i.discountPct || 0,
            unit: i.unit,
            instance_barcode: i.instance_barcode || null,
            cut_length: i.is_cuttable ? ((Number(i.length) || Number(i.pieceLength) || 0) * (Number(i.rolls) || 1)) : null,
            discard_scrap: i.discard_scrap || false,
            num_rolls: (activeTab === 'receive' && i.is_cuttable) ? Number(i.quantity) : null,
            default_length: i.default_length ? Number(i.default_length) : null,
            default_width: i.default_width ? Number(i.default_width) : null,
            purchase_cost: i.purchase_cost !== undefined ? Number(i.purchase_cost) : (i.cost_price ? Number(i.cost_price) : 0),
            selling_price: i.selling_price !== undefined ? Number(i.selling_price) : (i.price ? Number(i.price) : 0),
            msp: i.msp_price !== undefined ? Number(i.msp_price) : (i.msp ? Number(i.msp) : 0)
          };
        }),
      };

      let successData = null;
      if (navigator.onLine) {
        try {
          const { data, error } = await supabase.rpc('process_pos_transaction_unsafe', {
            p_action: payload.p_action,
            p_location: payload.p_location,
            p_cashier_name: payload.p_cashier_name,
            p_items: payload.p_items
          });
          if (error) throw error;
          successData = data;
          if (successData?.bill_id) {
            try {
              const shopId = localStorage.getItem('shop_id');
              const updatePayload = {
                payment_method: payload.p_payment_method,
                cash_amount: payload.p_cash_amount,
                upi_amount: payload.p_upi_amount,
                total_amount: totalForPayment
              };
              if (shopId) {
                updatePayload.shop_id = shopId;
              }
              if (payload.p_customer_name || payload.p_customer_phone) {
                updatePayload.customer_name = payload.p_customer_name;
                updatePayload.customer_phone = payload.p_customer_phone;
              }
              // Mark showroom sales as pending — excluded from revenue until paid
              if (payload.p_payment_method === 'SHOWROOM') {
                updatePayload.status = 'showroom_pending';
              }
              await supabase.from('bills').update(updatePayload).eq('id', successData.bill_id);

              const screwItem = finalCart.find(i => i.is_screw || i.barcode === 'SCREWS');
              if (activeTab === 'checkout' && screwItem) {
                const scPrice = Number(screwItem.customPriceInput || screwItem.price || 0);
                try {
                  await supabase.from('bill_items').insert({
                    bill_id: successData.bill_id,
                    shop_id: shopId,
                    barcode: 'SCREWS',
                    name: 'Screws',
                    item_name: 'Screws',
                    quantity: 1,
                    billable_quantity: 1,
                    price_at_sale: scPrice,
                    selling_price: scPrice,
                    final_price: scPrice,
                    profit: scPrice,
                    unit: 'SET'
                  });
                } catch (biErr) {
                  console.warn("Could not insert screws into bill_items:", biErr);
                }
              }
            } catch (e) {
              console.warn("Could not save additional bill data.", e);
            }
          }
        } catch (error) {
          if (error.message === 'Failed to fetch' || error.code === '503') {
            await queueOfflineTransaction(payload);
            successData = { bill_id: 'OFFL-' + generateId().substring(0, 5).toUpperCase() };
            setTimeout(() => showAlertRef.current("Transaction queued offline. It will sync automatically when internet returns.", "Offline Mode"), 100);
          } else {
            let msg = error.message;
            if (msg.includes('chk_current_length_nonnegative')) {
              msg = `One or more cut pieces in your cart do not have enough remaining length in the warehouse. Another checkout may have already cut them.`;
            } else if (msg.includes('chk_stock_store_nonnegative')) {
              msg = `Store stock limit exceeded. Another checkout may have already sold this item.`;
            } else if (msg.includes('chk_stock_warehouse_nonnegative')) {
              msg = `Warehouse stock limit exceeded. Another transaction may have already moved this item.`;
            }
            throw new Error(msg);
          }
        }
      } else {
        await queueOfflineTransaction(payload);
        successData = { bill_id: 'OFFL-' + generateId().substring(0, 5).toUpperCase() };
        setTimeout(() => showAlertRef.current("Transaction queued offline. It will sync automatically when internet returns.", "Offline Mode"), 100);
      }

      // Manually update local IDB for instant feedback
      for (const item of finalCart) {
        const localItem = await getInventoryItemByBarcode(item.barcode);
        if (localItem) {
          if (activeTab === 'receive') {
            if (isWarehouseDisabled) {
              localItem.stock_store = (Number(localItem.stock_store) || 0) + Number(item.quantity);
            } else {
              localItem.stock_warehouse = (Number(localItem.stock_warehouse) || 0) + Number(item.quantity);
            }
          } else if (activeTab === 'transfer') {
            localItem.stock_warehouse = Math.max(0, (Number(localItem.stock_warehouse) || 0) - Number(item.quantity));
            localItem.stock_store = (Number(localItem.stock_store) || 0) + Number(item.quantity);
          } else if (activeTab === 'checkout') {
            localItem.stock_store = Math.max(0, (Number(localItem.stock_store) || 0) - Number(item.quantity));
          }

          // Also update specific batch inside localItem.batches for instant tab feedback
          if (localItem.batches && Array.isArray(localItem.batches)) {
            const bIdx = localItem.batches.findIndex(b => (item.batch_id && b.batch_id === item.batch_id) || (item.batch_number !== undefined && b.batch_number === item.batch_number));
            if (bIdx !== -1) {
              if (activeTab === 'receive') {
                if (isWarehouseDisabled) {
                  localItem.batches[bIdx].stock_store = (Number(localItem.batches[bIdx].stock_store) || 0) + Number(item.quantity);
                } else {
                  localItem.batches[bIdx].stock_warehouse = (Number(localItem.batches[bIdx].stock_warehouse) || 0) + Number(item.quantity);
                }
              } else if (activeTab === 'transfer') {
                localItem.batches[bIdx].stock_warehouse = Math.max(0, (Number(localItem.batches[bIdx].stock_warehouse) || 0) - Number(item.quantity));
                localItem.batches[bIdx].stock_store = (Number(localItem.batches[bIdx].stock_store) || 0) + Number(item.quantity);
              } else if (activeTab === 'checkout') {
                localItem.batches[bIdx].stock_store = Math.max(0, (Number(localItem.batches[bIdx].stock_store) || 0) - Number(item.quantity));
              }
            }
          }

          await saveInventoryBatch([localItem]);
        }
      }

      // Safeguard: When warehouse is disabled, ensure server batch and cuttable instances are routed to Store
      if (activeTab === 'receive' && isWarehouseDisabled && navigator.onLine) {
        try {
          const shopId = shopSettings?.id || localStorage.getItem('shop_id');
          for (const item of finalCart) {
            let bQuery = supabase
              .from('inventory_batches')
              .select('batch_id, stock_warehouse, stock_store')
              .eq('barcode', item.barcode);

            if (item.batch_id) {
              bQuery = bQuery.eq('batch_id', item.batch_id);
            } else if (item.batch_number !== undefined && item.batch_number !== null) {
              bQuery = bQuery.eq('batch_number', item.batch_number);
            } else {
              bQuery = bQuery.order('created_at', { ascending: false }).limit(1);
            }

            if (shopId) {
              bQuery = bQuery.eq('shop_id', shopId);
            }
            const { data: bData } = await bQuery.maybeSingle();

            if (bData && Number(bData.stock_warehouse) > 0) {
              const transferQty = Math.min(Number(bData.stock_warehouse), Number(item.quantity));
              let updateBatch = supabase
                .from('inventory_batches')
                .update({
                  stock_warehouse: Math.max(0, Number(bData.stock_warehouse) - transferQty),
                  stock_store: Number(bData.stock_store || 0) + transferQty
                })
                .eq('batch_id', bData.batch_id);
              if (shopId) {
                updateBatch = updateBatch.eq('shop_id', shopId);
              }
              await updateBatch;

              // Also update product_master to keep parent warehouse and store stock in sync
              let pQuery = supabase
                .from('product_master')
                .select('stock_warehouse, stock_store')
                .eq('barcode', item.barcode);
              if (shopId) pQuery = pQuery.eq('shop_id', shopId);
              const { data: pData } = await pQuery.maybeSingle();

              if (pData) {
                let updateProd = supabase
                  .from('product_master')
                  .update({
                    stock_warehouse: Math.max(0, Number(pData.stock_warehouse || 0) - transferQty),
                    stock_store: Number(pData.stock_store || 0) + transferQty
                  })
                  .eq('barcode', item.barcode);
                if (shopId) updateProd = updateProd.eq('shop_id', shopId);
                await updateProd;
              }

              if (item.is_cuttable) {
                let updateInst = supabase
                  .from('stock_instances')
                  .update({ location: 'Store' })
                  .eq('parent_barcode', item.barcode)
                  .eq('location', 'Warehouse');
                if (shopId) {
                  updateInst = updateInst.eq('shop_id', shopId);
                }
                await updateInst;
              }
            }
          }
        } catch (e) {
          console.warn("Auto-route warehouse to store fallback:", e);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory_item'] });
      queryClient.invalidateQueries({ queryKey: ['product_master'] });
      // Also invalidate piece_counts for cuttable items so WHSE/STORE QTY refreshes
      queryClient.invalidateQueries({ queryKey: ['piece_counts'] });
      queryClient.invalidateQueries({ queryKey: ['stock_instances'] });
      queryClient.invalidateQueries({ queryKey: ['bills'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['sales-trend'] });
      queryClient.invalidateQueries({ queryKey: ['unifiedAuditLogs'] });
      queryClient.invalidateQueries({ queryKey: ['owner-reports'] });
      queryClient.invalidateQueries({ queryKey: ['showroom-sales'] });

      if (navigator.onLine) {
        // Trigger background sync to ensure true consistency with server
        syncInventoryToLocal(userRole).then(() => {
          queryClient.invalidateQueries({ queryKey: ['inventory'] });
          queryClient.invalidateQueries({ queryKey: ['piece_counts'] });
          queryClient.invalidateQueries({ queryKey: ['stock_instances'] });
        });
      }

      // Broadcast real-time stock decrements/updates to peer counter terminals
      broadcastStockUpdate({
        type: activeTab,
        items: finalCart,
        shopId: shopSettings?.id || (typeof localStorage !== 'undefined' ? localStorage.getItem('shop_id') : null)
      });

      const rawFinalItemsList = finalCart.map(i => {
        const itemMrp = Number(i.selling_price !== undefined ? i.selling_price : (i.price || 0));
        const finalRate = i.customPriceInput !== undefined && i.customPriceInput !== '' ? Number(i.customPriceInput) : itemMrp;
        const bQty = i.billableQuantity !== undefined && i.billableQuantity !== '' ? Number(i.billableQuantity) : Number(i.quantity);
        return { 
          ...i, 
          quantity: bQty, 
          actual_quantity: Number(i.quantity), 
          finalRate, 
          mrp: itemMrp, 
          lineTotal: finalRate * bQty, 
          pieceCount: 1,
          grams: i.grams !== undefined ? i.grams : ((i.is_loose_item && (i.unit?.toUpperCase() === 'KG' || i.unit?.toUpperCase() === 'KGS' || i.unit?.toUpperCase() === 'GRAMS' || i.unit?.toUpperCase() === 'GRAM' || i.unit?.toUpperCase() === 'G' || i.unit?.toUpperCase() === 'GM')) ? Math.round(Number(i.quantity) * 1000) : undefined)
        };
      });

      const groupedItemsMap = new Map();
      rawFinalItemsList.forEach(item => {
        const key = `${item.barcode}_${item.finalRate.toFixed(2)}_${item.quantity}_${item.unit}_${item.length || ''}_${item.width || ''}`;
        if (groupedItemsMap.has(key)) {
           const existing = groupedItemsMap.get(key);
           existing.quantity += item.quantity;
           existing.actual_quantity += item.actual_quantity;
           if (existing.grams !== undefined && item.grams !== undefined) existing.grams += item.grams;
           existing.lineTotal += item.lineTotal;
           existing.pieceCount += 1;
        } else {
           groupedItemsMap.set(key, { ...item });
        }
      });
      
      const finalItemsList = Array.from(groupedItemsMap.values()).map(item => {
         if (item.pieceCount > 1) {
            return { ...item, name: `${item.name} (${item.pieceCount} Pieces)` };
         }
         return item;
      });
      const finalTotalAmount = finalItemsList.reduce((sum, i) => sum + i.lineTotal, 0);

      setLastReceipt({
        id: successData.bill_id.split('-')[0],
        items: finalItemsList,
        total: finalTotalAmount,
        date: new Date(),
        type: activeTab,
        paymentMethod: paymentMethod,
        cashAmount: cashAmount,
        upiAmount: upiAmount,
        customerName: checkoutModal.customerName || null,
        customerPhone: checkoutModal.customerPhone || null,
      });

      if (activeCartTab.startsWith('held_')) {
        setHeldCarts(prev => prev.filter(c => c.id !== activeCartTab));
        setCartSessions(prev => {
          const next = { ...prev };
          delete next[activeCartTab];
          return next;
        });
        switchCartTab('local');
      } else if (activeCartTab !== 'local') {
        // Delete the remote cart
        const currentShopId = shopSettings?.id || localStorage.getItem('shop_id');
        let delQuery = supabase.from('pending_carts').delete().eq('id', activeCartTab);
        if (currentShopId) {
          delQuery = delQuery.eq('shop_id', currentShopId);
        }
        delQuery.then().catch(console.error);
        // Clear local session for this tab and switch to local
        setCartSessions(prev => {
          const next = { ...prev };
          delete next[activeCartTab];
          return next;
        });
        switchCartTab('local');
      } else {
        setCart([]);
        setCartSessions(prev => ({ ...prev, local: [] }));
      }
      
      // Explicitly clear persistent cart storage immediately to prevent stale restore
      try {
        const sId = shopSettings?.id || localStorage.getItem('shop_id');
        if (sId) {
          localStorage.removeItem(`pos_cart_${sId}_${activeTab}`);
        }
        localStorage.removeItem(`pos_cart_${activeTab}`);
      } catch (err) {
        console.warn("Could not clear localStorage cart:", err);
      }

      setScrewsModal({ isOpen: false, price: '' });
      setCheckoutModal(prev => ({ 
        ...prev, 
        isOpen: false, 
        cashGiven: '', 
        negotiatedTotal: '', 
        error: '' 
      }));

      if (activeTab === 'checkout') {
        playPaymentSuccessSound();
        setPrintPreviewOpen(true);
      } else {
        showAlert("Stock updated successfully.", "Success");
      }
    } catch (e) {
      showAlert(e.message, "Notice");
      if (navigator.onLine) {
        // Force a sync to fix local IDB drift if transaction failed due to stock mismatch
        syncInventoryToLocal(userRole).then(() => {
          queryClient.invalidateQueries({ queryKey: ['inventory'] });
          queryClient.invalidateQueries({ queryKey: ['piece_counts'] });
          queryClient.invalidateQueries({ queryKey: ['stock_instances'] });
        });
      }
    } finally {
      setIsCheckingOut(false);
    }
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT';

      // 1. HIGH-SPEED HARDWARE BARCODE SCANNER INTERCEPTOR
      // Hardware HID scanners act as high-speed keyboard wedges (10ms-35ms per keystroke).
      // This interceptor tracks burst timing and captures scans even when an input is focused,
      // preventing barcode numbers from polluting form inputs.
      const now = Date.now();
      const lastBurstTime = lastScanKeyTime.current || 0;
      const interval = now - lastBurstTime;
      lastScanKeyTime.current = now;

      if (e.key === 'Enter') {
        const burst = scanBurstBuffer.current.trim();
        const timestamps = scanBurstTimestamps.current;

        if (burst.length >= 2 && timestamps.length >= 2) {
          const totalDuration = timestamps[timestamps.length - 1] - timestamps[0];
          const avgInterval = totalDuration / (timestamps.length - 1);

          if (avgInterval < 65) {
            e.preventDefault();
            e.stopPropagation();

            // Clear buffer & burst state
            scanBurstBuffer.current = '';
            scanBurstTimestamps.current = [];
            barcodeBuffer.current = '';

            // Clean up any focused input that received the burst keystrokes
            if (isInput && e.target) {
              if (e.target.id === 'manual-barcode') {
                setManualBarcode('');
                setSuggestions([]);
                setShowSuggestions(false);
              }
              e.target.blur();
            }

            processScan(burst);
            return;
          }
        }
        scanBurstBuffer.current = '';
        scanBurstTimestamps.current = [];
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (interval > 75) {
          scanBurstBuffer.current = e.key;
          scanBurstTimestamps.current = [now];
        } else {
          scanBurstBuffer.current += e.key;
          scanBurstTimestamps.current.push(now);
        }
      }

      // If a hardware scanner burst is actively streaming (keystrokes <= 75ms apart),
      // stop propagation and return immediately to prevent scanner characters (e.g. '-')
      // from bleeding into shortcut handlers or corrupting the cart.
      const isBurstStreaming = (interval <= 75 && scanBurstTimestamps.current.length >= 2);
      if (isBurstStreaming) {
        e.stopPropagation();
        return;
      }

      // 2. If alertConfig or confirmConfig is open, let them handle Esc/Enter
      if (alertConfig.isOpen || confirmConfig.isOpen || printPreviewOpen) {
        return;
      }

      // 3. CHECKOUT MODAL KEYBOARD CONTROLS
      if (checkoutModal.isOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setCheckoutModal(prev => ({ ...prev, isOpen: false }));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          handleCompleteTransaction();
          return;
        }

        const activeTotal = checkoutModal.negotiatedTotal !== '' 
          ? Number(checkoutModal.negotiatedTotal) 
          : calculateTotal();

        if (!isInput) {
          if (e.key === '1' || e.key.toUpperCase() === 'C') {
            e.preventDefault();
            // If already in CASH mode, 'C' clears cash given
            if (checkoutModal.paymentMethod === 'CASH' && e.key.toUpperCase() === 'C') {
              setCheckoutModal(prev => ({ ...prev, cashGiven: '', error: '' }));
            } else {
              setCheckoutModal(prev => ({ ...prev, paymentMethod: 'CASH', error: '' }));
            }
            return;
          }
          if (e.key === '2' || e.key.toUpperCase() === 'U') {
            e.preventDefault();
            setCheckoutModal(prev => ({ ...prev, paymentMethod: 'UPI', error: '' }));
            return;
          }
          if (e.key === '3' || e.key.toUpperCase() === 'S') {
            e.preventDefault();
            setCheckoutModal(prev => ({ ...prev, paymentMethod: 'SPLIT', error: '' }));
            return;
          }
          if (e.key === '4' || e.key.toUpperCase() === 'H') {
            e.preventDefault();
            setCheckoutModal(prev => ({ ...prev, paymentMethod: 'SHOWROOM', error: '' }));
            return;
          }
        }
        return;
      }

      // If other modals are open, skip hotkeys
      if (looseItemModal.isOpen || selectPieceModal.isOpen || cutLengthModal.isOpen || receiveLengthModal.isOpen) {
        return;
      }

      // 3. FUNCTION KEYS (Work everywhere, even if an input is focused)
      if (e.key === 'F2') {
        e.preventDefault();
        const barcodeInput = document.getElementById('manual-barcode');
        if (barcodeInput) {
          barcodeInput.focus();
          barcodeInput.select();
        }
        return;
      }

      if (e.key === 'F4') {
        e.preventDefault();
        if (cart.length > 0) {
          if (activeTab === 'checkout') {
            handleOpenCheckoutModal();
          } else {
            handleCompleteTransaction();
          }
        }
        return;
      }

      if (e.key === 'F7') {
        e.preventDefault();
        if (cart.length > 0 && activeTab === 'checkout' && activeCartTab === 'local') {
          handleHoldCart();
        }
        return;
      }

      if (e.key === 'F8') {
        e.preventDefault();
        if (cart.length > 0) {
          showConfirm(
            "Clear all items?",
            handleCancelSale,
            activeTab === 'checkout' ? 'Cancel Sale' : 'Clear Items',
            'Clear',
            'Cancel',
            true
          );
        }
        return;
      }

      // Alt + Number tab switches
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === '1') {
          e.preventDefault();
          navigate('/terminal/checkout');
          return;
        }
        if (e.key === '2') {
          e.preventDefault();
          navigate('/terminal/receive');
          return;
        }
        if (e.key === '3' && !isWarehouseDisabled) {
          e.preventDefault();
          navigate('/terminal/transfer');
          return;
        }
      }

      // 4. HARDWARE BARCODE SCANNER LOGIC (Must capture scanner burst even when not in an input)
      const currentTime = Date.now();
      if (currentTime - lastKeyTime.current > SCAN_TIMEOUT_MS) {
        barcodeBuffer.current = '';
      }
      lastKeyTime.current = currentTime;

      if (!isInput) {
        if (e.key === 'Enter') {
          if (barcodeBuffer.current.length > 0) {
            e.preventDefault();
            processScan(barcodeBuffer.current);
            barcodeBuffer.current = '';
            scanBurstBuffer.current = '';
            scanBurstTimestamps.current = [];
            return;
          }
        }
      }

      // 5. TERMINAL & CART NAVIGATION KEYS (Only when NOT typing inside an input)
      if (isInput) return;

      // Focus barcode search on / (only when buffer is empty)
      if (e.key === '/' && barcodeBuffer.current.length === 0) {
        e.preventDefault();
        barcodeBuffer.current = '';
        const barcodeInput = document.getElementById('manual-barcode');
        if (barcodeInput) {
          barcodeInput.focus();
          barcodeInput.select();
        }
        return;
      }

      // Space to open Pay modal when cart has items (only when buffer is empty)
      if (e.key === ' ' && cart.length > 0 && activeTab === 'checkout' && barcodeBuffer.current.length === 0) {
        e.preventDefault();
        barcodeBuffer.current = '';
        handleOpenCheckoutModal();
        return;
      }

      // Arrow Down: Navigate cart items down
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (cart.length > 0) {
          setSelectedCartIndex(prev => {
            if (prev === null || prev >= cart.length - 1) return 0;
            return prev + 1;
          });
        }
        return;
      }

      // Arrow Up: Navigate cart items up
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (cart.length > 0) {
          setSelectedCartIndex(prev => {
            if (prev === null || prev <= 0) return cart.length - 1;
            return prev - 1;
          });
        }
        return;
      }

      // Adjust Quantity on selected item (+ / =) (only when not buffering a barcode)
      if ((e.key === '+' || e.key === '=') && barcodeBuffer.current.length === 0 && selectedCartIndex !== null && cart[selectedCartIndex]) {
        e.preventDefault();
        barcodeBuffer.current = '';
        const item = cart[selectedCartIndex];
        const isLooseKg = Boolean(
          item.is_loose_item && (
            item.unit?.toUpperCase() === 'KG' ||
            item.unit?.toUpperCase() === 'KGS' ||
            item.unit?.toUpperCase() === 'GRAMS' ||
            item.unit?.toUpperCase() === 'GRAM' ||
            item.unit?.toUpperCase() === 'G' ||
            item.unit?.toUpperCase() === 'GM'
          )
        );
        if (activeTab === 'checkout' && isLooseKg) {
          const currentGrams = item.grams !== undefined && item.grams !== '' ? Number(item.grams) : (item.quantity !== '' ? Math.round(Number(item.quantity) * 1000) : 0);
          const nextGrams = currentGrams + 50;
          updateQuantity(item.id, nextGrams / 1000, nextGrams);
        } else {
          const curQty = Number(item.quantity) || 0;
          updateQuantity(item.id, curQty + 1);
        }
        return;
      }

      // Adjust Quantity on selected item (-) (only when not buffering a barcode)
      if (e.key === '-' && barcodeBuffer.current.length === 0 && selectedCartIndex !== null && cart[selectedCartIndex]) {
        e.preventDefault();
        barcodeBuffer.current = '';
        const item = cart[selectedCartIndex];
        const isLooseKg = Boolean(
          item.is_loose_item && (
            item.unit?.toUpperCase() === 'KG' ||
            item.unit?.toUpperCase() === 'KGS' ||
            item.unit?.toUpperCase() === 'GRAMS' ||
            item.unit?.toUpperCase() === 'GRAM' ||
            item.unit?.toUpperCase() === 'G' ||
            item.unit?.toUpperCase() === 'GM'
          )
        );
        if (activeTab === 'checkout' && isLooseKg) {
          const currentGrams = item.grams !== undefined && item.grams !== '' ? Number(item.grams) : (item.quantity !== '' ? Math.round(Number(item.quantity) * 1000) : 0);
          const nextGrams = Math.max(0, currentGrams - 50);
          if (nextGrams <= 0) {
            handleRemoveItem(item.id);
          } else {
            updateQuantity(item.id, nextGrams / 1000, nextGrams);
          }
        } else {
          const curQty = Number(item.quantity) || 0;
          if (curQty <= 1) {
            handleRemoveItem(item.id);
          } else {
            updateQuantity(item.id, curQty - 1);
          }
        }
        return;
      }

      // Delete / Backspace: Remove selected item from cart (only when barcode buffer is empty)
      if ((e.key === 'Delete' || e.key === 'Backspace') && barcodeBuffer.current.length === 0 && selectedCartIndex !== null && cart[selectedCartIndex]) {
        e.preventDefault();
        const item = cart[selectedCartIndex];
        handleRemoveItem(item.id);
        return;
      }

      // If Backspace while barcode buffer is active, delete last buffered char
      if (e.key === 'Backspace' && barcodeBuffer.current.length > 0) {
        e.preventDefault();
        barcodeBuffer.current = barcodeBuffer.current.slice(0, -1);
        return;
      }

      // General barcode buffer accumulation for all printable single-char keys
      if (!isInput && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        barcodeBuffer.current += e.key;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    alertConfig.isOpen,
    confirmConfig.isOpen,
    checkoutModal.isOpen,
    checkoutModal.paymentMethod,
    checkoutModal.negotiatedTotal,
    calculateTotal,
    printPreviewOpen,
    looseItemModal.isOpen,
    selectPieceModal.isOpen,
    cutLengthModal.isOpen,
    receiveLengthModal.isOpen,
    cart,
    selectedCartIndex,
    activeTab,
    activeCartTab,
    isWarehouseDisabled,
    navigate,
    processScan,
    handleCompleteTransaction,
    handleHoldCart,
    handleCancelSale,
    updateQuantity,
    handleRemoveItem,
    showConfirm
  ]);

  const cartTotal = calculateTotal();
  const cartUnits = calculateTotalUnits();
  
  const screwInCart = cart.find(i => i.is_screw || i.barcode === 'SCREWS');
  const screwPriceInCart = screwInCart ? Number(screwInCart.customPriceInput || screwInCart.price || 0) : 0;

  const minPossibleTotal = cart.reduce((tot, i) => {
    const qty = i.billableQuantity !== undefined && i.billableQuantity !== '' ? Number(i.billableQuantity) : (i.quantity === '' ? 0 : Number(i.quantity));
    const msp = (i.is_screw || i.barcode === 'SCREWS') ? Number(i.customPriceInput || i.price || 0) : (Number(i.msp_price) || Number(i.msp) || Number(i.cost_price) || 0);
    return tot + Math.round(msp * qty * 100);
  }, 0) / 100;

  const activeTotal = checkoutModal.negotiatedTotal !== '' ? Number(checkoutModal.negotiatedTotal) : cartTotal;
  const activeTotalCents = Math.round(activeTotal * 100);
  
  const cashGivenCents = checkoutModal.paymentMethod === 'CASH' ? Math.round(Number(checkoutModal.cashGiven || 0) * 100) : 0;
  const splitTotalCents = Math.round(Number(checkoutModal.splitUpi || 0) * 100) + Math.round(Number(checkoutModal.splitCash || 0) * 100);
  const isShortfall = checkoutModal.paymentMethod === 'SPLIT' 
    ? splitTotalCents !== activeTotalCents
    : (checkoutModal.paymentMethod === 'CASH' && checkoutModal.cashGiven !== '' && cashGivenCents > 0 && cashGivenCents < activeTotalCents);

  const isMobileScannerTab = window.innerWidth < 768 && (activeTab === 'receive' || activeTab === 'transfer');

  return (
    <>
      {/* Decomposed Terminal Modals */}
      <CheckoutModal
        isOpen={checkoutModal.isOpen}
        onClose={() => setCheckoutModal(prev => ({ ...prev, isOpen: false }))}
        checkoutModal={checkoutModal}
        setCheckoutModal={setCheckoutModal}
        activeTotal={activeTotal}
        cartTotal={cartTotal}
        minPossibleTotal={minPossibleTotal}
        screwPrice={screwPriceInCart}
        userRole={userRole}
        cashierName={cashierName}
        isCheckingOut={isCheckingOut}
        onCompleteTransaction={handleCompleteTransaction}
        getQuickTenderOptions={getQuickTenderOptions}
      />

      <SelectBatchModal
        isOpen={selectBatchModal.isOpen}
        item={selectBatchModal.item}
        batches={selectBatchModal.batches}
        activeTab={activeTab}
        isWarehouseDisabled={isWarehouseDisabled}
        userRole={userRole}
        calculateMSP={calculateMSP}
        onSelectBatch={handleSelectBatchSubmit}
        onClose={() => setSelectBatchModal({ isOpen: false, item: null, batches: [] })}
      />

      <LooseItemModal
        isOpen={looseItemModal.isOpen}
        looseItemModal={looseItemModal}
        setLooseItemModal={setLooseItemModal}
        activeTab={activeTab}
        isWarehouseDisabled={isWarehouseDisabled}
        onSubmit={handleLooseItemSubmit}
        onClose={() => setLooseItemModal({ isOpen: false, item: null, qty: '' })}
      />

      <SelectPieceModal
        isOpen={selectPieceModal.isOpen}
        selectPieceModal={selectPieceModal}
        setSelectPieceModal={setSelectPieceModal}
        cart={cart}
        setCart={setCart}
        generateId={generateId}
        setManualBarcode={setManualBarcode}
        setCutLengthModal={setCutLengthModal}
        showAlertRef={showAlertRef}
        onClose={() => setSelectPieceModal({ isOpen: false, item: null, instances: [], isLoading: false, action: 'checkout' })}
      />

      <ReceiveLengthModal
        isOpen={receiveLengthModal.isOpen}
        receiveLengthModal={receiveLengthModal}
        setReceiveLengthModal={setReceiveLengthModal}
        onSubmit={handleReceiveLengthSubmit}
        onClose={() => setReceiveLengthModal({ isOpen: false, item: null, length: '', batch: null, instanceBarcode: null })}
      />

      <ManualInstanceBarcodeModal
        isOpen={manualInstanceBarcodeModal.isOpen}
        manualInstanceBarcodeModal={manualInstanceBarcodeModal}
        setManualInstanceBarcodeModal={setManualInstanceBarcodeModal}
        onSubmit={handleManualInstanceBarcodeSubmit}
        onClose={() => setManualInstanceBarcodeModal({ isOpen: false, item: null, batch: null, barcodeInput: '', prefix: '', error: null })}
      />

      <CutLengthModal
        isOpen={cutLengthModal.isOpen}
        cutLengthModal={cutLengthModal}
        setCutLengthModal={setCutLengthModal}
        cart={cart}
        onSubmit={handleCutLengthSubmit}
        onClose={() => setCutLengthModal({ isOpen: false, item: null, instance: null, cutQty: '', discardScrap: false })}
      />

      <ScrewsModal
        isOpen={screwsModal.isOpen}
        onClose={() => setScrewsModal({ isOpen: false, price: '' })}
        onSave={handleSaveScrews}
        initialPrice={screwsModal.price}
        isUpdate={cart.some(i => i.is_screw || i.barcode === 'SCREWS')}
      />

      {isMobileScannerTab ? (
        <div className="flex flex-col flex-1 bg-[var(--bg-primary)] overflow-hidden" style={{ minHeight: 'calc(100vh - 160px)' }}>
          {cart.length > 0 && (
            <div className="p-4 flex-shrink-0 flex gap-2" style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-medium)' }}>
              <button 
                onClick={() => {
                  if (activeCartTab.startsWith('held_')) {
                    handleCancelHeldCart(activeCartTab);
                  } else {
                    showConfirm("Clear cart?", handleCancelSale, 'Clear Cart', 'Clear Cart', 'Keep Cart', true);
                  }
                }} 
                className="w-1/3 py-4 text-white font-black uppercase tracking-widest text-xs md:text-sm shadow-lg rounded-lg transition-all active:scale-95 flex items-center justify-center text-center" 
                style={{ backgroundColor: 'var(--color-error)' }}
              >
                {activeCartTab.startsWith('held_') ? 'CANCEL HELD' : 'CLEAR'}
              </button>
              <button onClick={handleCompleteTransaction} className="w-2/3 py-4 text-white font-black uppercase tracking-widest text-lg shadow-lg rounded-lg transition-all active:scale-95 flex items-center justify-center gap-2" style={{ backgroundColor: 'var(--color-accent)' }}>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                COMPLETE {cart.length}
              </button>
            </div>
          )}
          {isMobileScannerOpen && (
            <div className="p-4 w-full flex justify-center bg-[var(--bg-primary)] flex-shrink-0" style={{ borderBottom: '1px solid var(--border-medium)' }}>
              <div className="w-full max-w-md rounded-xl overflow-hidden border-4 flex flex-col justify-center relative" style={{ minHeight: '200px', maxHeight: '300px', borderColor: 'var(--color-success)', backgroundColor: 'var(--bg-secondary)' }}>
                <InlineContinuousScanner onScan={async (barcode) => { await processScan(barcode); }} />
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {cart.length === 0 ? (
              activeCartTab && activeCartTab.startsWith('held_') ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 my-auto">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-error)' }}>
                    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </div>
                  <p className="text-lg font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>This Held Cart is Empty</p>
                  <p className="text-sm mt-1 mb-5 font-medium" style={{ color: 'var(--text-tertiary)' }}>All items have been removed from this held cart.</p>
                  <div className="flex flex-col w-full max-w-xs gap-2.5">
                    <button
                      type="button"
                      onClick={() => handleCancelHeldCart(activeCartTab)}
                      className="w-full py-3.5 text-white font-bold uppercase tracking-wider text-xs shadow-md rounded-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                      style={{ backgroundColor: 'var(--color-error)' }}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      Cancel & Delete Held Cart
                    </button>
                    <button
                      type="button"
                      onClick={() => switchCartTab('local')}
                      className="w-full py-3.5 font-bold uppercase tracking-wider text-xs rounded-lg transition-all active:scale-95"
                      style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
                    >
                      ← Back to Local Cart
                    </button>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-6">
                  <svg className="w-20 h-20 mb-6 opacity-30" fill="currentColor" viewBox="0 0 20 20" style={{ color: 'var(--text-secondary)' }}><path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" /></svg>
                  <p className="text-xl font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>List is Empty</p>
                  <p className="text-base mt-2 font-medium" style={{ color: 'var(--text-tertiary)' }}>Tap the green button below to start.</p>
                </div>
              )
            ) : (
              <CartMobileView
                cart={cart}
                activeTab={activeTab}
                onUpdateQuantity={updateQuantity}
                onUpdateDimensions={updateDimensions}
                onRemoveItem={handleRemoveItem}
                onCancelHeldCart={() => handleCancelHeldCart(activeCartTab)}
                onBackToLocal={() => switchCartTab('local')}
              />
            )}
          </div>
          <div className="p-4 shadow-[0_-10px_15px_-3px_rgba(0,0,0,0.1)] flex-shrink-0" style={{ backgroundColor: 'var(--bg-secondary)', borderTop: '2px solid var(--border-medium)' }}>
            <button 
              onClick={() => setIsMobileScannerOpen(!isMobileScannerOpen)}
              className="w-full py-5 font-bold uppercase text-lg text-white shadow-md rounded-md transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{ backgroundColor: isMobileScannerOpen ? 'var(--color-error)' : 'var(--color-success)' }}
            >
              {isMobileScannerOpen ? (
                <>
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  STOP CAMERA
                </>
              ) : (
                <>
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  START SCANNING
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col flex-1 h-full min-h-0 shadow-sm print:hidden relative overflow-hidden" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
          
          {/* Offline Banner */}
          {!isOnline && (
            <div className="w-full bg-[var(--color-error)] text-white text-xs font-bold uppercase tracking-wider text-center py-1 flex items-center justify-center gap-2 relative z-10 shadow-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              Offline Mode - Changes will sync when internet returns
            </div>
          )}

          {/* Header Block */}
          {activeTab === 'checkout' && (pendingCarts.length > 0 || heldCarts.length > 0) && (
          <div className="flex gap-1.5 p-2 bg-[var(--bg-tertiary)] border-b border-[var(--border-medium)] overflow-x-hidden md:overflow-x-auto whitespace-nowrap scrollbar-hide items-center">
            <button 
              type="button"
              onClick={() => handleRestoreCart('local')}
              className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm transition-colors shrink-0"
              style={{
                backgroundColor: activeCartTab === 'local' ? 'var(--color-accent)' : 'var(--bg-primary)',
                color: activeCartTab === 'local' ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${activeCartTab === 'local' ? 'var(--color-accent)' : 'var(--border-medium)'}`
              }}
            >
              Local Cart
            </button>
            {heldCarts.map(hc => {
              const isActive = activeCartTab === hc.id;
              return (
                <div
                  key={hc.id}
                  className="inline-flex items-center rounded-sm transition-colors text-xs font-bold uppercase tracking-wider overflow-hidden shrink-0"
                  style={{
                    backgroundColor: isActive ? 'var(--color-accent)' : 'var(--bg-primary)',
                    color: isActive ? '#fff' : 'var(--text-secondary)',
                    border: `1px solid ${isActive ? 'var(--color-accent)' : 'var(--border-medium)'}`
                  }}
                >
                  <button 
                    type="button"
                    onClick={() => handleRestoreCart(hc.id)}
                    className="px-3 py-1.5 flex gap-2 items-center hover:opacity-90 focus:outline-none"
                    title={`Switch to ${hc.name}`}
                  >
                    <span>{hc.name}</span>
                    <span className="bg-white/20 px-1.5 rounded-full text-[10px]">{hc.items?.length || 0}</span>
                  </button>
                  <button
                    type="button"
                    data-testid={`cancel-held-cart-${hc.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCancelHeldCart(hc.id);
                    }}
                    className="px-2 py-1.5 transition-colors opacity-70 hover:opacity-100 hover:text-red-300 focus:outline-none"
                    title={`Cancel and discard ${hc.name}`}
                    aria-label={`Cancel and discard ${hc.name}`}
                  >
                    <svg className="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })}
            {pendingCarts.map(pc => {
              const isActive = activeCartTab === pc.id;
              return (
                <div
                  key={pc.id}
                  className="inline-flex items-center rounded-sm transition-colors text-xs font-bold uppercase tracking-wider overflow-hidden shrink-0"
                  style={{
                    backgroundColor: isActive ? 'var(--color-accent)' : 'var(--bg-primary)',
                    color: isActive ? '#fff' : 'var(--text-secondary)',
                    border: `1px solid ${isActive ? 'var(--color-accent)' : 'var(--border-medium)'}`
                  }}
                >
                  <button 
                    type="button"
                    onClick={() => handleRestoreCart(pc.id, pc.items)}
                    className="px-3 py-1.5 flex gap-2 items-center hover:opacity-90 focus:outline-none"
                    title={`Switch to ${pc.worker_name}'s Cart`}
                  >
                    <span>{pc.worker_name}'s Cart</span>
                    <span className="bg-white/20 px-1.5 rounded-full text-[10px]">{pc.items?.length || 0}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      showConfirm(
                        `Discard ${pc.worker_name}'s Cart?`,
                        () => handleDiscardPendingCart(pc.id),
                        'Discard Cart',
                        'Discard',
                        'Keep Cart',
                        true
                      );
                    }}
                    className="px-2 py-1.5 transition-colors opacity-70 hover:opacity-100 hover:text-red-300 focus:outline-none"
                    title={`Discard ${pc.worker_name}'s Cart`}
                    aria-label={`Discard ${pc.worker_name}'s Cart`}
                  >
                    <svg className="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className={`p-4 shrink-0 flex flex-col md:flex-row justify-between gap-4 ${(activeTab === 'receive' || activeTab === 'transfer') ? 'hidden md:flex' : ''}`} style={{ borderBottom: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-tertiary)' }}>
          <div className="flex flex-col w-full md:w-auto flex-1 md:flex-none">
            <h2 className="text-2xl font-medium" style={{ color: 'var(--text-primary)' }}>
              {activeTab === 'receive' ? 'Receive Stock' : activeTab === 'transfer' ? 'Move Stock to Store' : 'Checkout Counter'}
            </h2>
            
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <form onSubmit={(e) => { e.preventDefault(); processScan(manualBarcode); setManualBarcode(''); setShowSuggestions(false); }} className="relative w-full md:w-auto">
                <div className="flex items-center w-full md:w-72 h-10 md:h-9 rounded-md overflow-hidden transition-colors focus-within:border-[var(--color-accent)] focus-within:ring-1 focus-within:ring-[var(--color-accent)]" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)' }}>
                  <label htmlFor="manual-barcode" className="sr-only">Barcode</label>
                  <input id="manual-barcode" type="text" value={manualBarcode} onChange={(e) => setManualBarcode(e.target.value)} onFocus={() => { setIsInputFocused(true); manualBarcode.trim().length >= 2 && setShowSuggestions(true); }} onBlur={() => { setIsInputFocused(false); setTimeout(() => setShowSuggestions(false), 200); }} placeholder="Search barcode or name..." className="h-full w-full px-3 text-sm focus:outline-none flex-1 bg-transparent border-none outline-none rounded-none focus:ring-0 focus:border-transparent focus:shadow-none" style={{ color: 'var(--text-input)', outline: 'none', border: 'none', boxShadow: 'none' }} autoComplete="off" />
                  <button type="submit" className="h-full px-3 text-sm font-bold focus:outline-none transition-colors border-none rounded-none bg-transparent hover:bg-white/5 focus:ring-0 focus:outline-none shrink-0" style={{ color: 'var(--color-accent)', outline: 'none', border: 'none' }}>ADD</button>
                </div>
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="absolute top-[100%] left-0 w-full md:w-64 bg-[var(--bg-secondary)] border border-[var(--border-medium)] z-50 max-h-60 overflow-y-auto shadow-lg mt-1 rounded-sm">
                    {suggestions.map((item) => (
                      <li
                        key={item.barcode}
                        className="px-3 py-2 cursor-pointer hover:bg-[var(--bg-hover)] text-sm flex justify-between border-b border-[var(--border-light)] last:border-0"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          const typed = manualBarcode.trim();
                          let targetBarcode = item.barcode;
                          if (typed.startsWith(item.barcode + '-')) {
                            targetBarcode = typed;
                          }
                          setManualBarcode('');
                          setShowSuggestions(false);
                          processScan(targetBarcode);
                        }}
                      >
                        <span className="truncate pr-2 font-medium" style={{ color: 'var(--text-primary)' }}>{item.name}</span>
                        <span className="text-[10px]  whitespace-nowrap self-center px-1.5 py-0.5 rounded-sm" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--color-accent)' }}>#{item.barcode}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </form>

              {/* Screws quick add beside search bar */}
              {activeTab === 'checkout' && (
                <div className="flex items-center">
                  {cart.some(i => i.is_screw || i.barcode === 'SCREWS') ? (
                    <div 
                      className="flex items-center h-10 md:h-9 px-3 rounded-md border text-xs font-bold uppercase tracking-wider gap-2 shadow-sm animate-fade-in"
                      style={{ 
                        backgroundColor: 'var(--bg-input)', 
                        borderColor: 'var(--color-accent)', 
                        color: 'var(--color-accent)' 
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          const existing = cart.find(i => i.is_screw || i.barcode === 'SCREWS');
                          const currentVal = existing ? (existing.customPriceInput !== undefined ? String(existing.customPriceInput) : String(existing.price || '')) : '';
                          setScrewsModal({ isOpen: true, price: currentVal });
                        }}
                        className="flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
                        title="Click to edit screws price"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>Screws: ₹{Number(cart.find(i => i.is_screw || i.barcode === 'SCREWS')?.customPriceInput !== undefined ? cart.find(i => i.is_screw || i.barcode === 'SCREWS')?.customPriceInput : (cart.find(i => i.is_screw || i.barcode === 'SCREWS')?.price || 0)).toFixed(2)}</span>
                      </button>
                      <span className="opacity-30">|</span>
                      <button
                        type="button"
                        onClick={() => setCart(prev => prev.filter(i => !i.is_screw && i.barcode !== 'SCREWS'))}
                        className="w-4 h-4 flex items-center justify-center rounded text-[var(--text-secondary)] hover:text-[var(--color-error)] transition-colors cursor-pointer"
                        title="Remove screws from bill"
                        aria-label="Remove screws"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setScrewsModal({ isOpen: true, price: '' })}
                      className="h-10 md:h-9 px-3.5 rounded-md border text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                      style={{
                        borderColor: 'var(--border-input)',
                        backgroundColor: 'var(--bg-input)',
                        color: 'var(--text-secondary)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border-heavy)';
                        e.currentTarget.style.color = 'var(--text-primary)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border-input)';
                        e.currentTarget.style.color = 'var(--text-secondary)';
                      }}
                    >
                      <svg className="w-3.5 h-3.5" style={{ color: 'var(--color-accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                      </svg>
                      <span>Include Screws</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="text-left md:text-right flex flex-col justify-end pt-2 md:pt-0 border-t border-[var(--border-light)] md:border-t-0 shrink-0">
            <span className="text-xs uppercase font-semibold tracking-wider block mb-1" style={{ color: 'var(--text-tertiary)' }}>{activeTab === 'checkout' ? 'Total Price' : 'Total Units'}</span>
            <span className="text-3xl md:text-4xl font-light" style={{ color: 'var(--color-accent)' }} aria-live="polite">
              {activeTab === 'checkout' ? `₹${cartTotal.toFixed(2)}` : cartUnits}
            </span>
          </div>
        </div>

        {/* Desktop View */}
        <div
          ref={cartScrollRef}
          className="hidden md:block flex-1 min-h-0 overflow-y-auto overflow-x-auto"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            scrollBehavior: 'smooth',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          <CartTable
            cart={cart}
            selectedCartIndex={selectedCartIndex}
            onSelectCartIndex={setSelectedCartIndex}
            activeTab={activeTab}
            onUpdateQuantity={updateQuantity}
            onUpdateDimensions={updateDimensions}
            onCustomPriceChange={handleCustomPriceChange}
            onCustomTotalChange={handleCustomTotalChange}
            onCustomPriceBlur={applyCustomPriceBlur}
            onCustomPriceChangeGroup={handleCustomPriceChangeGroup}
            onCustomTotalChangeGroup={handleCustomTotalChangeGroup}
            onCustomPriceBlurGroup={handleCustomPriceBlurGroup}
            onRemoveItem={handleRemoveItem}
            onCancelHeldCart={() => handleCancelHeldCart(activeCartTab)}
            onBackToLocal={() => switchCartTab('local')}
          />
        </div>

        {/* Mobile View for Checkout */}
        <div
          ref={mobileCartScrollRef}
          className="md:hidden flex-1 min-h-0 overflow-y-auto"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border-medium)',
            scrollBehavior: 'smooth',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          <CartMobileView
            cart={cart}
            activeTab={activeTab}
            onUpdateQuantity={updateQuantity}
            onUpdateDimensions={updateDimensions}
            onCustomPriceChange={handleCustomPriceChange}
            onCustomTotalChange={handleCustomTotalChange}
            onCustomPriceBlur={applyCustomPriceBlur}
            onRemoveItem={handleRemoveItem}
            onCancelHeldCart={() => handleCancelHeldCart(activeCartTab)}
            onBackToLocal={() => switchCartTab('local')}
          />
        </div>

        {cart.length > 0 && !isInputFocused && (
          <div className="p-3 md:p-4 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 shrink-0" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <div className="flex w-full sm:w-auto gap-2 md:gap-3">
              {activeCartTab.startsWith('held_') ? (
                <button
                  type="button"
                  data-testid="bottom-cancel-held-cart"
                  onClick={() => handleCancelHeldCart(activeCartTab)}
                  className="flex-1 sm:flex-none min-h-[40px] md:h-10 px-4 md:px-5 text-sm font-semibold uppercase tracking-wider focus:outline-none rounded-md flex items-center justify-center gap-2 transition-all active:scale-95"
                  style={{ backgroundColor: 'transparent', color: 'var(--color-error)', border: '1px solid var(--color-error)' }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  <span>Cancel Held Cart</span>
                </button>
              ) : activeCartTab !== 'local' ? (
                <button
                  type="button"
                  onClick={() => showConfirm(
                    "Discard this worker cart?",
                    () => handleDiscardPendingCart(activeCartTab),
                    'Discard Cart',
                    'Discard',
                    'Keep Cart',
                    true
                  )}
                  className="flex-1 sm:flex-none min-h-[40px] md:h-10 px-4 md:px-5 text-sm font-semibold uppercase tracking-wider focus:outline-none rounded-md flex items-center justify-center gap-2 transition-all active:scale-95"
                  style={{ backgroundColor: 'transparent', color: 'var(--color-error)', border: '1px solid var(--color-error)' }}
                >
                  <span>Discard Cart</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => showConfirm("Clear all items?", handleCancelSale, activeTab === 'checkout' ? 'Cancel Sale' : 'Clear Items', 'Clear', 'Cancel', true)}
                  className="flex-1 sm:flex-none min-h-[40px] md:h-10 px-4 md:px-5 text-sm font-semibold uppercase tracking-wider focus:outline-none rounded-md flex items-center justify-center gap-2 transition-all active:scale-95"
                  style={{ backgroundColor: 'transparent', color: 'var(--color-error)', border: '1px solid var(--color-error)' }}
                >
                  <span>{activeTab === 'checkout' ? 'Cancel Sale' : 'Clear Items'}</span>
                </button>
              )}
              {activeTab === 'checkout' && activeCartTab === 'local' && (
                <button
                  onClick={handleHoldCart}
                  className="flex-1 sm:flex-none min-h-[40px] md:h-10 px-4 md:px-5 text-sm font-semibold uppercase tracking-wider focus:outline-none rounded-md flex items-center justify-center gap-2"
                  style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)' }}
                >
                  <span>Hold Cart</span>
                </button>
              )}
            </div>
            <button
              onClick={() => activeTab === 'checkout' ? handleOpenCheckoutModal() : handleCompleteTransaction()}
              className="w-full sm:w-auto min-h-[40px] md:h-10 px-6 md:px-8 text-white text-sm font-semibold uppercase tracking-wider focus:outline-none rounded-md focus:ring-2 focus:ring-offset-1 flex justify-center items-center gap-2"
              style={{ backgroundColor: 'var(--color-accent)', border: '1px solid transparent' }}
            >
              <span>{isCheckingOut ? 'Saving...' : 'Complete'}</span>
            </button>
          </div>
        )}
      </div>
      )}
      {/* Hidden Receipt Template for actual browser printing */}
      <ReceiptTemplate lastReceipt={lastReceipt} shopSettings={shopSettings} formatDateTime={formatDateTime} />

      {/* Custom Print Preview Modal */}
      <PrintPreviewModal
        isOpen={printPreviewOpen}
        onClose={() => setPrintPreviewOpen(false)}
        type="receipt"
        title="Receipt Preview"
        lastReceipt={lastReceipt}
        shopSettings={shopSettings}
      >
        <ReceiptTemplate lastReceipt={lastReceipt} shopSettings={shopSettings} formatDateTime={formatDateTime} isPreview={true} />
      </PrintPreviewModal>
    </>
  );
}