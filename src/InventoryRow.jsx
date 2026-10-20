import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';

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

  const { data: pieceCounts } = useQuery({
    queryKey: ['piece_counts', item.barcode],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_instances')
        .select('location, batch_id')
        .eq('parent_barcode', String(item.barcode))
        .eq('is_active', true)
        .gt('current_length', 0);
        
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
  
  const totalWhse = item.batches ? item.batches.reduce((sum, b) => sum + Number(b.stock_warehouse), 0) : Number(item.stock_warehouse || 0);
  const totalStore = item.batches ? item.batches.reduce((sum, b) => sum + Number(b.stock_store), 0) : Number(item.stock_store || 0);

  const [popoverPos, setPopoverPos] = useState(null);
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef(null);

  const activeBatches = useMemo(() => {
    return (item.batches || [])
      .filter(b => b.is_active !== false)
      .sort((a, b) => (a.batch_number || 1) - (b.batch_number || 1));
  }, [item.batches]);

  const handleMouseEnter = useCallback((e) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    const rect = e.currentTarget.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const showAbove = spaceBelow < 260 && rect.top > 260;
    
    const tooltipWidth = 290;
    const buttonCenterX = rect.left + rect.width / 2;
    let finalLeft = Math.round(buttonCenterX - tooltipWidth / 2);
    if (finalLeft < 16) {
      finalLeft = 16;
    } else if (finalLeft + tooltipWidth > window.innerWidth - 16) {
      finalLeft = window.innerWidth - 16 - tooltipWidth;
    }

    hoverTimeoutRef.current = setTimeout(() => {
      setPopoverPos({
        top: Math.round(showAbove ? rect.top - 8 : rect.bottom + 8),
        left: finalLeft,
        showAbove
      });
      setIsHovered(true);
    }, 60);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setIsHovered(false);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isHovered) return;
    const handleScrollOrResize = () => {
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
        className="fixed z-[99999] pointer-events-none animate-fade-in"
        style={{
          top: `${popoverPos.top}px`,
          left: `${popoverPos.left}px`,
          width: '290px',
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
              <span className="text-[10px] text-[var(--text-tertiary)] font-mono">
                Barcode: {item.barcode}
              </span>
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
            <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-0.5 custom-scrollbar">
              {activeBatches.map((b) => {
                const bNum = b.batch_number || 1;
                const bCode = `${item.barcode}-${String(bNum).padStart(2, '0')}`;
                const mrpVal = Number(b.selling_price !== undefined && b.selling_price !== null ? b.selling_price : (item.price || 0));
                const whseQty = Number(b.stock_warehouse || 0);
                const storeQty = Number(b.stock_store || 0);

                return (
                  <div
                    key={b.batch_id || bCode}
                    className="p-2 rounded flex items-center justify-between gap-2.5"
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
                        <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
                          ({bCode})
                        </span>
                      </div>
                      <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                        Whse: <span className="font-semibold text-[var(--text-primary)]">{whseQty}</span>
                        {' • '}
                        Store: <span className="font-semibold text-[var(--text-primary)]">{storeQty}</span>
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
              })}
            </div>
          )}

          {/* Footer info */}
          <div className="mt-2 pt-1.5 border-t border-[var(--border-light)] text-[10px] text-center text-[var(--text-tertiary)] flex items-center justify-center gap-1">
            <span>Click button to view batch details</span>
            <span>↗</span>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  if (isGlobalEditMode && isSelected && viewType === 'warehouse') {
    const data = editData || item;
    return (
      <>
        {isSelectionMode && (
          <td className="p-3 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>
            <input type="checkbox" checked={isSelected} onChange={() => onSelect(item.barcode)} className="w-4 h-4 rounded text-accent focus:ring-accent" />
          </td>
        )}
        <td className="p-3 text-sm font-semibold tracking-wider" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--color-accent)' }}>{item.barcode}</td>
        <td className="p-1" style={{ borderRight: '1px solid var(--border-light)' }}>
          <input type="text" value={data.name || ''} onChange={e=>onEditChange(item.barcode, 'name', e.target.value)} className="h-8 px-2 w-full text-sm focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
        </td>
        
        <td className="p-1" style={{ borderRight: '1px solid var(--border-light)' }}>
          <div className="relative w-full">
            <select value={data.category || ''} onChange={e=>{onEditChange(item.barcode, 'category', e.target.value); onEditChange(item.barcode, 'sub_category', '');}} className="h-auto py-1.5 pl-2 pr-8 w-full text-xs focus:outline-none appearance-none truncate cursor-pointer rounded-sm" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
              <option value="">None</option>
              {categories?.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2" style={{ color: 'var(--text-secondary)' }}>
              <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
            </div>
          </div>
        </td>

        <td className="p-1" style={{ borderRight: '1px solid var(--border-light)' }}>
          <div className="relative w-full">
            <select value={data.sub_category || ''} onChange={e=>onEditChange(item.barcode, 'sub_category', e.target.value)} disabled={!data.category} className="h-auto py-1.5 pl-2 pr-8 w-full text-xs focus:outline-none appearance-none truncate cursor-pointer rounded-sm disabled:opacity-50" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
              <option value="">None</option>
              {availableSubcategories.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2" style={{ color: 'var(--text-secondary)' }}>
              <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
            </div>
          </div>
        </td>

        <td 
          className="p-1 text-center cursor-pointer" 
          style={{ borderRight: '1px solid var(--border-light)' }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <span className="text-xs text-[var(--text-tertiary)] hover:text-[var(--color-accent)] transition-colors">{item.batches?.length || 0} Batches</span>
        </td>

        {/* Pricing inputs removed from edit mode. Pricing is now batch-level only. */}
        <td className="p-1" style={{ borderRight: '1px solid var(--border-light)' }}>
          {item.is_cuttable ? (
            <div className="h-8 px-2 w-full text-sm flex justify-center items-center" title="Cannot edit warehouse aggregate directly" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-tertiary)', cursor: 'not-allowed' }}>
              {pieceCounts ? pieceCounts.warehouse : '...'} <span className="ml-1 text-[10px]">PCS</span>
            </div>
          ) : (
            <input type="number" step="any" min="0" value={data.stock_warehouse ?? ''} onChange={e=>onEditChange(item.barcode, 'stock_warehouse', e.target.value)} className="h-8 px-2 w-full text-sm text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
          )}
        </td>
        <td className="p-1" style={{ borderRight: '1px solid var(--border-light)' }}>
          {item.is_cuttable ? (
            <div className="h-8 px-2 w-full text-sm flex justify-center items-center" title="Cannot edit store aggregate directly" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-tertiary)', cursor: 'not-allowed' }}>
              {pieceCounts ? pieceCounts.store : '...'} <span className="ml-1 text-[10px]">PCS</span>
            </div>
          ) : (
            <input type="number" step="any" min="0" value={data.stock_store ?? ''} onChange={e=>onEditChange(item.barcode, 'stock_store', e.target.value)} className="h-8 px-2 w-full text-sm text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
          )}
        </td>
        <td className="p-1 text-center text-xs text-[var(--text-tertiary)]">
          Editing
        </td>
        {renderBatchTooltip()}
      </>
    );
  }

  return (
    <>
        {/* MOBILE CARD LAYOUT */}
        <td className="md:hidden block p-4 text-left w-full border-none">
           <div className="flex justify-between items-start mb-2">
             <div className="flex-1 pr-2">
               <div className="text-[10px] font-bold tracking-widest text-[var(--color-accent)] mb-1">{item.barcode}</div>
               <div className="text-base font-bold text-[var(--text-primary)] leading-tight">{item.name}</div>
               <div className="text-[11px] text-[var(--text-secondary)] mt-1">{item.category} {item.sub_category ? `› ${item.sub_category}` : ''}</div>
             </div>
             <div className="flex flex-col items-end gap-2 flex-shrink-0">
               {isSelectionMode && (
                 <input type="checkbox" checked={isSelected} onChange={() => onSelect(item.barcode)} onClick={e => e.stopPropagation()} className="w-6 h-6 rounded text-accent focus:ring-accent" />
               )}
                {item.is_loose_item && (
                  <span className="px-2 py-0.5 text-[9px] font-bold uppercase rounded-full" style={{ backgroundColor: 'rgba(234, 179, 8, 0.1)', color: 'var(--color-warning)', border: '1px solid rgba(234, 179, 8, 0.2)' }}>Loose</span>
                )}
                <button
                  type="button"
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    setIsHovered(false);
                    onOpenBatchDetails && onOpenBatchDetails(item); 
                  }}
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                  className="px-2.5 py-1 text-[10px] font-bold uppercase rounded-full cursor-pointer transition-all active:scale-95 shadow-sm flex items-center justify-center gap-1.5 w-[96px] h-[26px] hover:brightness-110"
                  style={{
                    backgroundColor: item.is_cuttable ? 'var(--color-accent-bg)' : 'rgba(16, 185, 129, 0.1)',
                    color: item.is_cuttable ? 'var(--color-accent)' : 'var(--color-success)',
                    border: `1px solid ${item.is_cuttable ? 'rgba(59, 130, 246, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`
                  }}
                >
                  <span>{item.batches?.length || 0} {item.batches?.length === 1 ? 'Batch' : 'Batches'}</span>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </button>
             </div>
             
             {/* Create Batch Button for Mobile */}
             <div className="absolute top-4 right-4">
               <button onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('openCreateBatchModal', { detail: item })); }} className="p-1.5 rounded-full" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--color-accent)' }}>
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
               </button>
             </div>
             
           </div>
           
             <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-[var(--border-medium)]">
               <div>
                 <div className="text-[10px] uppercase text-[var(--text-secondary)] font-semibold mb-0.5">Whse Qty</div>
                 <div className="text-sm font-bold text-[var(--text-primary)]">
                   {item.is_cuttable ? (pieceCounts ? pieceCounts.warehouse : '...') : totalWhse} <span className="text-[10px] font-normal text-[var(--text-secondary)]">{item.is_cuttable ? 'PCS' : displayUnit}</span>
                 </div>
               </div>
               <div>
                 <div className="text-[10px] uppercase text-[var(--text-secondary)] font-semibold mb-0.5">Store Qty</div>
                 <div className="text-sm font-bold text-[var(--text-primary)]">
                   {item.is_cuttable ? (pieceCounts ? pieceCounts.store : '...') : totalStore} <span className="text-[10px] font-normal text-[var(--text-secondary)]">{item.is_cuttable ? 'PCS' : displayUnit}</span>
                 </div>
               </div>
             </div>
        </td>

        {/* DESKTOP TABLE LAYOUT */}
        {isSelectionMode && (
          <td className="hidden md:table-cell p-3 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>
            <input type="checkbox" checked={isSelected} onChange={() => onSelect(item.barcode)} onClick={e => e.stopPropagation()} className="w-4 h-4 rounded text-accent focus:ring-accent" />
          </td>
        )}
        <td className="hidden md:table-cell p-3 w-24 lg:w-28 text-sm font-semibold tracking-wider" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--color-accent)' }}>{item.barcode}</td>
      <td className="hidden md:table-cell p-3 w-full min-w-[180px] text-sm font-medium" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
        <div className="flex items-center justify-center gap-2 w-full min-h-[1.5rem] px-1">
          <span className="truncate text-center" title={item.name}>{item.name}</span>
          {item.is_loose_item && (
            <span className="shrink-0 px-2 py-0.5 text-[9px] font-bold uppercase rounded-full whitespace-nowrap" style={{ backgroundColor: 'rgba(234, 179, 8, 0.1)', color: 'var(--color-warning)', border: '1px solid rgba(234, 179, 8, 0.2)' }}>Loose</span>
          )}
        </div>
      </td>
      <td className="hidden md:table-cell p-3 w-36 lg:w-48 text-sm whitespace-nowrap overflow-hidden text-ellipsis text-center" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }} title={item.category || '-'}>{item.category || '-'}</td>
      <td className="hidden md:table-cell p-3 w-32 lg:w-40 text-sm whitespace-nowrap overflow-hidden text-ellipsis text-center" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }} title={item.sub_category || '-'}>{item.sub_category || '-'}</td>
      <td className="hidden md:table-cell p-3 w-28 lg:w-32 text-sm text-center" style={{ borderRight: '1px solid var(--border-light)' }}>
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
          <span>{item.batches?.length || 0} {item.batches?.length === 1 ? 'Batch' : 'Batches'}</span>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        </button>
      </td>
      {/* Pricing removed from parent row */}
      <td className="hidden md:table-cell p-3 w-24 lg:w-28 text-sm text-center font-bold" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
        {item.is_cuttable ? (pieceCounts ? pieceCounts.warehouse : '...') : totalWhse} <span className="text-[10px] font-normal" style={{ color: 'var(--text-secondary)' }}>{item.is_cuttable ? 'PCS' : displayUnit}</span>
      </td>
      <td className="hidden md:table-cell p-3 w-24 lg:w-28 text-sm text-center font-bold" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
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