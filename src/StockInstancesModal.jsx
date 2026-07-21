import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import { Spinner } from './SharedUI';

export default function StockInstancesModal({ isOpen, onClose, item }) {
  const { showAlert, showConfirm } = useApp();
  const [instances, setInstances] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [discardModal, setDiscardModal] = useState({ isOpen: false, group: null, inputBarcode: '' });

  const [isMounting, setIsMounting] = useState(true);

  useEffect(() => {
    // Start animation on next frame
    const timer = setTimeout(() => setIsMounting(false), 10);
    return () => clearTimeout(timer);
  }, []);

  const fetchInstances = React.useCallback(async () => {
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
  }, [item, showAlert]);

  useEffect(() => {
    if (isOpen && item) {
      fetchInstances();
    }
  }, [isOpen, item, fetchInstances]);

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

  const handleDiscardClick = (group) => {
    if (group.count === 1) {
      handleToggleActive(group.instances[0]);
    } else {
      setDiscardModal({ isOpen: true, group, inputBarcode: '' });
    }
  };

  const confirmDiscardBarcode = () => {
    const { group, inputBarcode } = discardModal;
    const targetInst = group.instances.find(i => String(i.instance_barcode).toLowerCase() === String(inputBarcode).toLowerCase());
    if (!targetInst) {
      showAlert(`Barcode #${inputBarcode} not found in this specific group! Make sure you entered it correctly.`, "Not Found");
      return;
    }
    setDiscardModal({ isOpen: false, group: null, inputBarcode: '' });
    handleToggleActive(targetInst);
  };

  return (
    <div className={`w-full overflow-hidden transition-all duration-300 ease-in-out origin-top ${isMounting ? 'max-h-0 opacity-0 scale-y-95' : 'max-h-[1000px] opacity-100 scale-y-100'}`}>
      <div className="p-6 flex flex-col shadow-inner" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-bold tracking-wider" style={{ color: 'var(--text-primary)' }}>
            MANAGE PIECES: <span style={{ color: 'var(--color-accent)' }}>{item.name.toUpperCase()}</span>
          </h3>
          <button onClick={onClose} className="p-2 leading-none text-lg text-[var(--text-secondary)] hover:text-[var(--color-error)] transition-colors rounded-md focus:outline-none hover:bg-[var(--bg-secondary)]">
            ✕
          </button>
        </div>

        <div className="w-full flex flex-col">
          
          {isLoading ? (
            <div className="flex justify-center p-8"><Spinner className="w-5 h-5 text-[var(--color-accent)]" /></div>
          ) : instances.length === 0 ? (
            <div className="text-center p-8 text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>No pieces recorded yet.</div>
          ) : (
            <div className="overflow-x-auto shadow-sm rounded-lg" style={{ border: '1px solid var(--border-light)' }}>
              <table className="w-full text-center whitespace-nowrap" style={{ backgroundColor: 'var(--bg-primary)' }}>
                <thead style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)' }}>
                  <tr className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    <th className="p-2 border-r border-[var(--border-light)]">{item.unit === 'SQFT' ? 'Orig Length' : 'Original'}</th>
                    <th className="p-2 border-r border-[var(--border-light)]">{item.unit === 'SQFT' ? 'Curr Length' : 'Current'}</th>
                    {item.unit === 'SQFT' && (
                      <>
                        <th className="p-2 border-r border-[var(--border-light)]">Height</th>
                        <th className="p-2 border-r border-[var(--border-light)]">Area/Piece</th>
                      </>
                    )}
                    <th className="p-2 border-r border-[var(--border-light)]">Location</th>
                    <th className="p-2 border-r border-[var(--border-light)]">Quantity</th>
                    <th className="p-2 border-r border-[var(--border-light)]">Total {item.unit === 'SQFT' ? 'Area' : 'Length'}</th>
                    <th className="p-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(instances.filter(i => i.is_active).reduce((acc, inst) => {
                    const key = `${inst.original_length}_${inst.current_length}_${inst.location}`;
                    if (!acc[key]) acc[key] = { ...inst, instances: [], count: 0 };
                    acc[key].instances.push(inst);
                    acc[key].count += 1;
                    return acc;
                  }, {})).sort((a, b) => Number(b.current_length) - Number(a.current_length)).map(group => (
                    <tr key={`${group.original_length}_${group.current_length}_${group.location}`} style={{ borderBottom: '1px solid var(--border-light)', backgroundColor: 'transparent' }}>
                      <td className="p-2 text-xs" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>{group.original_length} {item.unit === 'SQFT' ? 'ft' : item.unit}</td>
                      <td className="p-2 text-xs font-bold" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>{group.current_length} {item.unit === 'SQFT' ? 'ft' : item.unit}</td>
                      {item.unit === 'SQFT' && (
                        <>
                          <td className="p-2 text-xs" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>{item.default_width || 0} ft</td>
                          <td className="p-2 text-xs font-bold" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>{(Number(group.current_length) * Number(item.default_width || 0)).toFixed(2)} SQFT</td>
                        </>
                      )}
                      <td className="p-2 text-xs font-semibold" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>
                        {group.location || 'Warehouse'}
                      </td>
                      <td className="p-2 text-xs font-bold" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--color-accent)' }}>
                        {group.count} PCS
                      </td>
                      <td className="p-2 text-xs font-bold" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                        {item.unit === 'SQFT' 
                          ? (Number(group.current_length) * Number(item.default_width || 0) * group.count).toFixed(2) + ' SQFT'
                          : (Number(group.current_length) * group.count).toFixed(2) + ' ' + (item.unit || '')}
                      </td>
                      <td className="p-2">
                        <button 
                          onClick={() => handleDiscardClick(group)} 
                          className="text-[10px] font-bold uppercase px-2 py-1 focus:outline-none hover:underline"
                          style={{ color: 'var(--color-error)' }}
                        >
                          Discard
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

      {/* Discard Barcode Prompt Modal */}
      {discardModal.isOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-[200] px-4 animate-fade-in" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="w-[85%] max-w-[420px] flex flex-col shadow-2xl animate-scale-in rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
            <div className="flex justify-between items-center pr-2 pl-5 py-4" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-light)' }}>
              <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Discard Piece</span>
              <button type="button" onClick={() => setDiscardModal({ isOpen: false, group: null, inputBarcode: '' })} className="p-2 leading-none focus:outline-none rounded-md text-[var(--text-secondary)] hover:text-[var(--color-error)] transition-colors">✕</button>
            </div>
            <div className="p-6">
              <p className="text-sm mb-5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>You are discarding one piece of <strong style={{ color: 'var(--text-primary)' }}>{discardModal.group?.current_length} {item.unit === 'SQFT' ? 'ft' : item.unit}</strong>.</p>
              <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Scan or Enter Barcode</p>
              <input 
                type="text" 
                autoFocus 
                value={discardModal.inputBarcode} 
                onChange={e => setDiscardModal({ ...discardModal, inputBarcode: e.target.value })} 
                onKeyDown={e => { if (e.key === 'Enter' && discardModal.inputBarcode) confirmDiscardBarcode(); }} 
                className="w-full h-12 px-4 text-lg font-mono focus:outline-none rounded-md transition-all focus:ring-1 focus:border-transparent" 
                style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)', '--tw-ring-color': 'var(--color-error)' }} 
                placeholder="e.g. 1006-123456" 
              />
            </div>
            <div className="p-4 flex justify-end gap-3" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
              <button type="button" onClick={() => setDiscardModal({ isOpen: false, group: null, inputBarcode: '' })} className="h-10 px-6 text-sm font-semibold focus:outline-none rounded-md transition-colors" style={{ color: 'var(--text-primary)', backgroundColor: 'transparent' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>Cancel</button>
              <button type="button" disabled={!discardModal.inputBarcode} onClick={confirmDiscardBarcode} className="h-10 px-8 text-white text-sm font-semibold focus:outline-none rounded-md disabled:opacity-50 transition-colors hover:bg-red-600" style={{ backgroundColor: 'var(--color-error)' }}>Discard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
