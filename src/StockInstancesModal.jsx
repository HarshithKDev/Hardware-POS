import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import { Spinner } from './SharedUI';

export default function StockInstancesModal({ isOpen, onClose, item }) {
  const { showAlert, showConfirm } = useApp();
  const [instances, setInstances] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isOpen && item) {
      fetchInstances();
    }
  }, [isOpen, item]);

  const fetchInstances = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .rpc('get_stock_instances', { p_barcode: String(item.barcode) });
      
      if (error) throw error;
      setInstances(data || []);
    } catch (err) {
      console.error(err);
      showAlert("Failed to load stock pieces.", "Error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleActive = async (instance) => {
    const action = instance.is_active ? "discard" : "restore";
    showConfirm(`Are you sure you want to ${action} this piece?`, async () => {
      try {
        const { error } = await supabase
          .rpc('toggle_stock_instance', { 
            p_id: instance.id, 
            p_is_active: !instance.is_active 
          });
        if (error) throw error;
        fetchInstances();
      } catch (err) {
        showAlert(err.message, "Error");
      }
    });
  };

  return (
    <div className="p-4 flex flex-col shadow-inner animate-fade-in" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
      <div className="flex justify-between items-center bg-[var(--bg-tertiary)] p-4 shadow-sm border" style={{ borderColor: 'var(--border-medium)' }}>
        <h3 className="text-sm font-bold tracking-wider" style={{ color: 'var(--text-primary)' }}>MANAGE PIECES: {item.name.toUpperCase()}</h3>
        <button onClick={onClose} className="px-3 py-1.5 leading-none text-lg text-[var(--text-secondary)] hover:text-[var(--color-error)] transition-colors focus:outline-none">
          ✕
        </button>
      </div>

      <div className="p-6">
        <div className="w-full flex flex-col">
          <h4 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>EXISTING PIECES</h4>
          
          {isLoading ? (
            <div className="flex justify-center p-8"><Spinner className="w-5 h-5 text-[var(--color-accent)]" /></div>
          ) : instances.length === 0 ? (
            <div className="text-center p-8 text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>No pieces recorded yet.</div>
          ) : (
            <div className="overflow-x-auto shadow-sm" style={{ border: '1px solid var(--border-medium)' }}>
              <table className="w-full text-center whitespace-nowrap bg-[var(--bg-secondary)]">
                <thead style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-light)' }}>
                  <tr className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    <th className="p-2 border-r border-[var(--border-light)]">Barcode</th>
                    <th className="p-2 border-r border-[var(--border-light)]">{item.unit === 'SQFT' ? 'Orig Length' : 'Original'}</th>
                    <th className="p-2 border-r border-[var(--border-light)]">{item.unit === 'SQFT' ? 'Curr Length' : 'Current'}</th>
                    {item.unit === 'SQFT' && (
                      <>
                        <th className="p-2 border-r border-[var(--border-light)]">Height</th>
                        <th className="p-2 border-r border-[var(--border-light)]">Area</th>
                      </>
                    )}
                    <th className="p-2 border-r border-[var(--border-light)]">Status</th>
                    <th className="p-2 border-r border-[var(--border-light)]">Location</th>
                    <th className="p-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {instances.map(inst => (
                    <tr key={inst.id} style={{ borderBottom: '1px solid var(--border-light)', backgroundColor: inst.is_active ? 'transparent' : 'var(--bg-hover)' }}>
                      <td className="p-2 text-xs font-mono font-bold" style={{ color: 'var(--color-accent)', borderRight: '1px solid var(--border-light)' }}>{inst.instance_barcode}</td>
                      <td className="p-2 text-xs" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>{inst.original_length} {item.unit === 'SQFT' ? 'ft' : item.unit}</td>
                      <td className="p-2 text-xs font-bold" style={{ borderRight: '1px solid var(--border-light)', color: inst.current_length > 0 ? 'var(--text-primary)' : 'var(--color-error)' }}>{inst.current_length} {item.unit === 'SQFT' ? 'ft' : item.unit}</td>
                      {item.unit === 'SQFT' && (
                        <>
                          <td className="p-2 text-xs" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>{item.default_width || 0} ft</td>
                          <td className="p-2 text-xs font-bold" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>{(Number(inst.current_length) * Number(item.default_width || 0)).toFixed(2)} SQFT</td>
                        </>
                      )}
                      <td className="p-2 text-[9px] font-bold uppercase" style={{ borderRight: '1px solid var(--border-light)' }}>
                        <span className="px-2 py-0.5 rounded-sm" style={{ backgroundColor: inst.is_active ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: inst.is_active ? 'var(--color-success)' : 'var(--color-error)' }}>
                          {inst.is_active ? 'Active' : 'Scrap'}
                        </span>
                      </td>
                      <td className="p-2 text-xs font-semibold" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>
                        {inst.location || 'Warehouse'}
                      </td>
                      <td className="p-2">
                        <button 
                          onClick={() => handleToggleActive(inst)} 
                          className="text-[10px] font-bold uppercase px-2 py-1 focus:outline-none hover:underline"
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
