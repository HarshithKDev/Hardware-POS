import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import StockInstancesModal from './StockInstancesModal';

export default function InventoryRow({ item, viewType, categories, subcategories, onSave, onRemove, onRestore }) {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState(item);
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: pieceCounts } = useQuery({
    queryKey: ['piece_counts', item.barcode],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_instances')
        .select('location')
        .eq('parent_barcode', item.barcode)
        .eq('is_active', true);
      if (error) throw error;
      
      let whse = 0;
      let store = 0;
      data.forEach(d => {
        if (d.location === 'Store') store++;
        else whse++;
      });
      return { warehouse: whse, store: store };
    },
    enabled: !!item.is_cuttable,
    staleTime: 5 * 60 * 1000,
  });

  const handleSave = () => {
    onSave({ oldItem: item, newItem: formData });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setFormData(item); 
    setIsEditing(false);
  };

  // Filter available subcategories for the edit dropdown based on the currently selected category
  const availableSubcategories = subcategories?.filter(sub => sub.category_name === formData.category) || [];

  if (isEditing && viewType === 'warehouse') {
    return (
      <tr className="transition-none" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
        <td className="p-3 text-sm font-semibold tracking-wider" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--color-accent)' }}>{item.barcode}</td>
        <td className="p-1" style={{ borderRight: '1px solid var(--border-light)' }}>
          <input type="text" value={formData.name || ''} onChange={e=>setFormData({...formData, name: e.target.value})} className="h-8 px-2 w-full text-sm rounded-none focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
        </td>
        
        <td className="p-1" style={{ borderRight: '1px solid var(--border-light)' }}>
          <select value={formData.category || ''} onChange={e=>setFormData({...formData, category: e.target.value, sub_category: ''})} className="h-8 px-1 w-full text-xs rounded-none focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}>
            <option value="">None</option>
            {categories?.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </td>

        <td className="p-1" style={{ borderRight: '1px solid var(--border-light)' }}>
          <select value={formData.sub_category || ''} onChange={e=>setFormData({...formData, sub_category: e.target.value})} disabled={!formData.category} className="h-8 px-1 w-full text-xs rounded-none focus:outline-none disabled:opacity-50" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}>
            <option value="">None</option>
            {availableSubcategories.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </td>

        <td className="p-1" style={{ borderRight: '1px solid var(--border-light)' }}><input type="number" step="1" min="0" value={formData.cost_price ?? ''} onChange={e=>setFormData({...formData, cost_price: e.target.value})} className="h-8 px-2 w-full text-sm text-center rounded-none focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} /></td>
        <td className="p-1" style={{ borderRight: '1px solid var(--border-light)' }}><input type="number" step="1" min="0" value={formData.msp ?? ''} onChange={e=>setFormData({...formData, msp: e.target.value})} className="h-8 px-2 w-full text-sm text-center rounded-none focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} /></td>
        <td className="p-1" style={{ borderRight: '1px solid var(--border-light)' }}><input type="number" step="1" min="0" value={formData.price ?? ''} onChange={e=>setFormData({...formData, price: e.target.value})} className="h-8 px-2 w-full text-sm text-center rounded-none focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} /></td>
        <td className="p-1" style={{ borderRight: '1px solid var(--border-light)' }}><input type="number" step="any" min="0" value={formData.stock_warehouse ?? ''} onChange={e=>setFormData({...formData, stock_warehouse: e.target.value})} className="h-8 px-2 w-full text-sm text-center rounded-none focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} disabled={item.is_cuttable} title={item.is_cuttable ? "Cannot edit warehouse aggregate for cuttable item directly" : ""} /></td>
        <td className="p-1" style={{ borderRight: '1px solid var(--border-light)' }}><input type="number" step="any" min="0" value={formData.stock_store ?? ''} onChange={e=>setFormData({...formData, stock_store: e.target.value})} className="h-8 px-2 w-full text-sm text-center rounded-none focus:outline-none" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} disabled={item.is_cuttable} title={item.is_cuttable ? "Cannot edit store aggregate for cuttable item directly" : ""} /></td>
        <td className="p-2 flex flex-col gap-1 justify-center items-center">
          <div className="flex gap-2 mb-1 justify-center">
            <label className="flex items-center gap-1 text-[10px] cursor-pointer">
              <input type="checkbox" checked={formData.is_loose_item || false} onChange={e => setFormData({...formData, is_loose_item: e.target.checked, is_cuttable: e.target.checked ? false : formData.is_cuttable})} className="w-3 h-3 cursor-pointer" />
              <span style={{ color: 'var(--text-secondary)' }}>Loose</span>
            </label>
            <label className="flex items-center gap-1 text-[10px] cursor-pointer">
              <input type="checkbox" checked={formData.is_cuttable || false} onChange={e => setFormData({...formData, is_cuttable: e.target.checked, is_loose_item: e.target.checked ? false : formData.is_loose_item})} className="w-3 h-3 cursor-pointer" disabled />
              <span style={{ color: 'var(--text-secondary)' }}>Cuttable</span>
            </label>
          </div>
          <div className="flex gap-1">
            <button onClick={handleSave} className="h-8 text-white px-2 text-xs font-semibold rounded-none focus:outline-none" style={{ backgroundColor: 'var(--color-success)' }}>Save</button>
            <button onClick={handleCancel} className="h-8 px-2 text-xs font-semibold rounded-none focus:outline-none" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>Cancel</button>
          </div>
          {formData.unit === 'SQFT' && (
            <div className="flex gap-2 justify-center">
              <input type="number" step="any" min="0" placeholder="Def. Length" value={formData.default_length ?? ''} onChange={e=>setFormData({...formData, default_length: e.target.value})} className="h-8 px-2 w-16 text-xs text-center rounded-none focus:outline-none disabled:opacity-50" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} title={Number(item.stock_warehouse) > 0 || Number(item.stock_store) > 0 ? "Cannot edit dimensions while active stock exists" : "Default Length"} disabled={Number(item.stock_warehouse) > 0 || Number(item.stock_store) > 0} />
              <input type="number" step="any" min="0" placeholder="Def. Height" value={formData.default_width ?? ''} onChange={e=>setFormData({...formData, default_width: e.target.value})} className="h-8 px-2 w-16 text-xs text-center rounded-none focus:outline-none disabled:opacity-50" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} title={Number(item.stock_warehouse) > 0 || Number(item.stock_store) > 0 ? "Cannot edit dimensions while active stock exists" : "Default Height"} disabled={Number(item.stock_warehouse) > 0 || Number(item.stock_store) > 0} />
            </div>
          )}
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr 
        className="transition-colors hover:bg-[var(--bg-hover)] cursor-pointer" 
        style={{ borderBottom: '1px solid var(--border-light)' }}
        onClick={() => item.is_cuttable && setIsExpanded(!isExpanded)}
      >
      <td className="p-3 text-sm font-semibold tracking-wider font-mono" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--color-accent)' }}>{item.barcode}</td>
      <td className="p-3 text-sm font-medium" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
        <div className="flex items-center gap-2">
          {item.name}
          {item.is_loose_item && (
            <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded-sm whitespace-nowrap" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--color-accent)', border: '1px solid var(--border-medium)' }}>Loose</span>
          )}
          {item.is_cuttable && (
            <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded-sm whitespace-nowrap" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--color-accent)', border: '1px solid var(--border-medium)' }}>Cuttable</span>
          )}
        </div>
      </td>
      <td className="p-3 text-sm" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>{item.category || '-'}</td>
      <td className="p-3 text-sm" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>{item.sub_category || '-'}</td>
      <td className="p-3 text-sm text-center" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>{Number(item.cost_price||0).toFixed(2)}</td>
      <td className="p-3 text-sm text-center" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>{Number(item.msp||0).toFixed(2)}</td>
      <td className="p-3 text-sm text-center" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>₹{Number(item.price||0).toFixed(2)}</td>
      <td className="p-3 text-sm text-center font-bold" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
        {item.is_cuttable ? (pieceCounts ? pieceCounts.warehouse : '...') : item.stock_warehouse} <span className="text-[10px] font-normal" style={{ color: 'var(--text-secondary)' }}>{item.is_cuttable ? 'PCS' : (item.unit || '')}</span>
      </td>
      <td className="p-3 text-sm text-center font-bold" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
        {item.is_cuttable ? (pieceCounts ? pieceCounts.store : '...') : item.stock_store} <span className="text-[10px] font-normal" style={{ color: 'var(--text-secondary)' }}>{item.is_cuttable ? 'PCS' : (item.unit || '')}</span>
      </td>
      {viewType === 'warehouse' && (
        <td className="p-2 text-center h-full align-middle">
          <div className="flex gap-1 justify-center items-center" onClick={e => e.stopPropagation()}>
            <button onClick={() => { setIsEditing(true); setFormData(item); }} className="h-8 px-2 text-xs font-semibold rounded-none focus:outline-none" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>Edit</button>
            {item.is_cuttable && (
              <button onClick={() => setIsExpanded(!isExpanded)} className="h-8 px-2 text-xs font-semibold rounded-none focus:outline-none whitespace-nowrap" style={{ backgroundColor: isExpanded ? 'var(--bg-tertiary)' : 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--color-accent)' }}>{isExpanded ? 'Hide Pieces' : 'Pieces'}</button>
            )}
            <button onClick={() => onRemove(item.barcode)} className="h-8 px-2 text-xs font-semibold rounded-none focus:outline-none" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--color-error)', color: 'var(--color-error)' }}>Remove</button>
          </div>
        </td>
      )}
      {viewType === 'recycle' && (
        <td className="p-2 flex gap-1 justify-center items-center h-full" onClick={e => e.stopPropagation()}>
          <button onClick={() => onRestore(item.barcode)} className="h-8 px-4 text-xs font-bold uppercase tracking-wider rounded-sm focus:outline-none transition-colors hover:brightness-110 shadow-sm" style={{ backgroundColor: 'var(--color-success)', color: '#ffffff' }}>Restore</button>
        </td>
      )}
      </tr>
      {isExpanded && item.is_cuttable && (
        <tr>
          <td colSpan="10" className="p-0 border-b" style={{ borderColor: 'var(--border-medium)' }}>
            <StockInstancesModal isOpen={true} onClose={() => setIsExpanded(false)} item={item} />
          </td>
        </tr>
      )}
    </>
  );
}