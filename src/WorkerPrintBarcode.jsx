import { useState, useEffect, useMemo, useRef } from 'react';
import Barcode from 'react-barcode';
import { Search, Printer, X, Check, Layers } from 'lucide-react';
import { getInventoryByQuery } from './services/db';
import { useApp } from './AppContext';
import { debounce, formatINR } from './utils';
import BarcodeLabelSheet, { MAX_LABELS_PER_PRINT, clampLabelQty } from './components/print/BarcodeLabelSheet';
import { logActivity } from './services/auditLog';
import { buttonClass } from './components/ui';

export default function WorkerPrintBarcode() {
  const { showAlert } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [labelQty, setLabelQty] = useState(10);
  const [isPrinting, setIsPrinting] = useState(false);

  const searchInputRef = useRef(null);

  // Focus search input on mount and handle '/' hotkey
  useEffect(() => {
    searchInputRef.current?.focus();

    const handleKeyDown = (e) => {
      const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
      if (!isInput && e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Debounced search updater
  const debouncedSet = useMemo(
    () => debounce((val) => setDebouncedSearch(val), 200),
    []
  );

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchTerm(val);
    debouncedSet(val);
  };

  const handleClearSearch = () => {
    setSearchTerm('');
    setDebouncedSearch('');
    setProducts([]);
    searchInputRef.current?.focus();
  };

  // Fetch products from local IndexedDB whenever search query changes
  useEffect(() => {
    let isCancelled = false;
    const query = debouncedSearch.trim();

    // Items show up ONLY after user searches
    if (!query) {
      setProducts([]);
      setIsLoading(false);
      return;
    }

    const fetchItems = async () => {
      setIsLoading(true);
      try {
        const res = await getInventoryByQuery({
          search: query,
          limit: 50,
          offset: 0,
          status: 'active'
        });
        if (!isCancelled) {
          const items = res?.data || res?.items || [];
          setProducts(items);
        }
      } catch (err) {
        console.warn('Failed to fetch products for print barcode:', err);
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };

    fetchItems();
    return () => {
      isCancelled = true;
    };
  }, [debouncedSearch]);

  const handleSelectProduct = (prod) => {
    setSelectedProduct(prod);
    const batches = (prod.batches || []).filter(b => b.is_active !== false);
    if (batches.length > 0) {
      // Pick first active batch
      setSelectedBatch(batches[0]);
    } else {
      // Fallback synthetic batch if legacy item without batches array
      setSelectedBatch({
        batch_number: 1,
        selling_price: prod.price || 0,
        stock_store: prod.stock_store || 0
      });
    }
  };

  // Label configuration
  const activeBatches = useMemo(() => {
    if (!selectedProduct) return [];
    const list = (selectedProduct.batches || []).filter(b => b.is_active !== false);
    if (list.length > 0) return list;
    return [{
      batch_number: 1,
      selling_price: selectedProduct.price || 0,
      stock_store: selectedProduct.stock_store || 0
    }];
  }, [selectedProduct]);

  const batchNumberStr = selectedBatch
    ? String(selectedBatch.batch_number || 1).padStart(2, '0')
    : '01';

  const barcodeValue = selectedProduct
    ? `${selectedProduct.barcode}-${batchNumberStr}`
    : '';

  const activeSellingPrice = Number(
    selectedBatch?.selling_price ?? selectedProduct?.price ?? 0
  ).toFixed(2);

  const handlePrint = () => {
    if (!selectedProduct || !selectedBatch) {
      showAlert('Please select a product and batch before printing.', 'Warning');
      return;
    }
    const count = Number(labelQty);
    if (!count || count <= 0) {
      showAlert('Please enter a valid quantity of labels to print.', 'Warning');
      return;
    }

    setIsPrinting(true);
    logActivity({
      action: 'PRINT',
      barcode: selectedProduct.barcode,
      itemName: selectedProduct.name,
      changes: `Printed ${count} barcode label${count === 1 ? '' : 's'} (Batch ${String(selectedBatch.batch_number || 1).padStart(2, '0')}, ₹${activeSellingPrice})`,
    });
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
    }, 350);
  };

  const presetCounts = [1, 5, 10, 20, 50, 100];

  return (
    <div className="h-full flex flex-col flex-1 min-h-0 relative select-none">
      {/* SECTION HEADER */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-[var(--border-light)] shrink-0">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
            <Printer className="w-5 h-5 text-[var(--color-accent)]" />
            <span>Print Barcodes</span>
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Search product directory, select batch, and print thermal barcode labels.
          </p>
        </div>
      </div>

      {/* TWO-COLUMN WORKSPACE */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-0 overflow-hidden">
        {/* LEFT PANEL: PRODUCT SEARCH & DIRECTORY */}
        <div className="lg:col-span-5 flex flex-col min-h-0 rounded-xl border border-[var(--border-light)] bg-[var(--bg-secondary)] overflow-hidden">
          {/* Search Bar */}
          <div className="p-3 border-b border-[var(--border-light)] bg-[var(--bg-tertiary)] shrink-0">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-[var(--text-tertiary)] absolute left-3 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={handleSearchChange}
                placeholder="Search barcode or name..."
                className="w-full h-10 text-xs sm:text-sm rounded-lg focus:outline-none focus:border-[var(--color-accent)] transition-all font-medium shadow-xs"
                style={{
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-input, var(--text-primary))',
                  paddingLeft: '2.5rem',
                  paddingRight: '2.5rem'
                }}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="tap-area absolute right-2 p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded-full hover:bg-[var(--bg-hover)]"
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Product Directory List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
            {!debouncedSearch.trim() ? (
              <div className="flex flex-col items-center justify-center h-48 text-center p-4 text-[var(--text-tertiary)]">
                <Search className="w-7 h-7 mb-2 opacity-30" />
                <p className="text-xs font-semibold text-[var(--text-secondary)]">Search product directory</p>
                <p className="text-xs mt-0.5">Type barcode or product name to find items</p>
              </div>
            ) : isLoading && products.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-xs text-[var(--text-secondary)]">
                Searching products...
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center p-4 text-[var(--text-tertiary)]">
                <p className="text-xs font-semibold text-[var(--text-secondary)]">No products found</p>
                <p className="text-xs mt-0.5">Try searching with a different name or barcode.</p>
              </div>
            ) : (
              products.map((prod) => {
                const isSelected = selectedProduct?.barcode === prod.barcode;
                const bCount = (prod.batches || []).filter(b => b.is_active !== false).length;
                const firstPrice = prod.batches?.[0]?.selling_price ?? prod.price ?? 0;

                return (
                  <button
                    key={`${prod.shop_id || 'default'}-${prod.barcode}`}
                    type="button"
                    onClick={() => handleSelectProduct(prod)}
                    className={`w-full text-left p-2.5 rounded-lg border transition-all flex items-center justify-between gap-2 cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--color-accent-solid)]/10 border-[var(--color-accent)] shadow-sm'
                        : 'bg-[var(--bg-primary)] border-[var(--border-light)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-xs font-bold text-[var(--color-accent)] bg-[var(--color-accent-solid)]/10 px-1.5 py-0.5 rounded border border-[var(--color-accent)]/20">
                          #{prod.barcode}
                        </span>
                        <span title={String(prod.name ?? '')} className="font-semibold text-xs sm:text-sm text-[var(--text-primary)] truncate">
                          {prod.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-[var(--text-secondary)]">
                        <span className="truncate">{prod.category || 'General'}</span>
                        <span>•</span>
                        <span>{bCount > 0 ? `${bCount} ${bCount === 1 ? 'batch' : 'batches'}` : '1 batch'}</span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-bold text-xs sm:text-sm text-[var(--text-primary)] tabular-nums">
                        ₹{formatINR(Number(firstPrice), 2)}
                      </div>
                      {isSelected && (
                        <div className="mt-1 flex justify-end">
                          <span className="w-4 h-4 rounded-full bg-[var(--color-accent-solid)] text-white flex items-center justify-center">
                            <Check className="w-2.5 h-2.5" strokeWidth={3} />
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT PANEL: BATCH SELECTION, QUANTITY, PREVIEW & PRINT */}
        <div className={`lg:col-span-7 flex flex-col min-h-0 rounded-xl border border-[var(--border-light)] bg-[var(--bg-secondary)] overflow-y-auto p-4 sm:p-5 ${selectedProduct ? '' : 'max-lg:hidden'}`}>
          {!selectedProduct ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8 text-[var(--text-tertiary)]">
              <Printer className="w-10 h-10 mb-2.5 opacity-30 text-[var(--color-accent)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Select a Product</h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xs">
                Search and select a product to configure and print barcode labels.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4 h-full">
              {/* Product Header */}
              <div className="pb-3 border-b border-[var(--border-light)] flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-[var(--color-accent-solid)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20">
                      #{selectedProduct.barcode}
                    </span>
                    <span className="text-xs text-[var(--text-secondary)] truncate">
                      {selectedProduct.category || 'General'}
                    </span>
                    {activeBatches.length === 1 && (
                      <span className="text-xs text-[var(--text-tertiary)]">
                        &bull; Batch #{String(activeBatches[0].batch_number || 1).padStart(2, '0')}
                      </span>
                    )}
                  </div>
                  <h2 title={String(selectedProduct.name ?? '')} className="text-base font-semibold text-[var(--text-primary)] truncate mt-1">
                    {selectedProduct.name}
                  </h2>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] block">
                    MRP
                  </span>
                  <span className="text-base font-bold text-[var(--text-primary)] tabular-nums">
                    ₹{formatINR(activeSellingPrice, 2)}
                  </span>
                </div>
              </div>

              {/* Multiple Batches Selector (only if 2 or more batches exist) */}
              {activeBatches.length > 1 && (
                <div className="pb-3 border-b border-[var(--border-light)]">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] block mb-2">
                    Choose Batch
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {activeBatches.map((b, idx) => {
                      const bNum = String(b.batch_number || idx + 1).padStart(2, '0');
                      const isBSelected = selectedBatch?.batch_number === b.batch_number;

                      return (
                        <button
                          key={b.batch_id || idx}
                          type="button"
                          onClick={() => setSelectedBatch(b)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                            isBSelected
                              ? 'bg-[var(--color-accent-solid)] text-white border-[var(--color-accent)]'
                              : 'bg-[var(--bg-tertiary)] border-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                          }`}
                        >
                          Batch #{bNum} &bull; ₹{formatINR(Number(b.selling_price ?? selectedProduct.price ?? 0), 2)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Number of Labels: Uniform height (h-8), aligned controls */}
              <div className="pb-3 border-b border-[var(--border-light)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Number of Labels
                </label>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    {presetCounts.map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() => setLabelQty(count)}
                        className={`h-8 px-2.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          labelQty === count
                            ? 'bg-[var(--color-accent-solid)] text-white border-[var(--color-accent)]'
                            : 'bg-[var(--bg-tertiary)] border-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                        }`}
                      >
                        {count}
                      </button>
                    ))}
                  </div>

                  <div className="inline-flex items-center h-8 border border-[var(--border-medium)] rounded-lg bg-[var(--bg-tertiary)] overflow-hidden shadow-xs">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setLabelQty(q => Math.max(1, q - 1))}
                      className="w-8 h-full flex items-center justify-center text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-secondary)] transition-colors border-r border-[var(--border-medium)] select-none cursor-pointer"
                      style={{ borderRadius: 0 }}
                      aria-label="Decrease quantity" title="Decrease quantity"
                    >
                      -
                    </button>
                    <input
                      type="number" inputMode="decimal"
                      min="1"
                      max={MAX_LABELS_PER_PRINT}
                      value={labelQty}
                      onChange={(e) => setLabelQty(clampLabelQty(e.target.value))}
                      className="compact-field w-12 h-full text-center text-xs font-bold bg-transparent text-[var(--text-primary)] rounded-none !border-none !shadow-none !outline-none focus:!outline-none focus:!border-none focus:!shadow-none focus:bg-[var(--bg-secondary)] transition-colors p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      style={{ borderRadius: 0, border: 'none', boxShadow: 'none', outline: 'none' }}
                      aria-label="Quantity of labels"
                    />
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setLabelQty(q => clampLabelQty(q + 1))}
                      className="w-8 h-full flex items-center justify-center text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-secondary)] transition-colors border-l border-[var(--border-medium)] select-none cursor-pointer"
                      style={{ borderRadius: 0 }}
                      aria-label="Increase quantity" title="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              {/* Thermal Label Visual Preview (Clean sticker, no outer dark box) */}
              <div className="flex flex-col items-center justify-center py-6 flex-1 min-h-[220px]">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-3">
                  Thermal Label Preview (50mm &times; 25mm)
                </span>
                <div
                  className="bg-white border border-gray-300 rounded-lg shadow-md p-3.5 flex flex-col items-center justify-between select-none max-w-full"
                  style={{ width: '340px', height: '170px' }}
                >
                  <div title={String(selectedProduct.name ?? '')} className="text-xs sm:text-sm font-bold text-black text-center truncate w-full px-2">
                    {selectedProduct.name}
                  </div>
                  <div className="my-auto flex items-center justify-center w-full">
                    <Barcode
                      value={barcodeValue}
                      width={1.8}
                      height={48}
                      fontSize={13}
                      margin={0}
                      displayValue={true}
                      lineColor="#000000"
                      background="#ffffff"
                    />
                  </div>
                  <div className="text-xs sm:text-sm font-bold text-black tracking-wide">
                    MRP: ₹{formatINR(activeSellingPrice, 2)}
                  </div>
                </div>
              </div>

              {/* Print Action Button */}
              <div className="mt-auto pt-3 border-t border-[var(--border-light)]">
                <button
                  type="button"
                  onClick={handlePrint}
                  disabled={isPrinting}
                  className={buttonClass({ variant: 'primary', size: 'md', className: 'w-full' })}
                >
                  <Printer className="w-4 h-4" />
                  <span>
                    {isPrinting ? 'Printing Labels...' : `Print ${labelQty} ${labelQty === 1 ? 'Barcode Label' : 'Barcode Labels'}`}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Hidden Portal Container for Direct Thermal Printing */}
      {isPrinting && selectedProduct && selectedBatch && (
        <BarcodeLabelSheet
          name={selectedProduct.name}
          barcodeValue={barcodeValue}
          mrp={activeSellingPrice}
          count={labelQty}
        />
      )}
    </div>
  );
}

