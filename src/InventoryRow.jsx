import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import StockInstancesModal from './StockInstancesModal';
import { Trash2 } from 'lucide-react';

export default function InventoryRow({ item, viewType, categories, subcategories, isGlobalEditMode, editData, onEditChange, isSelected, onSelect, onRestore, isSelectionMode, expandedBarcode, onToggleExpand, onPrint, onDeleteBatch }) {
  const isExpanded = expandedBarcode === item.barcode;
  const [expandedBatchId, setExpandedBatchId] = useState(null);

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
    staleTime: 30 * 1000, // 30 seconds — cuttable piece counts must stay fresh
  });

  const availableSubcategories = subcategories?.filter(sub => sub.category_name === (editData?.category || item.category)) || [];
  
  const totalWhse = item.batches ? item.batches.reduce((sum, b) => sum + Number(b.stock_warehouse), 0) : Number(item.stock_warehouse || 0);
  const totalStore = item.batches ? item.batches.reduce((sum, b) => sum + Number(b.stock_store), 0) : Number(item.stock_store || 0);

  if (isGlobalEditMode && isSelected && viewType === 'warehouse') {
    const data = editData || item;
    return (
      <tr {...virtuosoProps} className="transition-none" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
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
      </tr>
    );
  }

  return (
    <>
      <tr 
        className={`hover-row premium-hover ${isSelectionMode ? 'cursor-pointer' : ''} ${isSelected ? 'selected' : ''} block md:table-row bg-[var(--bg-secondary)] md:bg-transparent rounded-lg md:rounded-none border md:border-b md:border-t-0 md:border-l-0 md:border-r-0 border-[var(--border-medium)] md:border-[var(--border-light)] mb-3 md:mb-0 relative`}
        style={{ borderBottomWidth: '1px', borderBottomStyle: 'solid' }}
        onClick={() => {
          if (isSelectionMode) onSelect(item.barcode);
        }}
      >
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
                {item.is_cuttable ? (
                  <span onClick={(e) => { e.stopPropagation(); onToggleExpand(item.barcode); }} className="px-2.5 py-0.5 text-[9px] font-bold uppercase rounded-full cursor-pointer transition-all active:scale-95 shadow-sm flex items-center gap-1 w-max" style={{ backgroundColor: 'var(--color-accent-bg)', color: 'var(--color-accent)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                    {isExpanded ? 'Hide Details' : `${item.batches?.length || 0} Batches`}
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : 'rotate-0'}`}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </span>
                ) : (
                  <span onClick={(e) => { e.stopPropagation(); onToggleExpand(item.barcode); }} className="px-2.5 py-0.5 text-[9px] font-bold uppercase rounded-full cursor-pointer transition-all active:scale-95 shadow-sm flex items-center gap-1 w-max" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--color-success)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                    {isExpanded ? 'Hide Batches' : `${item.batches?.length || 0} Batches`}
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : 'rotate-0'}`}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </span>
                )}
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
                   {item.is_cuttable ? (pieceCounts ? pieceCounts.warehouse : '...') : totalWhse} <span className="text-[10px] font-normal text-[var(--text-secondary)]">{item.is_cuttable ? 'PCS' : (item.unit || '')}</span>
                 </div>
               </div>
               <div>
                 <div className="text-[10px] uppercase text-[var(--text-secondary)] font-semibold mb-0.5">Store Qty</div>
                 <div className="text-sm font-bold text-[var(--text-primary)]">
                   {item.is_cuttable ? (pieceCounts ? pieceCounts.store : '...') : totalStore} <span className="text-[10px] font-normal text-[var(--text-secondary)]">{item.is_cuttable ? 'PCS' : (item.unit || '')}</span>
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
        <td className="hidden md:table-cell p-3 w-20 text-sm font-semibold tracking-wider font-mono" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--color-accent)' }}>{item.barcode}</td>
      <td className="hidden md:table-cell p-3 text-sm font-medium" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
        <div className="relative flex justify-center items-center w-full min-h-[1.5rem]">
          <span className="text-center">{item.name}</span>
          <div className="absolute right-0 flex flex-col items-end gap-1.5 shrink-0">
            {item.is_loose_item && (
              <span className="px-2.5 py-0.5 text-[9px] font-bold uppercase rounded-full whitespace-nowrap" style={{ backgroundColor: 'rgba(234, 179, 8, 0.1)', color: 'var(--color-warning)', border: '1px solid rgba(234, 179, 8, 0.2)' }}>Loose</span>
            )}
          </div>
        </div>
      </td>
      <td className="hidden md:table-cell p-3 w-36 text-sm whitespace-nowrap" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>{item.category || '-'}</td>
      <td className="hidden md:table-cell p-3 w-36 text-sm whitespace-nowrap" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>{item.sub_category || '-'}</td>
      <td className="hidden md:table-cell p-3 text-sm text-center" style={{ borderRight: '1px solid var(--border-light)' }}>
        {item.is_cuttable ? (
          <span onClick={(e) => { e.stopPropagation(); onToggleExpand(item.barcode); }} className="inline-flex px-2.5 py-0.5 text-[9px] font-bold uppercase rounded-full whitespace-nowrap cursor-pointer transition-all active:scale-95 shadow-sm items-center justify-center gap-1 min-w-[75px]" style={{ backgroundColor: 'var(--color-accent-bg)', color: 'var(--color-accent)', border: '1px solid rgba(59, 130, 246, 0.2)' }} title="View Batches/Pieces">
            {isExpanded ? 'Hide Details' : `${item.batches?.length || 0} Batches`}
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : 'rotate-0'}`}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </span>
        ) : (
          <span onClick={(e) => { e.stopPropagation(); onToggleExpand(item.barcode); }} className="inline-flex px-2.5 py-0.5 text-[9px] font-bold uppercase rounded-full whitespace-nowrap cursor-pointer transition-all active:scale-95 shadow-sm items-center justify-center gap-1 min-w-[75px]" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--color-success)', border: '1px solid rgba(16, 185, 129, 0.2)' }} title="View Batches">
            {isExpanded ? 'Hide Batches' : `${item.batches?.length || 0} Batches`}
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : 'rotate-0'}`}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </span>
        )}
      </td>
      {/* Pricing removed from parent row */}
      <td className="hidden md:table-cell p-3 text-sm text-center font-bold" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
        {item.is_cuttable ? (pieceCounts ? pieceCounts.warehouse : '...') : totalWhse} <span className="text-[10px] font-normal" style={{ color: 'var(--text-secondary)' }}>{item.is_cuttable ? 'PCS' : (item.unit || '')}</span>
      </td>
      <td className="hidden md:table-cell p-3 text-sm text-center font-bold" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
        {item.is_cuttable ? (pieceCounts ? pieceCounts.store : '...') : totalStore} <span className="text-[10px] font-normal" style={{ color: 'var(--text-secondary)' }}>{item.is_cuttable ? 'PCS' : (item.unit || '')}</span>
      </td>
      <td className="hidden md:table-cell p-3 text-center">
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
      </tr>

      {isExpanded && item.batches && (
        <tr className="block md:table-row bg-[var(--bg-tertiary)] border-t-0">
          <td colSpan="11" className="block md:table-cell p-0" style={{ borderBottom: item.is_cuttable ? 'none' : '2px solid var(--color-success)' }}>
            <div className="w-full overflow-hidden animate-fade-in shadow-inner">
              <div className={`flex-1 p-6 ${item.is_cuttable ? 'pb-2' : ''}`}>
                <div className="flex justify-between items-center mb-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-tertiary)] flex-1">
                    Available Batches
                    {item.is_cuttable && <span className="ml-2 text-[10px] font-normal lowercase opacity-70">(click a batch to view pieces)</span>}
                  </p>
                  <button onClick={() => onToggleExpand(item.barcode)} className="px-3 py-1.5 rounded-md text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors hover:opacity-90" style={{ backgroundColor: 'var(--color-error)' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    Close
                  </button>
                </div>
                
                <div className="flex flex-col gap-3 min-w-0">
                  {item.batches.length === 0 ? (
                    <div className="p-8 text-center text-[var(--text-tertiary)] text-xs font-semibold rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-light)]">
                      {viewType === 'recycle' ? 'No batches found. Restore item to manage batches.' : 'No batches found. Click the + BATCH button to create one.'}
                    </div>
                  ) : item.batches.map(batch => (
                    <React.Fragment key={batch.batch_id}>
                      <div 
                        onClick={() => {
                          if (item.is_cuttable) {
                            setExpandedBatchId(expandedBatchId === batch.batch_id ? null : batch.batch_id);
                          }
                        }}
                        className={`flex flex-col md:flex-row md:items-center justify-between p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-light)] shadow-sm transition-all ${item.is_cuttable ? 'cursor-pointer hover:border-[var(--border-heavy)] hover:-translate-y-px' : ''}`}
                      >
                        <div className="flex items-center gap-4 mb-3 md:mb-0 md:w-1/4">
                          {item.is_cuttable && (
                            <div className={`transition-transform duration-200 text-[var(--text-tertiary)] ${expandedBatchId === batch.batch_id ? 'rotate-90 text-[var(--color-accent)]' : ''}`}>
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                            </div>
                          )}
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-1">Batch ID</div>
                            <div className="text-sm font-semibold font-mono text-[var(--text-primary)]">{item.barcode}-{String(batch.batch_number || 1).padStart(2, '0')}</div>
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap md:flex-nowrap items-center gap-6 md:w-1/2">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-1">Cost</div>
                            <div className="text-sm font-medium text-[var(--text-primary)]">₹{Number(batch.purchase_cost).toFixed(2)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-1">MSP</div>
                            <div className="text-sm font-medium text-[var(--text-primary)]">₹{Number(batch.msp).toFixed(2)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-1">MRP</div>
                            <div className="text-sm font-medium text-[var(--text-primary)]">₹{Number(batch.selling_price).toFixed(2)}</div>
                          </div>
                          <div className="pl-0 md:pl-6 border-l-0 md:border-l border-[var(--border-light)]">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-1">Whse / Store</div>
                            <div className="text-sm font-bold flex gap-2">
                              <span>
                                <span className="text-[var(--color-accent)]">{item.is_cuttable ? (pieceCounts?.byBatch?.[batch.batch_id]?.warehouse || 0) : batch.stock_warehouse}</span>
                                <span className="text-[10px] ml-1 font-normal text-[var(--text-secondary)]">{item.is_cuttable ? 'PCS' : (item.unit || '')}</span>
                              </span>
                              <span className="text-[var(--text-tertiary)]">/</span>
                              <span>
                                <span className="text-[var(--color-success)]">{item.is_cuttable ? (pieceCounts?.byBatch?.[batch.batch_id]?.store || 0) : batch.stock_store}</span>
                                <span className="text-[10px] ml-1 font-normal text-[var(--text-secondary)]">{item.is_cuttable ? 'PCS' : (item.unit || '')}</span>
                              </span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 mt-4 md:mt-0 md:w-1/4 md:justify-end">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation(); e.preventDefault();
                              if (viewType !== 'recycle') onPrint && onPrint(batch);
                            }}
                            className={`px-3 py-1.5 rounded-md transition-colors font-bold text-[10px] uppercase tracking-wider flex items-center gap-1.5 border ${
                              viewType === 'recycle'
                                ? 'border-[var(--border-medium)] text-[var(--text-tertiary)] opacity-50 cursor-not-allowed'
                                : 'hover:bg-[var(--color-accent-bg)] text-[var(--color-accent)] border-[var(--color-accent)] cursor-pointer'
                            }`}
                            title="Print this batch" disabled={viewType === 'recycle'}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0v-2.94a2.25 2.25 0 012.25-2.25h6a2.25 2.25 0 012.25 2.25v2.94z" /></svg>
                            Print
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation(); e.preventDefault();
                              if (viewType !== 'recycle' && Number(batch.stock_warehouse) === 0 && Number(batch.stock_store) === 0) onDeleteBatch && onDeleteBatch(batch.batch_id);
                            }}
                            className={`px-3 py-1.5 rounded-md transition-colors font-bold text-[10px] uppercase tracking-wider flex items-center gap-1.5 border ${
                              viewType !== 'recycle' && Number(batch.stock_warehouse) === 0 && Number(batch.stock_store) === 0
                                ? 'border-red-500 text-red-500 hover:bg-red-500/10 cursor-pointer'
                                : 'border-[var(--border-medium)] text-[var(--text-tertiary)] opacity-50 cursor-not-allowed'
                            }`}
                            title={Number(batch.stock_warehouse) === 0 && Number(batch.stock_store) === 0 ? 'Delete empty batch' : 'Cannot delete batch with stock'}
                            disabled={viewType === 'recycle' || !(Number(batch.stock_warehouse) === 0 && Number(batch.stock_store) === 0)}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                            Delete
                          </button>
                        </div>
                      </div>
                      {item.is_cuttable && expandedBatchId === batch.batch_id && (
                        <div className="ml-4 md:ml-12 pl-4 border-l-2 border-[var(--border-light)] pb-4 mt-2">
                          <StockInstancesModal isOpen={true} onClose={() => setExpandedBatchId(null)} item={item} inline={true} filterBatchId={batch.batch_id} />
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}