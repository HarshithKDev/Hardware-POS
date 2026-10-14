import React from 'react';
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

  const displayUnit = item.unit?.toLowerCase() === 'grams' ? 'g' : item.unit?.toLowerCase() === 'meter' ? 'm' : item.unit?.toLowerCase() === 'sqft' ? 'ft' : (item.unit || '');
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
                <button
                  type="button"
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    onOpenBatchDetails && onOpenBatchDetails(item); 
                  }}
                  className="px-2.5 py-1 text-[10px] font-bold uppercase rounded-full cursor-pointer transition-all active:scale-95 shadow-sm flex items-center gap-1.5 w-max hover:brightness-110"
                  style={{
                    backgroundColor: item.is_cuttable ? 'var(--color-accent-bg)' : 'rgba(16, 185, 129, 0.1)',
                    color: item.is_cuttable ? 'var(--color-accent)' : 'var(--color-success)',
                    border: `1px solid ${item.is_cuttable ? 'rgba(59, 130, 246, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`
                  }}
                  title="Open Batch Details & Pieces"
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
            onOpenBatchDetails && onOpenBatchDetails(item); 
          }}
          className="inline-flex px-2.5 py-1 text-[10px] font-bold uppercase rounded-full whitespace-nowrap cursor-pointer transition-all active:scale-95 shadow-sm items-center justify-center gap-1.5 min-w-[75px] hover:brightness-110"
          style={{
            backgroundColor: item.is_cuttable ? 'var(--color-accent-bg)' : 'rgba(16, 185, 129, 0.1)',
            color: item.is_cuttable ? 'var(--color-accent)' : 'var(--color-success)',
            border: `1px solid ${item.is_cuttable ? 'rgba(59, 130, 246, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`
          }}
          title="Open Batch Details & Pieces"
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
      </tr>
    </>
  );
}