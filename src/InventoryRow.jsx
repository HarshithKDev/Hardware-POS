import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';

export default function InventoryRow({ 
  item, 
  viewType, 
  categories, 
  subcategories, 
  isGlobalEditMode, 
  editData, 
  onEditChange, 
  isSelected, 
  onSelect, 
  onRestore, 
  isSelectionMode, 
  onOpenBatchDetails 
}) {
  const { isWarehouseDisabled } = useApp();
  const shopId = item.shop_id || localStorage.getItem('shop_id');
  const { data: pieceCounts } = useQuery({
    queryKey: ['piece_counts', shopId, item.barcode],
    queryFn: async () => {
      let query = supabase
        .from('stock_instances')
        .select('location, batch_id')
        .eq('parent_barcode', String(item.barcode))
        .eq('is_active', true)
        .gt('current_length', 0);
      if (shopId) {
        query = query.eq('shop_id', shopId);
      }
      const { data, error } = await query;
        
      if (error) {
        console.error("Piece counts error for", item.barcode, error);
        throw error;
      }
      
      const counts = { warehouse: 0, store: 0, byBatch: {} };
      data?.forEach(instance => {
        const loc = (instance.location || 'store').toLowerCase();
        if (loc === 'warehouse') counts.warehouse++;
        else counts.store++;
        
        if (instance.batch_id) {
          if (!counts.byBatch[instance.batch_id]) counts.byBatch[instance.batch_id] = { warehouse: 0, store: 0 };
          if (loc === 'warehouse') counts.byBatch[instance.batch_id].warehouse++;
          else counts.byBatch[instance.batch_id].store++;
        }
      });
      
      return counts;
    },
    enabled: !!item.is_cuttable,
    staleTime: 30 * 1000,
  });

  const displayUnit = (item.unit?.toLowerCase() === 'kg' || item.unit?.toLowerCase() === 'grams') ? 'kg' : item.unit?.toLowerCase() === 'meter' ? 'm' : item.unit?.toLowerCase() === 'sqft' ? 'ft' : (item.unit || '');
  const availableSubcategories = subcategories?.filter(sub => sub.category_name === (editData?.category || item.category)) || [];
  const activeBatches = useMemo(() => {
    const seenIds = new Set();
    return (item.batches || [])
      .filter(b => {
        if (b.is_active === false) return false;
        if (b.batch_id) {
          if (seenIds.has(b.batch_id)) return false;
          seenIds.add(b.batch_id);
        }
        return true;
      })
      .sort((a, b) => (a.batch_number || 1) - (b.batch_number || 1));
  }, [item.batches]);

  const totalWhse = activeBatches.length > 0 
    ? activeBatches.reduce((sum, b) => sum + Number(b.stock_warehouse || 0), 0) 
    : Number(item.stock_warehouse || 0);
  const totalStore = isWarehouseDisabled
    ? (activeBatches.length > 0 ? activeBatches.reduce((sum, b) => sum + Number(b.stock_store || 0) + Number(b.stock_warehouse || 0), 0) : (Number(item.stock_store || 0) + Number(item.stock_warehouse || 0)))
    : (activeBatches.length > 0 ? activeBatches.reduce((sum, b) => sum + Number(b.stock_store || 0), 0) : Number(item.stock_store || 0));

  const [popoverPos, setPopoverPos] = useState(null);
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef(null);
  const closeTimeoutRef = useRef(null);
  const tooltipRef = useRef(null);

  const handleMouseEnter = useCallback((e) => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);

    // Notify any other open tooltip to close immediately
    window.dispatchEvent(new CustomEvent('closeBatchTooltip', { detail: item.barcode }));

    const buttonEl = e.currentTarget;

    hoverTimeoutRef.current = setTimeout(() => {
      if (!buttonEl) return;
      const rect = buttonEl.getBoundingClientRect();
      
      const tooltipWidth = 320;
      const buttonCenterX = rect.left + rect.width / 2;
      let finalLeft = Math.round(buttonCenterX - tooltipWidth / 2);
      if (finalLeft < 16) {
        finalLeft = 16;
      } else if (finalLeft + tooltipWidth > window.innerWidth - 16) {
        finalLeft = window.innerWidth - 16 - tooltipWidth;
      }

      const batchCount = Math.max(1, activeBatches.length);
      // Base: header ~58px, padding/borders ~30px -> ~88px + 52px per batch item
      const neededHeight = Math.min(480, 88 + batchCount * 52);

      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

      // "See first and then open":
      // If lower screen space is less than 320px and upper space has room, ALWAYS open on TOP!
      // Or if space below is less than needed height + 40px buffer, open on TOP!
      const showAbove = (spaceBelow < 320 && spaceAbove > 160) || 
                        (spaceBelow < (neededHeight + 40) && spaceAbove > spaceBelow);

      const availableSpace = showAbove ? (spaceAbove - 16) : (spaceBelow - 16);
      const maxListHeight = Math.max(120, Math.min(460, availableSpace - 88));

      setPopoverPos({
        top: Math.round(showAbove ? rect.top : rect.bottom),
        left: finalLeft,
        showAbove,
        maxListHeight
      });
      setIsHovered(true);
    }, 60);
  }, [activeBatches.length, item.barcode]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 200);
  }, []);

  const handleTooltipMouseEnter = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const handleTooltipMouseLeave = useCallback(() => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 200);
  }, []);

  useEffect(() => {
    const handleOtherHover = (e) => {
      if (e.detail !== item.barcode) {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
        setIsHovered(false);
      }
    };
    window.addEventListener('closeBatchTooltip', handleOtherHover);
    return () => {
      window.removeEventListener('closeBatchTooltip', handleOtherHover);
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, [item.barcode]);

  useEffect(() => {
    if (!isHovered) return;
    const startScrollY = window.scrollY;
    const startScrollX = window.scrollX;
    const mountTime = Date.now();

    const handleScrollOrResize = (e) => {
      if (e && e.target && tooltipRef.current && tooltipRef.current.contains(e.target)) {
        return;
      }
      // Ignore residual inertia micro-scrolls in the first 150ms after opening
      if (Date.now() - mountTime < 150) {
        return;
      }
      const dy = Math.abs(window.scrollY - startScrollY);
      const dx = Math.abs(window.scrollX - startScrollX);
      if (e.type === 'scroll' && dy < 20 && dx < 20) {
        return;
      }
      setIsHovered(false);
    };
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isHovered]);

  const renderBatchTooltip = () => {
    if (!isHovered || !popoverPos) return null;

    return createPortal(
      <div
        ref={tooltipRef}
        onMouseEnter={handleTooltipMouseEnter}
        onMouseLeave={handleTooltipMouseLeave}
        className={`fixed z-[99999] pointer-events-auto animate-tooltip-fade ${popoverPos.showAbove ? 'pb-2' : 'pt-2'}`}
        style={{
          top: `${popoverPos.top}px`,
          left: `${popoverPos.left}px`,
          width: '320px',
          transform: popoverPos.showAbove ? 'translateY(-100%)' : 'none',
        }}
      >
        <div
          className="rounded-lg p-3 w-full text-left border relative"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            borderColor: 'var(--border-medium)',
            boxShadow: '0 12px 36px -4px rgba(0, 0, 0, 0.7), 0 4px 12px rgba(0, 0, 0, 0.4)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--border-light)]">
            <div className="min-w-0 pr-2">
              <span className="text-xs font-bold text-[var(--text-primary)] block truncate" title={item.name}>
                {item.name}
              </span>
              <div className="text-[11px] text-[var(--text-secondary)] font-medium mt-0.5">
                Barcode: <span className="font-semibold text-[var(--color-accent)] tracking-wider">{item.barcode}</span>
              </div>
            </div>
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase shrink-0"
              style={{
                backgroundColor: item.is_cuttable ? 'var(--color-accent-bg)' : 'rgba(16, 185, 129, 0.15)',
                color: item.is_cuttable ? 'var(--color-accent)' : 'var(--color-success)',
                border: `1px solid ${item.is_cuttable ? 'rgba(59, 130, 246, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`
              }}
            >
              {activeBatches.length} {activeBatches.length === 1 ? 'Batch' : 'Batches'}
            </span>
          </div>

          {/* Batches & MRP List */}
          {activeBatches.length === 0 ? (
            <div className="py-2.5 text-center">
              <div className="text-xs text-[var(--text-tertiary)]">No batches initialized yet</div>
              <div className="text-xs mt-1 font-medium text-[var(--text-secondary)]">
                Default MRP: <span className="font-bold text-[var(--color-success)]">₹{Number(item.price || 0).toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <div
              className="flex flex-col gap-1.5 overflow-y-auto pr-1 custom-scrollbar"
              style={{
                maxHeight: popoverPos.maxListHeight ? `${popoverPos.maxListHeight}px` : '420px'
              }}
            >
              {(() => {
                const seenBatchNums = new Set();
                return activeBatches.map((b, idx) => {
                  let bNum = b.batch_number;
                  if (!bNum || seenBatchNums.has(bNum)) {
                    bNum = idx + 1;
                    while (seenBatchNums.has(bNum)) bNum++;
                  }
                  seenBatchNums.add(bNum);
                  const bCode = `${item.barcode}-${String(bNum).padStart(2, '0')}`;
                  const mrpVal = Number(b.selling_price !== undefined && b.selling_price !== null ? b.selling_price : (item.price || 0));
                  const whseQty = Number(b.stock_warehouse || 0);
                  const storeQty = Number(b.stock_store || 0);

                  return (
                    <div
                      key={b.batch_id || `${bCode}-${idx}`}
                      className="p-2 rounded flex items-center justify-between gap-2.5 transition-colors hover:brightness-105"
                      style={{
                        backgroundColor: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-light)'
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-[var(--text-primary)]">
                            Batch #{bNum}
                          </span>
                          <span className="text-[11px] font-semibold text-[var(--text-secondary)] tracking-wide">
                            ({bCode})
                          </span>
                        </div>
                        <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                          {!isWarehouseDisabled && (
                            <>
                              Whse: <span className="font-semibold text-[var(--text-primary)]">{whseQty}</span>
                              {' • '}
                            </>
                          )}
                          {isWarehouseDisabled ? 'Stock: ' : 'Store: '}<span className="font-semibold text-[var(--text-primary)]">{storeQty}</span>
                          {displayUnit ? ` ${displayUnit}` : ''}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-[9px] uppercase tracking-wider font-semibold text-[var(--text-tertiary)]">
                          MRP
                        </div>
                        <div className="text-xs font-extrabold text-[var(--color-success)]">
                          ₹{mrpVal.toFixed(2)}
                          {item.is_loose_item && item.unit?.toUpperCase() === 'KG' ? '/kg' : ''}
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>
      </div>,
      document.body
    );
  };

  if (isGlobalEditMode && isSelected && viewType === 'warehouse') {
    const data = editData || item;
    return (
      <>
        {/* MOBILE EDIT CARD LAYOUT */}
        <td className="md:hidden block p-4 text-left w-full border-none">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-bold text-[var(--color-accent)]">#{item.barcode}</span>
            <input type="checkbox" checked={isSelected} onChange={() => onSelect(item.barcode)} className="w-5 h-5 rounded text-accent focus:ring-accent cursor-pointer" />
          </div>
          <div className="flex flex-col gap-2.5">
            <div>
              <label className="text-[10px] uppercase font-bold text-[var(--text-tertiary)] block mb-1">Item Name</label>
              <input type="text" value={data.name || ''} onChange={e=>onEditChange(item.barcode, 'name', e.target.value)} className="h-10 px-3 w-full text-sm rounded-md focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] uppercase font-bold text-[var(--text-tertiary)] block mb-1">Category</label>
                <select value={data.category || ''} onChange={e=>{onEditChange(item.barcode, 'category', e.target.value); onEditChange(item.barcode, 'sub_category', '');}} className="h-10 px-2 w-full text-xs rounded-md focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                  <option value="">None</option>
                  {categories?.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-[var(--text-tertiary)] block mb-1">Subcategory</label>
                <select value={data.sub_category || ''} onChange={e=>onEditChange(item.barcode, 'sub_category', e.target.value)} disabled={!data.category} className="h-10 px-2 w-full text-xs rounded-md focus:outline-none disabled:opacity-50" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                  <option value="">None</option>
                  {availableSubcategories.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className={`grid ${isWarehouseDisabled ? 'grid-cols-1' : 'grid-cols-2'} gap-2`}>
              {!isWarehouseDisabled && (
                <div>
                  <label className="text-[10px] uppercase font-bold text-[var(--text-tertiary)] block mb-1">Warehouse Stock</label>
                  {item.is_cuttable ? (
                    <div className="h-9 px-2 flex items-center justify-center text-xs rounded bg-[var(--bg-secondary)] text-[var(--text-tertiary)] border border-[var(--border-medium)]">
                      {pieceCounts ? pieceCounts.warehouse : '...'} PCS
                    </div>
                  ) : (
                    <input type="number" step="any" min="0" value={data.stock_warehouse ?? ''} onChange={e=>onEditChange(item.barcode, 'stock_warehouse', e.target.value)} className="h-9 px-2 w-full text-xs text-center rounded focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
                  )}
                </div>
              )}
              <div>
                <label className="text-[10px] uppercase font-bold text-[var(--text-tertiary)] block mb-1">{isWarehouseDisabled ? 'Total Stock' : 'Store Stock'}</label>
                {item.is_cuttable ? (
                  <div className="h-9 px-2 flex items-center justify-center text-xs rounded bg-[var(--bg-secondary)] text-[var(--text-tertiary)] border border-[var(--border-medium)]">
                    {pieceCounts ? pieceCounts.store : '...'} PCS
                  </div>
                ) : (
                  <input type="number" step="any" min="0" value={data.stock_store ?? ''} onChange={e=>onEditChange(item.barcode, 'stock_store', e.target.value)} className="h-9 px-2 w-full text-xs text-center rounded focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
                )}
              </div>
            </div>
          </div>
        </td>

        {/* DESKTOP TABLE CELLS */}
        {isSelectionMode && (
          <td className="hidden md:table-cell p-3 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
            <input type="checkbox" checked={isSelected} onChange={() => onSelect(item.barcode)} className="w-4 h-4 rounded text-accent focus:ring-accent" />
          </td>
        )}
        <td className="hidden md:table-cell p-3 text-sm font-semibold tracking-wider text-center" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--color-accent)' }}>{item.barcode}</td>
        <td className="hidden md:table-cell p-1" style={{ borderRight: '1px solid var(--border-medium)' }}>
          <input type="text" value={data.name || ''} onChange={e=>onEditChange(item.barcode, 'name', e.target.value)} className="h-8 px-2 w-full text-sm focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
        </td>
        
        <td className="hidden md:table-cell p-1" style={{ borderRight: '1px solid var(--border-medium)' }}>
          <select value={data.category || ''} onChange={e=>{onEditChange(item.barcode, 'category', e.target.value); onEditChange(item.barcode, 'sub_category', '');}} className="h-auto py-1.5 pl-2 pr-8 w-full text-xs focus:outline-none truncate cursor-pointer rounded-sm" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
            <option value="">None</option>
            {categories?.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </td>

        <td className="hidden md:table-cell p-1" style={{ borderRight: '1px solid var(--border-medium)' }}>
          <select value={data.sub_category || ''} onChange={e=>onEditChange(item.barcode, 'sub_category', e.target.value)} disabled={!data.category} className="h-auto py-1.5 pl-2 pr-8 w-full text-xs focus:outline-none truncate cursor-pointer rounded-sm disabled:opacity-50" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
            <option value="">None</option>
            {availableSubcategories.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </td>

        <td 
          className="hidden md:table-cell p-1 text-center cursor-pointer" 
          style={{ borderRight: '1px solid var(--border-medium)' }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <span className="text-xs text-[var(--text-tertiary)] hover:text-[var(--color-accent)] transition-colors">{activeBatches.length} {activeBatches.length === 1 ? 'Batch' : 'Batches'}</span>
        </td>

        {!isWarehouseDisabled && (
          <td className="hidden md:table-cell p-1" style={{ borderRight: '1px solid var(--border-medium)' }}>
            {item.is_cuttable ? (
              <div className="h-8 px-2 w-full text-sm flex justify-center items-center" title="Cannot edit warehouse aggregate directly" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-tertiary)', cursor: 'not-allowed' }}>
                {pieceCounts ? pieceCounts.warehouse : '...'} <span className="ml-1 text-[10px]">PCS</span>
              </div>
            ) : (
              <input type="number" step="any" min="0" value={data.stock_warehouse ?? ''} onChange={e=>onEditChange(item.barcode, 'stock_warehouse', e.target.value)} className="h-8 px-2 w-full text-sm text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
            )}
          </td>
        )}
        <td className="hidden md:table-cell p-1" style={{ borderRight: '1px solid var(--border-medium)' }}>
          {item.is_cuttable ? (
            <div className="h-8 px-2 w-full text-sm flex justify-center items-center" title="Cannot edit store aggregate directly" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-tertiary)', cursor: 'not-allowed' }}>
              {pieceCounts ? pieceCounts.store : '...'} <span className="ml-1 text-[10px]">PCS</span>
            </div>
          ) : (
            <input type="number" step="any" min="0" value={data.stock_store ?? ''} onChange={e=>onEditChange(item.barcode, 'stock_store', e.target.value)} className="h-8 px-2 w-full text-sm text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
          )}
        </td>
        <td className="hidden md:table-cell p-1 text-center text-xs text-[var(--text-tertiary)]">
          Editing
        </td>
        {renderBatchTooltip()}
      </>
    );
  }

  return (
    <>
        {/* MOBILE COMPACT CARD LAYOUT */}
        <td className="md:hidden block p-2.5 sm:p-3 text-left w-full border-none">
          {/* Row 1: Barcode, Name, Category & Stock */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-mono font-bold text-[var(--color-accent)]">
                  #{item.barcode}
                </span>
                {item.is_loose_item && (
                  <span className="px-1.5 py-0.2 text-[8px] font-bold uppercase rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Loose
                  </span>
                )}
              </div>
              <div className="text-sm font-bold text-[var(--text-primary)] leading-tight truncate mt-0.5" title={item.name}>
                {item.name}
              </div>
              {(item.category || item.sub_category) && (
                <div className="text-[10px] text-[var(--text-tertiary)] truncate mt-0.5">
                  {item.category}{item.sub_category ? ` › ${item.sub_category}` : ''}
                </div>
              )}
            </div>

            {/* Right side: Stock KPI & Selection Checkbox */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="text-right">
                <div className="text-xs font-bold text-[var(--text-primary)] tabular-nums leading-none">
                  {item.is_cuttable ? (pieceCounts ? pieceCounts.store : '...') : totalStore}
                  <span className="text-[9px] font-normal text-[var(--text-secondary)] uppercase ml-0.5">
                    {item.is_cuttable ? 'PCS' : displayUnit}
                  </span>
                </div>
                {!isWarehouseDisabled && (
                  <div className="text-[9px] text-[var(--text-tertiary)] tabular-nums mt-0.5">
                    Whse: {item.is_cuttable ? (pieceCounts ? pieceCounts.warehouse : '...') : totalWhse}
                  </div>
                )}
              </div>
              {isSelectionMode && (
                <input 
                  type="checkbox" 
                  checked={isSelected} 
                  onChange={() => onSelect(item.barcode)} 
                  onClick={e => e.stopPropagation()} 
                  className="w-4 h-4 rounded text-accent focus:ring-accent cursor-pointer" 
                />
              )}
            </div>
          </div>

          {/* Row 2: Compact Action Buttons Bar */}
          <div className="flex items-center justify-between gap-1.5 mt-2 pt-2 border-t border-[var(--border-light)]">
            <button
              type="button"
              onClick={(e) => { 
                e.stopPropagation(); 
                setIsHovered(false);
                onOpenBatchDetails && onOpenBatchDetails(item); 
              }}
              className="flex-1 py-1 px-2.5 text-[11px] font-bold uppercase rounded-md cursor-pointer transition-all active:scale-95 flex items-center justify-center gap-1.5 hover:brightness-110"
              style={{
                backgroundColor: item.is_cuttable ? 'var(--color-accent-bg)' : 'rgba(16, 185, 129, 0.1)',
                color: item.is_cuttable ? 'var(--color-accent)' : 'var(--color-success)',
                border: `1px solid ${item.is_cuttable ? 'rgba(59, 130, 246, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`
              }}
            >
              <span>{activeBatches.length} {activeBatches.length === 1 ? 'Batch' : 'Batches'}</span>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </button>

            {viewType === 'recycle' ? (
              <button 
                type="button"
                onClick={(e) => { 
                  e.stopPropagation(); 
                  onRestore && onRestore(item.barcode);
                }}
                className="py-1 px-3 rounded-md transition-all active:scale-95 text-white font-bold text-[11px] uppercase tracking-wider flex items-center justify-center gap-1 shadow-sm hover:opacity-90 cursor-pointer"
                title="Restore Item"
                style={{ backgroundColor: 'var(--color-success)' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" /></svg>
                <span>Restore</span>
              </button>
            ) : (
              <button 
                type="button"
                onClick={(e) => { 
                  e.stopPropagation(); 
                  window.dispatchEvent(new CustomEvent('openCreateBatchModal', { detail: item }));
                }}
                className="py-1 px-3 rounded-md transition-all active:scale-95 text-white font-bold text-[11px] uppercase tracking-wider flex items-center justify-center gap-1 shadow-sm hover:opacity-90 cursor-pointer"
                title="Create New Batch"
                style={{ backgroundColor: 'var(--color-accent)' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                <span>Batch</span>
              </button>
            )}
          </div>
        </td>

        {/* DESKTOP TABLE LAYOUT */}
        {isSelectionMode && (
          <td className="hidden md:table-cell p-3 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
            <input type="checkbox" checked={isSelected} onChange={() => onSelect(item.barcode)} onClick={e => e.stopPropagation()} className="w-4 h-4 rounded text-accent focus:ring-accent" />
          </td>
        )}
        <td className="hidden md:table-cell p-3 w-24 lg:w-28 text-sm font-semibold tracking-wider" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--color-accent)' }}>{item.barcode}</td>
      <td className="hidden md:table-cell p-3 w-full min-w-[180px] text-sm font-medium" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
        <div className="flex items-center justify-center gap-2 w-full min-h-[1.5rem] px-1">
          <span className="truncate text-center" title={item.name}>{item.name}</span>
          {item.is_loose_item && (
            <span className="shrink-0 px-2 py-0.5 text-[9px] font-bold uppercase rounded-full whitespace-nowrap" style={{ backgroundColor: 'rgba(234, 179, 8, 0.1)', color: 'var(--color-warning)', border: '1px solid rgba(234, 179, 8, 0.2)' }}>Loose</span>
          )}
        </div>
      </td>
      <td className="hidden md:table-cell p-3 w-36 lg:w-48 text-sm whitespace-nowrap overflow-hidden text-ellipsis text-center" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }} title={item.category || '-'}>{item.category || '-'}</td>
      <td className="hidden md:table-cell p-3 w-32 lg:w-40 text-sm whitespace-nowrap overflow-hidden text-ellipsis text-center" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }} title={item.sub_category || '-'}>{item.sub_category || '-'}</td>
      <td className="hidden md:table-cell p-3 w-28 lg:w-32 text-sm text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
        <button
          type="button"
          onClick={(e) => { 
            e.stopPropagation(); 
            setIsHovered(false);
            onOpenBatchDetails && onOpenBatchDetails(item); 
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className="inline-flex px-2.5 py-1 text-[10px] font-bold uppercase rounded-full whitespace-nowrap cursor-pointer transition-all active:scale-95 shadow-sm items-center justify-center gap-1.5 w-[96px] h-[26px] hover:brightness-110"
          style={{
            backgroundColor: item.is_cuttable ? 'var(--color-accent-bg)' : 'rgba(16, 185, 129, 0.1)',
            color: item.is_cuttable ? 'var(--color-accent)' : 'var(--color-success)',
            border: `1px solid ${item.is_cuttable ? 'rgba(59, 130, 246, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`
          }}
        >
          <span>{activeBatches.length} {activeBatches.length === 1 ? 'Batch' : 'Batches'}</span>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        </button>
      </td>
      {/* Pricing removed from parent row */}
      {!isWarehouseDisabled && (
        <td className="hidden md:table-cell p-3 w-24 lg:w-28 text-sm text-center font-bold" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
          {item.is_cuttable ? (pieceCounts ? pieceCounts.warehouse : '...') : totalWhse} <span className="text-[10px] font-normal" style={{ color: 'var(--text-secondary)' }}>{item.is_cuttable ? 'PCS' : displayUnit}</span>
        </td>
      )}
      <td className="hidden md:table-cell p-3 w-24 lg:w-28 text-sm text-center font-bold" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
        {item.is_cuttable ? (pieceCounts ? pieceCounts.store : '...') : totalStore} <span className="text-[10px] font-normal" style={{ color: 'var(--text-secondary)' }}>{item.is_cuttable ? 'PCS' : displayUnit}</span>
      </td>
      <td className="hidden md:table-cell p-3 w-28 lg:w-32 text-center">
        {viewType === 'recycle' ? (
          <button 
            onClick={(e) => { 
              e.stopPropagation(); 
              onRestore && onRestore(item.barcode);
            }}
            className="px-3 py-1.5 rounded-md transition-all active:scale-95 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1 mx-auto shadow-sm hover:opacity-90"
            title="Restore Item"
            style={{ backgroundColor: 'var(--color-success)' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" /></svg>
            Restore
          </button>
        ) : (
          <button 
            onClick={(e) => { 
              e.stopPropagation(); 
              window.dispatchEvent(new CustomEvent('openCreateBatchModal', { detail: item }));
            }}
            className="px-3 py-1.5 rounded-md transition-all active:scale-95 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1 mx-auto shadow-sm hover:opacity-90"
            title="Create New Batch"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            Batch
          </button>
        )}
      </td>
      {renderBatchTooltip()}
    </>
  );
}