import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import { Spinner } from './SharedUI';

export default function StockInstancesModal({ isOpen, onClose, item }) {
  const { showAlert, showConfirm } = useApp();
  const [instances, setInstances] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [addForm, setAddForm] = useState({ count: 1, length: '' });

  useEffect(() => {
    if (isOpen && item) {
      fetchInstances();
    }
  }, [isOpen, item]);

  const fetchInstances = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('stock_instances')
        .select('*')
        .eq('parent_barcode', item.barcode)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setInstances(data || []);
    } catch (err) {
      console.error(err);
      showAlert("Failed to load stock pieces.", "Error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddInstances = async (e) => {
    e.preventDefault();
    if (!addForm.length || addForm.count < 1) return;
    
    setIsAdding(true);
    try {
      // Find highest existing instance number for this item
      let maxNum = 0;
      instances.forEach(inst => {
        const parts = inst.instance_barcode.split('-');
        if (parts.length > 1) {
          const num = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      });

      const newInstances = Array.from({ length: addForm.count }).map((_, i) => {
        const nextNum = maxNum + i + 1;
        const paddedNum = nextNum.toString().padStart(3, '0');
        return {
          parent_barcode: item.barcode,
          instance_barcode: `${item.barcode}-${paddedNum}`,
          original_length: Number(addForm.length),
          current_length: Number(addForm.length),
          is_active: true
        };
      });

      const { error } = await supabase.from('stock_instances').insert(newInstances);
      if (error) throw error;
      
      showAlert(`Successfully generated ${addForm.count} new pieces!`, "Success");
      setAddForm({ count: 1, length: '' });
      fetchInstances();
    } catch (err) {
      console.error(err);
      showAlert(err.message, "Error");
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggleActive = async (instance) => {
    const action = instance.is_active ? "discard" : "restore";
    showConfirm(`Are you sure you want to ${action} this piece?`, async () => {
      try {
        const { error } = await supabase
          .from('stock_instances')
          .update({ is_active: !instance.is_active })
          .eq('id', instance.id);
        if (error) throw error;
        fetchInstances();
      } catch (err) {
        showAlert(err.message, "Error");
      }
    });
  };



  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[110] px-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="w-[95%] max-w-[700px] max-h-[90vh] flex flex-col shadow-xl animate-scale-in" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
        <div className="flex justify-between items-center p-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Manage Pieces: {item?.name}</h2>
          <button onClick={onClose} className="text-xl leading-none focus:outline-none hover:opacity-70" style={{ color: 'var(--text-secondary)' }}>✕</button>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {/* Add New Pieces Form */}
          <div className="p-4 mb-6" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)' }}>
            <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>Generate New Pieces</h3>
            <form onSubmit={handleAddInstances} className="flex flex-col md:flex-row gap-3 items-end">
              <div className="flex-1 w-full">
                <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-tertiary)' }}>Number of Pieces</label>
                <input type="number" min="1" max="50" value={addForm.count} onChange={(e) => setAddForm({...addForm, count: Number(e.target.value)})} className="w-full h-9 px-3 text-sm focus:outline-none" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} required />
              </div>
              <div className="flex-1 w-full">
                <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-tertiary)' }}>Length per Piece ({item?.unit})</label>
                <input type="number" step="any" min="0.1" value={addForm.length} onChange={(e) => setAddForm({...addForm, length: e.target.value})} className="w-full h-9 px-3 text-sm focus:outline-none" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} required />
              </div>
              <button type="submit" disabled={isAdding} className="h-9 px-6 text-sm font-bold text-white focus:outline-none whitespace-nowrap w-full md:w-auto" style={{ backgroundColor: 'var(--color-accent)' }}>
                {isAdding ? 'Adding...' : 'Generate Barcodes'}
              </button>
            </form>
          </div>

          {/* List of Pieces */}
          <div className="flex justify-between items-end mb-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Existing Pieces</h3>
          </div>
          
          {isLoading ? (
            <div className="flex justify-center p-8"><Spinner className="w-6 h-6 text-[var(--color-accent)]" /></div>
          ) : instances.length === 0 ? (
            <div className="text-center p-8 text-sm" style={{ color: 'var(--text-tertiary)' }}>No pieces recorded for this item yet.</div>
          ) : (
            <div className="overflow-x-auto" style={{ border: '1px solid var(--border-medium)' }}>
              <table className="w-full text-center whitespace-nowrap">
                <thead style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-light)' }}>
                  <tr className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    <th className="p-2 border-r border-[var(--border-light)]">Barcode</th>
                    <th className="p-2 border-r border-[var(--border-light)]">Original</th>
                    <th className="p-2 border-r border-[var(--border-light)]">Current</th>
                    <th className="p-2 border-r border-[var(--border-light)]">Status</th>
                    <th className="p-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {instances.map(inst => (
                    <tr key={inst.id} style={{ borderBottom: '1px solid var(--border-light)', backgroundColor: inst.is_active ? 'transparent' : 'var(--bg-hover)' }}>
                      <td className="p-2 text-xs font-mono font-bold" style={{ color: 'var(--color-accent)', borderRight: '1px solid var(--border-light)' }}>{inst.instance_barcode}</td>
                      <td className="p-2 text-sm" style={{ borderRight: '1px solid var(--border-light)' }}>{inst.original_length} {item.unit}</td>
                      <td className="p-2 text-sm font-bold" style={{ borderRight: '1px solid var(--border-light)', color: inst.current_length > 0 ? 'var(--text-primary)' : 'var(--color-error)' }}>{inst.current_length} {item.unit}</td>
                      <td className="p-2 text-xs" style={{ borderRight: '1px solid var(--border-light)' }}>
                        <span className={`px-2 py-0.5 rounded-sm font-bold uppercase tracking-wider text-[9px] ${inst.is_active ? 'bg-[var(--color-success)] text-white' : 'bg-[var(--color-error)] text-white'}`}>
                          {inst.is_active ? 'Active' : 'Discarded'}
                        </span>
                      </td>
                      <td className="p-2">
                        <button 
                          onClick={() => handleToggleActive(inst)} 
                          className="text-xs font-semibold px-2 py-1 focus:outline-none"
                          style={{ color: inst.is_active ? 'var(--color-error)' : 'var(--color-success)' }}
                        >
                          {inst.is_active ? 'Discard' : 'Restore'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
