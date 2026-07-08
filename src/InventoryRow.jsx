import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import StockInstancesModal from './StockInstancesModal';

export default function InventoryRow({ item, viewType, categories, subcategories, isGlobalEditMode, editData, onEditChange, isSelected, onSelect, onRestore, isSelectionMode }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: pieceCounts } = useQuery({
    queryKey: ['piece_counts', item.barcode],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_piece_counts', { p_barcode: String(item.barcode) });
        
      if (error) {
        console.error("Piece counts error for", item.barcode, error);
        throw error;
      }
      
      console.log("Piece counts fetched for", item.barcode, ":", data);
      
      return { 
        warehouse: data?.warehouse || 0, 
        store: data?.store || 0 
      };
    },
    enabled: !!item.is_cuttable,
    staleTime: 30 * 1000, // 30 seconds — cuttable piece counts must stay fresh
  });

  const availableSubcategories = subcategories?.filter(sub => sub.category_name === (editData?.category || item.category)) || [];

  if (isGlobalEditMode && isSelected && viewType === 'warehouse') {
    const data = editData || item;
    return (
      <tr className="transition-none" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
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

        <td className="p-1" style={{ borderRight: '1px solid var(--border-light)' }}><input type="number" step="1" min="0" value={data.cost_price ?? ''} onChange={e=>onEditChange(item.barcode, 'cost_price', e.target.value)} className="h-8 px-2 w-full text-sm text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} /></td>
        <td className="p-1" style={{ borderRight: '1px solid var(--border-light)' }}><input type="number" step="1" min="0" value={data.msp ?? ''} onChange={e=>onEditChange(item.barcode, 'msp', e.target.value)} className="h-8 px-2 w-full text-sm text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} /></td>
        <td className="p-1" style={{ borderRight: '1px solid var(--border-light)' }}><input type="number" step="1" min="0" value={data.price ?? ''} onChange={e=>onEditChange(item.barcode, 'price', e.target.value)} className="h-8 px-2 w-full text-sm text-center focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} /></td>
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
        className={`hover-row ${isSelectionMode ? 'cursor-pointer' : ''} ${isSelected ? 'selected' : ''} block md:table-row bg-[var(--bg-secondary)] md:bg-transparent rounded-lg md:rounded-none border md:border-b md:border-t-0 md:border-l-0 md:border-r-0 border-[var(--border-medium)] md:border-[var(--border-light)] mb-3 md:mb-0 relative`}
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
                {item.is_cuttable && (
                  <span onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }} className="px-2.5 py-0.5 text-[9px] font-bold uppercase rounded-full cursor-pointer transition-all active:scale-95 shadow-sm flex items-center gap-1 w-max" style={{ backgroundColor: 'var(--color-accent-bg)', color: 'var(--color-accent)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                    {isExpanded ? 'Hide Pieces' : 'Cuttable'}
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : 'rotate-0'}`}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </span>
                )}
             </div>
           </div>
           
           <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-[var(--border-medium)]">
             <div>
               <div className="text-[10px] uppercase text-[var(--text-secondary)] font-semibold mb-0.5">Whse Qty</div>
               <div className="text-sm font-bold text-[var(--text-primary)]">
                 {item.is_cuttable ? (pieceCounts ? pieceCounts.warehouse : '...') : (item.stock_warehouse || 0)} <span className="text-[10px] font-normal text-[var(--text-secondary)]">{item.is_cuttable ? 'PCS' : (item.unit || '')}</span>
               </div>
             </div>
             <div>
               <div className="text-[10px] uppercase text-[var(--text-secondary)] font-semibold mb-0.5">Store Qty</div>
               <div className="text-sm font-bold text-[var(--text-primary)]">
                 {item.is_cuttable ? (pieceCounts ? pieceCounts.store : '...') : (item.stock_store || 0)} <span className="text-[10px] font-normal text-[var(--text-secondary)]">{item.is_cuttable ? 'PCS' : (item.unit || '')}</span>
               </div>
             </div>
             <div className="text-right">
               <div className="text-[10px] uppercase text-[var(--text-secondary)] font-semibold mb-0.5">Price</div>
               <div className="text-sm font-bold text-[var(--text-primary)]">₹{Number(item.price||0).toFixed(2)}</div>
             </div>
           </div>
        </td>

        {/* DESKTOP TABLE LAYOUT */}
        {isSelectionMode && (
          <td className="hidden md:table-cell p-3 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>
            <input type="checkbox" checked={isSelected} onChange={() => onSelect(item.barcode)} onClick={e => e.stopPropagation()} className="w-4 h-4 rounded text-accent focus:ring-accent" />
          </td>
        )}
        <td className="hidden md:table-cell p-3 text-sm font-semibold tracking-wider font-mono" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--color-accent)' }}>{item.barcode}</td>
      <td className="hidden md:table-cell p-3 text-sm font-medium" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
        <div className="relative flex justify-center items-center w-full min-h-[1.5rem]">
          <span className="text-center">{item.name}</span>
          <div className="absolute right-0 flex flex-col items-end gap-1.5 shrink-0">
            {item.is_loose_item && (
              <span className="px-2.5 py-0.5 text-[9px] font-bold uppercase rounded-full whitespace-nowrap" style={{ backgroundColor: 'rgba(234, 179, 8, 0.1)', color: 'var(--color-warning)', border: '1px solid rgba(234, 179, 8, 0.2)' }}>Loose</span>
            )}
            {item.is_cuttable && (
              <span onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }} className="px-2.5 py-0.5 text-[9px] font-bold uppercase rounded-full whitespace-nowrap cursor-pointer transition-all active:scale-95 shadow-sm flex items-center justify-center gap-1 min-w-[75px]" style={{ backgroundColor: 'var(--color-accent-bg)', color: 'var(--color-accent)', border: '1px solid rgba(59, 130, 246, 0.2)' }} title="View Pieces">
                {isExpanded ? 'Hide Pieces' : 'Cuttable'}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : 'rotate-0'}`}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </span>
            )}
          </div>
        </div>
      </td>
      <td className="hidden md:table-cell p-3 text-sm" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>{item.category || '-'}</td>
      <td className="hidden md:table-cell p-3 text-sm" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>{item.sub_category || '-'}</td>
      <td className="hidden md:table-cell p-3 text-sm text-center" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>₹{Number(item.cost_price||0).toFixed(2)}</td>
      <td className="hidden md:table-cell p-3 text-sm text-center" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>₹{Number(item.msp||0).toFixed(2)}</td>
      <td className="hidden md:table-cell p-3 text-sm text-center" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>₹{Number(item.price||0).toFixed(2)}</td>
      <td className="hidden md:table-cell p-3 text-sm text-center font-bold" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
        {item.is_cuttable ? (pieceCounts ? pieceCounts.warehouse : '...') : (item.stock_warehouse || 0)} <span className="text-[10px] font-normal" style={{ color: 'var(--text-secondary)' }}>{item.is_cuttable ? 'PCS' : (item.unit || '')}</span>
      </td>
      <td className="hidden md:table-cell p-3 text-sm text-center font-bold" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
        {item.is_cuttable ? (pieceCounts ? pieceCounts.store : '...') : (item.stock_store || 0)} <span className="text-[10px] font-normal" style={{ color: 'var(--text-secondary)' }}>{item.is_cuttable ? 'PCS' : (item.unit || '')}</span>
      </td>
      </tr>
      {isExpanded && item.is_cuttable && (
        <tr>
          <td colSpan="11" className="p-0 border-b" style={{ borderColor: 'var(--border-medium)' }}>
            <StockInstancesModal isOpen={true} onClose={() => setIsExpanded(false)} item={item} />
          </td>
        </tr>
      )}
    </>
  );
}