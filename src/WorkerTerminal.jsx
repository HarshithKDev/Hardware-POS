import React, { useState, useRef, useEffect, useCallback, Fragment } from 'react';
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
import { generateId, formatDateTime } from './utils';
import { SCAN_TIMEOUT_MS } from './constants';

import InlineContinuousScanner from './components/scanner/InlineContinuousScanner';
import CartTable from './components/cart/CartTable';
import CartMobileView from './components/cart/CartMobileView';
// ---------------------------------------------------------------
// Extracted sub-components (Phase 5 decomposition)
// ---------------------------------------------------------------


// ---------------------------------------------------------------
// Main WorkerTerminal component (orchestrator)
// ---------------------------------------------------------------
export default function WorkerTerminal({ activeTab, shopSettings, cashierName }) {
  const { showAlert, showConfirm, alertConfig, confirmConfig } = useApp();
  const queryClient = useQueryClient();

  const { 
    cart, setCart,
    removeItem: handleRemoveItem,
    customPriceChange: onCustomPriceChange,
    customPriceBlur: onCustomPriceBlur,
    customPriceChangeGroup: onCustomPriceChangeGroup,
    customPriceBlurGroup: onCustomPriceBlurGroup, 
    activeCartTab,
    cartSessions, setCartSessions, 
    heldCarts, setHeldCarts,
    clearCart
  } = useCart();
  const [manualBarcode, setManualBarcode] = useState('');
  const [isMobileScannerOpen, setIsMobileScannerOpen] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [checkoutModal, setCheckoutModal] = useState({ isOpen: false, cashGiven: '' });
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [looseItemModal, setLooseItemModal] = useState({ isOpen: false, item: null, qty: '' });

  // Cuttable item states
  const [selectPieceModal, setSelectPieceModal] = useState({ isOpen: false, item: null, instances: [], isLoading: false, action: 'checkout' });
  const [cutLengthModal, setCutLengthModal] = useState({ isOpen: false, item: null, instance: null, cutQty: '', discardScrap: false });
  const [receiveLengthModal, setReceiveLengthModal] = useState({ isOpen: false, item: null, length: '' });

  // Pending Carts (Mobile Scanner)
  const [pendingCarts, setPendingCarts] = useState([]);


  const barcodeBuffer = useRef('');
  const lastKeyTime = useRef(Date.now());
  const cartRef = useRef(cart);
  // Refs for values used inside the keydown closure (fixes stale closure #18)
  const activeTabRef = useRef(activeTab);
  const showAlertRef = useRef(showAlert);

  useEffect(() => { cartRef.current = cart; }, [cart]);


  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  useEffect(() => { showAlertRef.current = showAlert; }, [showAlert]);

  useEffect(() => {
    if (activeTab === 'checkout') {
      const fetchPending = async () => {
        const { data } = await supabase.from('pending_carts').select('*').eq('status', 'pending').order('created_at', { ascending: true });
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
        
        // Check if search matches any active stock instances
        const { data: instData } = await supabase.from('stock_instances')
          .select('instance_barcode, current_length, parent_barcode, inventory:parent_barcode(name, unit)')
          .ilike('instance_barcode', `%${searchStr}%`)
          .eq('is_active', true)
          .limit(5);
          
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
    const cleanBarcode = scannedCode.trim();
    if (!cleanBarcode) return;

    let scannedInstanceBarcode = null;
    let searchBarcode = cleanBarcode;

    // First try exact match in inventory
    let item = cartRef.current.find(i => i.barcode === searchBarcode && !i.is_cuttable);
    if (!item) {
      item = await getInventoryItemByBarcode(searchBarcode);
    }

    // If exact match fails, check if it's a 6-digit suffixed instance barcode
    if (!item && cleanBarcode.length > 6) {
      const possibleParent = cleanBarcode.slice(0, -6);
      const possibleSuffix = cleanBarcode.slice(-6);
      
      if (!isNaN(possibleSuffix)) {
        const parentItem = await getInventoryItemByBarcode(possibleParent);
        if (parentItem && parentItem.is_cuttable) {
          searchBarcode = possibleParent;
          scannedInstanceBarcode = cleanBarcode;
          item = parentItem;
        }
      }
    }

    // Handle legacy dash format just in case there are old barcodes floating around
    if (!item && cleanBarcode.includes('-')) {
      const parts = cleanBarcode.split('-');
      if (parts.length === 2 && !isNaN(parts[1])) {
        const parentItem = await getInventoryItemByBarcode(parts[0]);
        if (parentItem && parentItem.is_cuttable) {
          searchBarcode = parts[0];
          scannedInstanceBarcode = cleanBarcode;
          item = parentItem;
        }
      }
    }

    if (!item) return showAlertRef.current(`Barcode ${cleanBarcode} not found in the system.`, "Error");

    if (item) {
      const currentTab = activeTabRef.current;

      // Cuttable items receive logic
      if (item.is_cuttable && currentTab === 'receive') {
        if (scannedInstanceBarcode) {
          setCart(prev => {
            const idx = prev.findIndex(c => c.instance_barcode === scannedInstanceBarcode);
            if (idx >= 0) return prev;
            return [...prev, { ...item, id: generateId(), instance_barcode: scannedInstanceBarcode, customPriceInput: Number(item.price || 0).toFixed(2), discountPct: 0, quantity: 1, unit: item.unit, length: '', width: '', default_length: item.default_length, default_width: item.default_width }];
          });
        } else {
          setCart(prev => [...prev, { ...item, id: generateId(), customPriceInput: Number(item.price || 0).toFixed(2), discountPct: 0, quantity: 1, unit: item.unit, length: '', width: '', default_length: item.default_length, default_width: item.default_width }]);
        }
        setManualBarcode('');
        return;
      }

      // Cuttable items transfer logic
      if (item.is_cuttable && currentTab === 'transfer') {
        if (scannedInstanceBarcode) {
          // Verify instance exists and get length if transferring
          let instLength = item.default_length;
          const { data } = await supabase.from('stock_instances').select('current_length').eq('instance_barcode', scannedInstanceBarcode).single();
          if (!data) return showAlertRef.current(`Piece #${scannedInstanceBarcode} does not exist!`, "Not Found");
          if (!data.current_length || data.current_length <= 0) return showAlertRef.current(`Piece #${scannedInstanceBarcode} has no length left!`, "Empty Piece");
          instLength = data.current_length;

          // Add the scanned instance barcode directly to the cart as 1 piece
          setCart(prev => {
            const idx = prev.findIndex(c => c.instance_barcode === scannedInstanceBarcode);
            if (idx >= 0) {
              showAlertRef.current(`Piece #${scannedInstanceBarcode} is already in the cart!`, "Already Added");
              return prev; // Already scanned
            }
            return [...prev, { ...item, id: generateId(), instance_barcode: scannedInstanceBarcode, quantity: 1, unit: item.unit, length: '', width: '', default_length: item.default_length, default_width: item.default_width, pieceLength: instLength }];
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
            showAlertRef.current("Cannot view active pieces while offline.", "Offline");
          }
          return;
        }
      }

      // Cuttable items logic (only applies in Checkout/Sale mode)
      if (item.is_cuttable && currentTab === 'checkout') {
        if (scannedInstanceBarcode) {
          // They scanned a specific piece directly
          let instData = null;
          if (navigator.onLine) {
            const { data } = await supabase.from('stock_instances').select('*').eq('instance_barcode', scannedInstanceBarcode).single();
            instData = data;
          }
          setCutLengthModal({
            isOpen: true,
            item,
            instance: instData || { instance_barcode: scannedInstanceBarcode, current_length: '?' },
            cutQty: '',
            discardScrap: false
          });
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

      // Normal items stock check
      if (currentTab === 'checkout' && !item.is_cuttable) {
        const currentCartItem = cartRef.current.find(c => c.barcode === cleanBarcode);
        const currentQty = currentCartItem ? (Number(currentCartItem.quantity) || 0) : 0;
        if (Number(item.stock_store || 0) <= 0) return showAlertRef.current(`${item.name} is out of stock in the store.`, "Out of Stock");
        if (currentQty >= Number(item.stock_store || 0)) return showAlertRef.current(`You only have ${item.stock_store} of ${item.name} in the store.`, "Stock Limit");
      }

      if (item.is_loose_item) {
        setLooseItemModal({ isOpen: true, item, qty: '' });
        return;
      }

      setCart(prev => {
        const idx = prev.findIndex(c => c.barcode === cleanBarcode);
        if (idx >= 0) { const up = [...prev]; up[idx] = { ...up[idx], quantity: (Number(up[idx].quantity) || 0) + 1 }; return up; }
        return [...prev, { ...item, id: generateId(), customPriceInput: Number(item.price || 0).toFixed(2), discountPct: 0, quantity: item.unit === 'SQFT' ? 0 : 1, unit: item.unit || 'PCS', length: '', width: '', rolls: '1' }];
      });
    }
  }, []);

  useEffect(() => {
    const isModalOpen = alertConfig.isOpen || confirmConfig.isOpen || checkoutModal.isOpen || printPreviewOpen || looseItemModal.isOpen || selectPieceModal.isOpen || cutLengthModal.isOpen || receiveLengthModal.isOpen;
    const handleGlobalKeyDown = (e) => {
      if (isModalOpen) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      const currentTime = Date.now();
      if (currentTime - lastKeyTime.current > SCAN_TIMEOUT_MS) barcodeBuffer.current = '';
      lastKeyTime.current = currentTime;
      if (e.key === 'Enter') {
        if (barcodeBuffer.current.length > 0) { e.preventDefault(); processScan(barcodeBuffer.current); barcodeBuffer.current = ''; }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        barcodeBuffer.current += e.key;
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [alertConfig.isOpen, confirmConfig.isOpen, checkoutModal.isOpen, printPreviewOpen, looseItemModal.isOpen, selectPieceModal.isOpen, cutLengthModal.isOpen, receiveLengthModal.isOpen, processScan]);

  const handleLooseItemSubmit = (e) => {
    if (e) e.preventDefault();
    const { item, qty } = looseItemModal;
    const addQty = Number(qty) || 0;
    if (addQty <= 0) {
      setLooseItemModal({ isOpen: false, item: null, qty: '' });
      return;
    }

    if (activeTab === 'checkout') {
      const currentCartItem = cart.find(c => c.barcode === item.barcode);
      const currentQty = currentCartItem ? (Number(currentCartItem.quantity) || 0) : 0;
      const proposedQty = currentQty + addQty;
      if (proposedQty > Number(item.stock_store || 0)) {
        showAlert(`You only have ${item.stock_store} of ${item.name} in the store.`, "Stock Limit");
        return;
      }
    }

    setCart(prev => {
      const idx = prev.findIndex(c => c.barcode === item.barcode);
      if (idx >= 0) {
        const up = [...prev];
        up[idx] = { ...up[idx], quantity: (Number(up[idx].quantity) || 0) + addQty };
        return up;
      }
      return [...prev, {
        ...item,
        id: generateId(),
        customPriceInput: Number(item.price || 0).toFixed(2),
        discountPct: 0,
        quantity: addQty,
        unit: item.unit || 'PCS',
        length: '', width: '', rolls: '1'
      }];
    });
    setLooseItemModal({ isOpen: false, item: null, qty: '' });
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
    const alreadyInCart = cart.filter(c => c.instance_barcode === instance.instance_barcode).reduce((tot, c) => tot + Number(c.length || 0), 0);
    const availableLength = currentLength - alreadyInCart;
    if (!isNaN(currentLength) && addQty > availableLength) {
      if (alreadyInCart > 0) {
        showAlert(`You already have ${alreadyInCart}${item.unit} of this piece in the cart. You only have ${availableLength.toFixed(2)}${item.unit} left!`, "Invalid Cut");
      } else {
        showAlert(`You are trying to cut ${addQty}${item.unit}, but the piece only has ${currentLength}${item.unit} left!`, "Invalid Cut");
      }
      return;
    }

    setCart(prev => {

      return [...prev, {
        ...item,
        id: generateId(),
        instance_barcode: instance.instance_barcode,
        discard_scrap: discardScrap,
        name: item.name,
        customPriceInput: Number(item.price || 0).toFixed(2),
        discountPct: 0,
        quantity: item.unit === 'SQFT' ? parseFloat((addQty * (Number(item.default_width) || 1)).toFixed(2)) : addQty,
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

  const handleReceiveLengthSubmit = (e) => {
    if (e) e.preventDefault();
    if (!receiveLengthModal.length) return;

    const { item, length } = receiveLengthModal;
    setCart(prev => {
      const idx = prev.findIndex(c => c.barcode === item.barcode);
      if (idx >= 0) {
        const up = [...prev];
        up[idx] = { ...up[idx], quantity: (Number(up[idx].quantity) || 0) + 1, pieceLength: length };
        return up;
      }
      return [{ ...item, quantity: 1, pieceLength: length, customPriceInput: '' }, ...prev];
    });
    setReceiveLengthModal({ isOpen: false, item: null, length: '' });
  };

  const updateQuantity = (id, val) => {
    setCart(prev => {
      let limitMsg = '';
      const newCart = prev.map(i => {
        if (i.id === id) {
          let newQty = val === '' ? '' : Math.max(0, Number(val));
          if (activeTab === 'checkout' && val !== '') {
            if (i.is_cuttable && i.instance_barcode && i.unit !== 'SQFT') {
              const maxLength = Number(i.max_available_length || 0);
              if (newQty > maxLength) {
                limitMsg = `You only have ${maxLength} ${i.unit} left on this piece.`;
                newQty = maxLength;
              }
            } else {
              const maxStock = Number(i.stock_store || 0);
              if (newQty > maxStock) { limitMsg = `You only have ${maxStock} of ${i.name} in the store.`; newQty = maxStock; }
            }
          }
          return { ...i, quantity: newQty, pieceLength: (i.is_cuttable && i.unit !== 'SQFT') ? newQty : i.pieceLength };
        }
        return i;
      }).filter(i => i.quantity !== 0);
      if (limitMsg) setTimeout(() => showAlert(limitMsg, "Stock Limit"), 0);
      return newCart;
    });
  };

  const updateDimensions = (id, field, val) => {
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
          const r = updated.rolls === '' ? 1 : (Number(updated.rolls) || 1);
          let newQty = parseFloat((l * w * r).toFixed(2));
          
          if (activeTab === 'checkout' && newQty > 0) {
            if (updated.is_cuttable && updated.instance_barcode) {
              const maxLength = Number(updated.max_available_length || 0);
              if (l > maxLength) {
                limitMsg = `You only have ${maxLength} ft left on this piece.`;
                updated.length = maxLength;
                l = maxLength;
                newQty = parseFloat((maxLength * w * r).toFixed(2));
              }
            } else {
              const maxStock = Number(i.stock_store || 0);
              if (newQty > maxStock) { limitMsg = `You only have ${maxStock} of ${i.name} in the store.`; newQty = maxStock; }
            }
          }
          return { ...updated, quantity: newQty };
        }
        return i;
      });
      if (limitMsg) setTimeout(() => showAlert(limitMsg, "Stock Limit"), 0);
      return newCart;
    });
  };


  const handleCustomPriceChange = (id, val) => setCart(prev => prev.map(i => i.id === id ? { ...i, customPriceInput: val } : i));
  const handleCustomPriceChangeGroup = (barcode, val) => setCart(prev => prev.map(i => (i.barcode === barcode && i.is_cuttable) ? { ...i, customPriceInput: val } : i));

  const applyCustomPriceBlur = (id) => setCart(prev => prev.map(i => {
    if (i.id === id) {
      let val = Number(i.customPriceInput); if (isNaN(val)) val = Number(i.price || 0);
      const msp = Number(i.msp || 0); const mrp = Number(i.price || 0);
      if (val < msp) val = msp; if (val > mrp) val = mrp;
      const disc = mrp > 0 ? ((mrp - val) / mrp) * 100 : 0;
      return { ...i, customPriceInput: val.toFixed(2), discountPct: disc };
    }
    return i;
  }));

  const handleCustomPriceBlurGroup = (barcode) => {
    setCart(prev => {
      return prev.map(i => {
        if (i.barcode === barcode && i.is_cuttable) {
          const msp = Number(i.msp || 0);
          let val = Number(i.customPriceInput);
          if (isNaN(val) || val <= 0) val = Number(i.price);
          if (val < msp && cashierName !== 'admin') {
            setTimeout(() => showAlertRef.current(`Cannot sell ${i.name} below MSP (₹${msp})`, "Price Error"), 0);
            val = msp;
          }
          let newDisc = 0;
          if (val < Number(i.price)) {
            newDisc = ((Number(i.price) - val) / Number(i.price)) * 100;
          }
          return { ...i, customPriceInput: val.toFixed(2), discountPct: newDisc };
        }
        return i;
      });
    });
  };

  const calculateTotal = () => cart.reduce((tot, i) => tot + Math.round((i.customPriceInput !== undefined && i.customPriceInput !== '' ? Number(i.customPriceInput) : Number(i.price || 0)) * 100) * (i.quantity === '' ? 0 : Number(i.quantity)), 0) / 100;
  const calculateTotalUnits = () => cart.reduce((tot, i) => tot + (i.quantity === '' ? 0 : Number(i.quantity)), 0);

  const handleCancelSale = () => {
    if (activeCartTab.startsWith('held_')) {
      setHeldCarts(prev => prev.filter(c => c.id !== activeCartTab));
      setCartSessions(prev => {
        const next = { ...prev };
        delete next[activeCartTab];
        return next;
      });
      setActiveCartTab('local');
      setCart(cartSessions['local'] || []);
    } else if (activeCartTab !== 'local') {
      supabase.from('pending_carts').delete().eq('id', activeCartTab).then();
      setCartSessions(prev => {
        const next = { ...prev };
        delete next[activeCartTab];
        return next;
      });
      setActiveCartTab('local');
      setCart(cartSessions['local'] || []);
    } else {
      setCart([]);
    }
  };

  const handleCompleteTransaction = async () => {
    const finalCart = cart.filter(i => Number(i.quantity) > 0);
    if (finalCart.length === 0) return;

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
      if (activeTab === 'checkout' && navigator.onLine) {
        try {
          const barcodes = finalCart.map(item => item.barcode);
          const { data: liveStock, error: stockError } = await supabase.from('inventory').select('barcode, name, stock_store').in('barcode', barcodes);
          if (!stockError && liveStock) {
            for (const cartItem of finalCart) {
              const liveItem = liveStock.find(i => i.barcode === cartItem.barcode);
              if (!liveItem || Number(liveItem.stock_store) < cartItem.quantity) {
                const available = liveItem ? liveItem.stock_store : 0;
                throw new Error(`Someone just bought ${cartItem.name}! There are only ${available} left in the shop.`);
              }
            }
          }
        } catch (e) {
          if (e.message.includes('left in the shop')) throw e;
        }
      }

      const payload = {
        p_action: activeTab === 'receive' ? 'RECEIVE' : activeTab === 'transfer' ? 'TRANSFER' : 'SALE',
        p_location: activeTab === 'receive' ? 'Warehouse-Inbound' : activeTab === 'transfer' ? 'Warehouse-Transfer' : 'Store',
        p_cashier_name: cashierName || 'System',
        p_items: finalCart.map(i => {
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
          return {
            barcode: i.barcode,
            name: i.name,
            quantity: calcQuantity,
            price: i.customPriceInput !== undefined && i.customPriceInput !== '' ? Number(i.customPriceInput) : Number(i.price || 0),
            discountPct: 0,
            unit: i.unit,
            instance_barcode: i.instance_barcode || null,
            discard_scrap: i.discard_scrap || false,
            piece_length: i.pieceLength || null,
            num_rolls: (activeTab === 'receive' && i.is_cuttable) ? Number(i.quantity) : null,
            default_length: i.default_length ? Number(i.default_length) : null,
            default_width: i.default_width ? Number(i.default_width) : null
          };
        }),
      };

      let successData = null;
      if (navigator.onLine) {
        try {
          const { data, error } = await supabase.rpc('process_pos_transaction', payload);
          if (error) throw error;
          successData = data;
        } catch (error) {
          if (error.message === 'Failed to fetch' || error.code === '503') {
            await queueOfflineTransaction(payload);
            successData = { bill_id: 'OFFL-' + generateId().substring(0, 5).toUpperCase() };
            setTimeout(() => showAlertRef.current("Transaction queued offline. It will sync automatically when internet returns.", "Offline Mode"), 100);
          } else {
            throw new Error(error.message);
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
            localItem.stock_warehouse = (Number(localItem.stock_warehouse) || 0) + Number(item.quantity);
          } else if (activeTab === 'transfer') {
            localItem.stock_warehouse = Math.max(0, (Number(localItem.stock_warehouse) || 0) - Number(item.quantity));
            localItem.stock_store = (Number(localItem.stock_store) || 0) + Number(item.quantity);
          } else if (activeTab === 'checkout') {
            localItem.stock_store = Math.max(0, (Number(localItem.stock_store) || 0) - Number(item.quantity));
          }
          await saveInventoryBatch([localItem]);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      // Also invalidate piece_counts for cuttable items so WHSE/STORE QTY refreshes
      queryClient.invalidateQueries({ queryKey: ['piece_counts'] });

      if (navigator.onLine) {
        // Trigger background sync to ensure true consistency with server
        syncInventoryToLocal().then(() => {
          queryClient.invalidateQueries({ queryKey: ['inventory'] });
          queryClient.invalidateQueries({ queryKey: ['piece_counts'] });
        });
      }

      setLastReceipt({
        id: successData.bill_id.split('-')[0],
        items: finalCart.map(i => {
          const finalRate = i.customPriceInput !== undefined && i.customPriceInput !== '' ? Number(i.customPriceInput) : Number(i.price || 0);
          return { ...i, quantity: Number(i.quantity), finalRate, mrp: Number(i.price || 0), lineTotal: finalRate * Number(i.quantity) };
        }),
        total: calculateTotal(),
        date: new Date(),
        type: activeTab,
      });

      if (activeCartTab.startsWith('held_')) {
        setHeldCarts(prev => prev.filter(c => c.id !== activeCartTab));
        setCartSessions(prev => {
          const next = { ...prev };
          delete next[activeCartTab];
          return next;
        });
        setActiveCartTab('local');
        setCart(cartSessions['local'] || []);
      } else if (activeCartTab !== 'local') {
        // Delete the remote cart
        supabase.from('pending_carts').delete().eq('id', activeCartTab).then();
        // Clear local session for this tab and switch to local
        setCartSessions(prev => ({ ...prev, [activeCartTab]: [] }));
        setActiveCartTab('local');
        setCart(cartSessions['local'] || []);
      } else {
        setCart([]);
      }
      
      setCheckoutModal({ isOpen: false, cashGiven: '' });

      if (activeTab === 'checkout') {
        setPrintPreviewOpen(true);
      } else {
        showAlert("Stock updated successfully.", "Success");
      }
    } catch (e) {
      showAlert(e.message, "Notice");
    } finally {
      setIsCheckingOut(false);
    }
  };

  const cartTotal = calculateTotal();
  const cartUnits = calculateTotalUnits();
  const cartTotalCents = Math.round(cartTotal * 100);
  const cashGivenCents = Math.round(Number(checkoutModal.cashGiven || 0) * 100);
  const differenceCents = Math.abs(cashGivenCents - cartTotalCents);
  const isShortfall = cashGivenCents > 0 && cashGivenCents < cartTotalCents;

  const isMobileScannerTab = window.innerWidth < 768 && (activeTab === 'receive' || activeTab === 'transfer');

  return (
    <>
      {/* Checkout Modal */}
      {checkoutModal.isOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center z-[100] print:hidden px-4 animate-fade-in"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkout-title"
        >
          <div className="w-[85%] max-w-[450px] flex flex-col rounded-xl overflow-hidden animate-scale-in border border-[var(--border-light)] shadow-2xl" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
            <div className="flex justify-between items-center pr-1 pl-4 py-1" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span id="checkout-title" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Checkout Payment</span>
              <button onClick={() => setCheckoutModal({ ...checkoutModal, isOpen: false })} className="px-3 py-1.5 leading-none focus:outline-none rounded-md" aria-label="Close checkout">✕</button>
            </div>
            <div className="p-6">
              <div className="flex justify-between items-end mb-6 pb-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Total Due</span>
                <span className="text-4xl font-light" style={{ color: 'var(--color-accent)' }} aria-live="polite">₹{cartTotal.toFixed(2)}</span>
              </div>
              <div className="mb-6">
                <label htmlFor="cash-given" className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Cash Given (₹)</label>
                <input id="cash-given" type="number" step="any" autoFocus value={checkoutModal.cashGiven} onChange={(e) => setCheckoutModal({ ...checkoutModal, cashGiven: e.target.value })} placeholder="0.00" className="w-full h-12 px-4 text-2xl font-mono focus:outline-none rounded-md" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
              </div>
              {cashGivenCents > 0 && (
                <div className={`p-4 ${!isShortfall ? 'pos-success-box' : 'pos-error-box'}`} aria-live="polite">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>{!isShortfall ? 'Give Change' : 'Missing Amount'}</span>
                    <span className="text-2xl font-light" style={{ color: 'var(--text-primary)' }}>₹{(differenceCents / 100).toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>
            <div className="p-4 flex justify-end gap-2" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
              <button onClick={handleCompleteTransaction} disabled={isCheckingOut || isShortfall} className="h-9 px-8 text-white text-sm font-semibold focus:outline-none rounded-md disabled:opacity-50 flex justify-center items-center min-w-[120px]" style={{ backgroundColor: 'var(--color-accent)' }}>
                {isCheckingOut ? <Spinner className="w-4 h-4 text-white" /> : 'Complete Sale'}
              </button>
              <button onClick={() => setCheckoutModal({ ...checkoutModal, isOpen: false })} disabled={isCheckingOut} className="h-9 px-8 text-sm font-semibold disabled:opacity-50 focus:outline-none rounded-md" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Loose Item Quantity Modal */}
      {looseItemModal.isOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-[150] px-4 animate-fade-in" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="w-[85%] max-w-[400px] flex flex-col rounded-xl overflow-hidden animate-scale-in border border-[var(--border-light)] shadow-2xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div className="flex justify-between items-center pr-1 pl-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Loose Item Quantity</span>
              <button type="button" onClick={() => setLooseItemModal({ isOpen: false, item: null, qty: '' })} className="px-3 py-1.5 leading-none focus:outline-none rounded-md text-lg">✕</button>
            </div>
            <form onSubmit={handleLooseItemSubmit}>
              <div className="p-6">
                <p className="text-sm mb-4 font-semibold">{looseItemModal.item?.name}</p>
                <label htmlFor="loose-qty" className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Enter Quantity</label>
                <input id="loose-qty" type="number" step="any" min="0.1" autoFocus value={looseItemModal.qty} onChange={(e) => setLooseItemModal({ ...looseItemModal, qty: e.target.value })} placeholder="0" className="w-full h-12 px-4 text-2xl font-mono focus:outline-none rounded-md" style={{ border: '2px solid var(--color-accent)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
              </div>
              <div className="p-4 flex justify-end gap-2" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
                <button type="submit" disabled={!looseItemModal.qty} className="h-9 px-8 text-white text-sm font-semibold focus:outline-none rounded-md disabled:opacity-50" style={{ backgroundColor: 'var(--color-accent)' }}>Add to Cart</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Select Piece Modal */}
      {selectPieceModal.isOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-[150] px-4 animate-fade-in" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="w-[85%] max-w-[400px] flex flex-col rounded-xl overflow-hidden animate-scale-in border border-[var(--border-light)] shadow-2xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div className="flex justify-between items-center pr-1 pl-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Select Piece</span>
              <button type="button" onClick={() => setSelectPieceModal({ isOpen: false, item: null, instances: [], isLoading: false, action: 'checkout' })} className="px-3 py-1.5 leading-none focus:outline-none rounded-md text-lg">✕</button>
            </div>
            <div className="p-6 flex flex-col">
              <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>Which piece of <strong style={{ color: 'var(--color-accent)' }}>{selectPieceModal.item?.name}</strong> are you {selectPieceModal.action === 'transfer' ? 'transferring' : 'cutting from'}?</p>

              {selectPieceModal.isLoading ? (
                <div className="flex justify-center p-6"><Spinner className="w-6 h-6 text-[var(--color-accent)]" /></div>
              ) : selectPieceModal.instances.length === 0 ? (
                <p className="text-xs font-bold text-center p-4 text-[var(--color-error)]">No active pieces found.</p>
              ) : (
                <div className="max-h-[300px] overflow-y-auto flex flex-col gap-2 mb-4">
                  {selectPieceModal.instances.map(inst => {
                    let availableLength = Number(inst.current_length);
                    if (selectPieceModal.action === 'checkout') {
                      const inCartQty = cart.filter(c => c.instance_barcode === inst.instance_barcode).reduce((sum, c) => sum + Number(c.quantity || 0), 0);
                      availableLength -= inCartQty;
                    }
                    
                    if (availableLength <= 0 && selectPieceModal.action === 'checkout') return null;
                    
                    return (
                    <button
                      key={inst.id}
                      onClick={() => {
                        const actionType = selectPieceModal.action;
                        setSelectPieceModal({ isOpen: false, item: null, instances: [], isLoading: false, action: 'checkout' });
                        
                        if (actionType === 'transfer') {
                          // Transfer mode: add directly to cart
                          setCart(prev => {
                            const idx = prev.findIndex(c => c.instance_barcode === inst.instance_barcode);
                            if (idx >= 0) {
                              showAlertRef.current(`Piece #${inst.instance_barcode} is already in the cart!`, "Already Added");
                              return prev;
                            }
                            return [...prev, { ...selectPieceModal.item, id: generateId(), instance_barcode: inst.instance_barcode, quantity: 1, unit: selectPieceModal.item.unit, length: '', width: '', default_length: selectPieceModal.item.default_length, default_width: selectPieceModal.item.default_width, pieceLength: inst.current_length }];
                          });
                          setManualBarcode('');
                        } else {
                          // Checkout mode: proceed to cutting
                          setCutLengthModal({ isOpen: true, item: selectPieceModal.item, instance: { ...inst, current_length: availableLength }, cutQty: '', discardScrap: false });
                        }
                      }}
                      className="p-3 text-left border border-[var(--border-medium)] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors flex justify-between items-center focus:outline-none rounded-md focus:border-[var(--color-accent)]"
                    >
                      <span className="font-mono text-xs font-bold" style={{ color: 'var(--color-accent)' }}>#{inst.instance_barcode}</span>
                      <span className="text-sm font-bold text-[var(--text-primary)]">{availableLength} {selectPieceModal.item?.unit} left</span>
                    </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Receive Length Modal */}
      {receiveLengthModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-sm flex flex-col shadow-2xl" style={{ backgroundColor: 'var(--bg-primary)', borderTop: '4px solid var(--color-accent)' }}>
            <div className="flex justify-between items-center p-4" style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-medium)' }}>
              <h3 className="font-bold tracking-wider text-sm" style={{ color: 'var(--text-primary)' }}>ENTER PIECE LENGTH</h3>
              <button type="button" onClick={() => setReceiveLengthModal({ isOpen: false, item: null, length: '' })} className="px-3 py-1.5 leading-none focus:outline-none rounded-md text-lg">✕</button>
            </div>
            <form onSubmit={handleReceiveLengthSubmit} className="p-6">
              <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>What is the standard length of each <strong>{receiveLengthModal.item?.name}</strong> piece?</p>
              <div className="mb-6">
                <input type="number" autoFocus step="any" min="0.1" value={receiveLengthModal.length} onChange={e => setReceiveLengthModal({ ...receiveLengthModal, length: e.target.value })} placeholder={`Length (${receiveLengthModal.item?.unit})`} className="w-full h-12 px-4 text-xl font-mono focus:outline-none rounded-md" style={{ border: '2px solid var(--color-accent)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
              </div>
              <div className="flex justify-end gap-3">
                <button type="submit" disabled={!receiveLengthModal.length} className="h-9 px-8 text-white text-sm font-semibold focus:outline-none rounded-md disabled:opacity-50 transition-colors hover:brightness-110" style={{ backgroundColor: 'var(--color-accent)' }}>Add to Cart</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cut Length Modal */}
      {cutLengthModal.isOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-[150] px-4 animate-fade-in" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="w-[85%] max-w-[400px] flex flex-col rounded-xl overflow-hidden animate-scale-in border border-[var(--border-light)] shadow-2xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div className="flex justify-between items-center pr-1 pl-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Cut Length</span>
              <button type="button" onClick={() => setCutLengthModal({ isOpen: false, item: null, instance: null, cutQty: '', discardScrap: false })} className="px-3 py-1.5 leading-none focus:outline-none rounded-md text-lg">✕</button>
            </div>

            <form onSubmit={handleCutLengthSubmit}>
              <div className="p-6">
                <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>How much of <strong style={{ color: 'var(--color-accent)' }}>{cutLengthModal.item?.name}</strong> are you cutting from piece <strong className="font-mono text-[var(--text-primary)]">#{cutLengthModal.instance?.instance_barcode.includes('-') ? cutLengthModal.instance?.instance_barcode.split('-')[1] : cutLengthModal.instance?.instance_barcode.slice(-6)}</strong>?</p>

                <p className="text-xs font-bold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Current Piece: {cutLengthModal.instance?.current_length} {cutLengthModal.item?.unit === 'SQFT' ? 'ft' : cutLengthModal.item?.unit}</p>

                <div className="relative mb-4">
                  <input type="number" autoFocus step="0.01" min="0.01" value={cutLengthModal.cutQty} onChange={e => {
                    const val = e.target.value;
                    const numVal = Math.round((Number(val) || 0) * 100) / 100;
                    const max = Number(cutLengthModal.instance?.current_length);
                    const isSmallScrap = !isNaN(numVal) && !isNaN(max) && (max - numVal < 1) && (max - numVal > 0);
                    setCutLengthModal({ ...cutLengthModal, cutQty: val, discardScrap: isSmallScrap });
                  }} className="w-full h-12 px-4 text-2xl font-mono focus:outline-none rounded-md" style={{ border: '2px solid var(--color-accent)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} placeholder="0" />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold uppercase" style={{ color: 'var(--text-tertiary)' }}>{cutLengthModal.item?.unit === 'SQFT' ? 'ft' : cutLengthModal.item?.unit}</span>
                </div>

                {cutLengthModal.instance?.current_length !== '?' && Number(cutLengthModal.instance?.current_length) - Number(cutLengthModal.cutQty) < 1 && Number(cutLengthModal.instance?.current_length) - Number(cutLengthModal.cutQty) > 0 && (
                  <label className="flex items-center gap-3 p-3 border cursor-pointer mt-4" style={{ borderColor: 'var(--color-warning)', backgroundColor: 'var(--bg-tertiary)' }}>
                    <input type="checkbox" checked={cutLengthModal.discardScrap} onChange={e => setCutLengthModal({ ...cutLengthModal, discardScrap: e.target.checked })} className="w-5 h-5 cursor-pointer accent-[var(--color-warning)]" />
                    <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>Only {(Number(cutLengthModal.instance?.current_length) - Number(cutLengthModal.cutQty)).toFixed(2)} {cutLengthModal.item?.unit === 'SQFT' ? 'ft' : cutLengthModal.item?.unit} left. Discard remaining scrap?</span>
                  </label>
                )}
              </div>
              <div className="p-4 flex justify-end gap-2" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
                <button type="submit" disabled={!cutLengthModal.cutQty} className="h-9 px-8 text-white text-sm font-semibold focus:outline-none rounded-md disabled:opacity-50" style={{ backgroundColor: 'var(--color-accent)' }}>Add Cut</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isMobileScannerTab ? (
        <div className="flex flex-col flex-1 bg-[var(--bg-primary)] overflow-hidden" style={{ minHeight: 'calc(100vh - 160px)' }}>
          {cart.length > 0 && (
            <div className="p-4 flex-shrink-0 flex gap-2" style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-medium)' }}>
              <button onClick={() => showConfirm("Clear?", handleCancelSale, 'Clear')} className="w-1/3 py-4 text-white font-black uppercase tracking-widest text-lg shadow-lg rounded-lg transition-all active:scale-95" style={{ backgroundColor: 'var(--color-error)' }}>CLEAR</button>
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
              <div className="h-full flex flex-col items-center justify-center text-center p-6">
                <svg className="w-20 h-20 mb-6 opacity-30" fill="currentColor" viewBox="0 0 20 20" style={{ color: 'var(--text-secondary)' }}><path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" /></svg>
                <p className="text-xl font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>List is Empty</p>
                <p className="text-base mt-2 font-medium" style={{ color: 'var(--text-tertiary)' }}>Tap the green button below to start.</p>
              </div>
            ) : (
              <CartMobileView
                cart={cart}
                activeTab={activeTab}
                onUpdateQuantity={updateQuantity}
                onUpdateDimensions={updateDimensions}
                onRemoveItem={handleRemoveItem}
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
        <div className="flex flex-col flex-1 min-h-[500px] shadow-sm print:hidden" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
          {/* Header Block */}
          {activeTab === 'checkout' && (pendingCarts.length > 0 || heldCarts.length > 0) && (
          <div className="flex gap-1 p-2 bg-[var(--bg-tertiary)] border-b border-[var(--border-medium)] overflow-x-auto whitespace-nowrap scrollbar-hide">
            <button 
              onClick={() => switchCartTab('local')}
              className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm transition-colors"
              style={{
                backgroundColor: activeCartTab === 'local' ? 'var(--color-accent)' : 'var(--bg-primary)',
                color: activeCartTab === 'local' ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${activeCartTab === 'local' ? 'var(--color-accent)' : 'var(--border-medium)'}`
              }}
            >
              Local Cart
            </button>
            {heldCarts.map(hc => (
              <button 
                key={hc.id}
                onClick={() => switchCartTab(hc.id)}
                className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm transition-colors flex gap-2 items-center"
                style={{
                  backgroundColor: activeCartTab === hc.id ? 'var(--color-accent)' : 'var(--bg-primary)',
                  color: activeCartTab === hc.id ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${activeCartTab === hc.id ? 'var(--color-accent)' : 'var(--border-medium)'}`
                }}
              >
                {hc.name}
                <span className="bg-white/20 px-1.5 rounded-full text-[10px]">{hc.items?.length || 0}</span>
              </button>
            ))}
            {pendingCarts.map(pc => (
              <button 
                key={pc.id}
                onClick={() => switchCartTab(pc.id, pc.items)}
                className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm transition-colors flex gap-2 items-center"
                style={{
                  backgroundColor: activeCartTab === pc.id ? 'var(--color-accent)' : 'var(--bg-primary)',
                  color: activeCartTab === pc.id ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${activeCartTab === pc.id ? 'var(--color-accent)' : 'var(--border-medium)'}`
                }}
              >
                {pc.worker_name}'s Cart
                <span className="bg-white/20 px-1.5 rounded-full text-[10px]">{pc.items?.length || 0}</span>
              </button>
            ))}
          </div>
        )}
        <div className={`p-4 flex flex-col md:flex-row justify-between gap-4 ${(activeTab === 'receive' || activeTab === 'transfer') ? 'hidden md:flex' : ''} ${activeTab === 'receive' ? 'pos-receive-bg' : activeTab === 'transfer' ? 'pos-transfer-bg' : ''}`} style={{ borderBottom: '1px solid var(--border-medium)', ...(activeTab !== 'receive' && activeTab !== 'transfer' ? { backgroundColor: 'var(--bg-tertiary)' } : {}) }}>
          <div className="flex flex-col w-full md:w-auto flex-1 md:flex-none">
            <h2 className="text-2xl font-medium" style={{ color: 'var(--text-primary)' }}>
              {activeTab === 'receive' ? 'Receive New Stock' : activeTab === 'transfer' ? 'Move Stock to Store' : 'Checkout Counter'}
            </h2>
            
            <form onSubmit={(e) => { e.preventDefault(); processScan(manualBarcode); setManualBarcode(''); setShowSuggestions(false); }} className="mt-3 relative w-full md:w-auto">
              <div className="flex items-center w-full md:w-72 h-10 md:h-9 rounded-md overflow-hidden transition-colors focus-within:border-[var(--color-accent)] focus-within:ring-1 focus-within:ring-[var(--color-accent)]" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)' }}>
                <label htmlFor="manual-barcode" className="sr-only">Barcode</label>
                <input id="manual-barcode" type="text" value={manualBarcode} onChange={(e) => setManualBarcode(e.target.value)} onFocus={() => manualBarcode.trim().length >= 2 && setShowSuggestions(true)} onBlur={() => setTimeout(() => setShowSuggestions(false), 200)} placeholder="Search barcode or name..." className="h-full w-full px-3 text-sm focus:outline-none flex-1 bg-transparent border-none outline-none rounded-none focus:ring-0 focus:border-transparent focus:shadow-none" style={{ color: 'var(--text-input)', outline: 'none', border: 'none', boxShadow: 'none' }} autoComplete="off" />
                <button type="submit" className="h-full px-4 text-sm font-bold focus:outline-none transition-colors border-none rounded-none bg-transparent hover:bg-white/5 focus:ring-0 focus:outline-none" style={{ color: 'var(--color-accent)', outline: 'none', border: 'none' }}>ADD</button>
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
                        <span className="text-[10px] font-mono whitespace-nowrap self-center px-1.5 py-0.5 rounded-sm" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--color-accent)' }}>#{item.barcode}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </form>
          </div>
          <div className="text-left md:text-right flex flex-col justify-end pt-2 md:pt-0" style={{ borderTop: window.innerWidth < 768 ? `1px solid var(--border-light)` : 'none' }}>
            <span className="text-xs uppercase font-semibold tracking-wider block mb-1" style={{ color: 'var(--text-tertiary)' }}>{activeTab === 'checkout' ? 'Total Price' : 'Total Units'}</span>
            <span className="text-4xl font-light" style={{ color: 'var(--color-accent)' }} aria-live="polite">
              {activeTab === 'checkout' ? `₹${cartTotal.toFixed(2)}` : cartUnits}
            </span>
          </div>
        </div>

        {/* Desktop View */}
        <div className="hidden md:block flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <CartTable
            cart={cart}
            activeTab={activeTab}
            onUpdateQuantity={updateQuantity}
            onUpdateDimensions={updateDimensions}
            onCustomPriceChange={handleCustomPriceChange}
            onCustomPriceBlur={applyCustomPriceBlur}
            onCustomPriceChangeGroup={handleCustomPriceChangeGroup}
            onCustomPriceBlurGroup={handleCustomPriceBlurGroup}
            onRemoveItem={handleRemoveItem}
          />
        </div>

        {/* Mobile View for Checkout */}
        <div className="md:hidden flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-medium)' }}>
          <CartMobileView
            cart={cart}
            activeTab={activeTab}
            onUpdateQuantity={updateQuantity}
            onUpdateDimensions={updateDimensions}
            onRemoveItem={handleRemoveItem}
          />
        </div>

        {cart.length > 0 && (
          <div className="p-4 flex flex-col md:flex-row justify-between gap-3" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <div className="flex w-full md:w-auto gap-3">
              <button
                onClick={() => showConfirm("Are you sure you want to clear the items?", handleCancelSale, activeTab === 'checkout' ? 'Cancel Sale' : 'Clear Items')}
                className="flex-1 md:flex-none h-10 px-6 text-sm font-semibold uppercase tracking-wider focus:outline-none rounded-md"
                style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
              >
                {activeTab === 'checkout' ? 'Cancel Sale' : 'Clear Items'}
              </button>
              {activeTab === 'checkout' && activeCartTab === 'local' && (
                <button
                  onClick={handleHoldCart}
                  className="flex-1 md:flex-none h-10 px-6 text-sm font-semibold uppercase tracking-wider focus:outline-none rounded-md"
                  style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)' }}
                >
                  Hold Cart
                </button>
              )}
            </div>
            <button
              onClick={() => activeTab === 'checkout' ? setCheckoutModal({ isOpen: true, cashGiven: '' }) : handleCompleteTransaction()}
              className="w-full md:w-auto h-10 px-10 text-white text-sm font-semibold uppercase tracking-wider focus:outline-none rounded-md focus:ring-2 focus:ring-offset-1 flex justify-center items-center"
              style={{ backgroundColor: 'var(--color-accent)', border: '1px solid transparent' }}
            >
              {isCheckingOut ? 'Saving...' : 'Complete'}
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
      >
        <ReceiptTemplate lastReceipt={lastReceipt} shopSettings={shopSettings} formatDateTime={formatDateTime} isPreview={true} />
      </PrintPreviewModal>
    </>
  );
}