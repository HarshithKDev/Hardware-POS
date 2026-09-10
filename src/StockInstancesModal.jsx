import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Barcode from 'react-barcode';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import { Spinner } from './SharedUI';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export default function StockInstancesModal({ isOpen, onClose, item }) {
  const { showAlert, showConfirm } = useApp();
  const [discardModal, setDiscardModal] = useState({ isOpen: false, group: null, inputBarcode: '' });
  const [printModal, setPrintModal] = useState({ isOpen: false, group: null, qty: 1 });
  const [isPrinting, setIsPrinting] = useState(false);
  const queryClient = useQueryClient();

  const [isMounting, setIsMounting] = useState(true);

  useEffect(() => {
    // Start animation on next frame
    const timer = setTimeout(() => setIsMounting(false), 10);
    return () => clearTimeout(timer);
  }, []);

  const { data: instances = [], isLoading } = useQuery({
    queryKey: ['stock_instances', item.barcode],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_stock_instances', { p_barcode: String(item.barcode) });
      if (error) throw error;
      return data || [];
    },
    enabled: !!(isOpen && item),
    staleTime: 60 * 1000,
  });

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
        showAlert(`Piece ${action}ed successfully.`, "Success");
        queryClient.invalidateQueries({ queryKey: ['stock_instances', item.barcode] });
        queryClient.invalidateQueries({ queryKey: ['piece_counts', item.barcode] });
      } catch (err) {
        console.error(err);
        showAlert(`Failed to ${action} piece.`, "Error");
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

  const handlePrintClick = (group) => {
    setPrintModal({ isOpen: true, group, qty: 1 });
  };

  const confirmPrint = () => {
    setIsPrinting(true);
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
      setPrintModal({ isOpen: false, group: null, qty: 1 });
    }, 500);
  };

  return (
    <>
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
                      <td className="p-2 flex gap-1 justify-center">
                        <button 
                          onClick={() => handlePrintClick(group)} 
                          className="p-1.5 rounded-md transition-colors hover:bg-[var(--color-accent-bg)] cursor-pointer text-[var(--color-accent)]"
                          title="Print Barcode"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0v-2.94a2.25 2.25 0 012.25-2.25h6a2.25 2.25 0 012.25 2.25v2.94z" />
                          </svg>
                        </button>
                        <button 
                          onClick={() => handleDiscardClick(group)} 
                          className="p-1.5 rounded-md transition-colors hover:bg-red-50 text-red-500 cursor-pointer"
                          title="Discard Piece"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
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
      {discardModal.isOpen && createPortal(
        <div className="fixed inset-0 flex items-center justify-center z-[200] px-4 animate-fade-in" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="w-[85%] max-w-[420px] flex flex-col rounded-xl overflow-hidden animate-scale-in border border-[var(--border-light)] shadow-2xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
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
        </div>,
        document.body
      )}

      {/* Print Preview Modal */}
      {printModal.isOpen && printModal.group && createPortal(
        <div className="fixed inset-0 flex items-center justify-center z-[300] px-4 animate-fade-in" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="w-[90%] max-w-[450px] rounded-xl overflow-hidden flex flex-col shadow-2xl bg-[var(--bg-secondary)] border border-[var(--border-light)]">
            <div className="flex justify-between items-center px-5 py-3 border-b border-[var(--border-light)]">
              <h2 className="text-sm font-bold text-[var(--text-primary)]">Print Labels: {item.name}</h2>
              <button onClick={() => setPrintModal({ isOpen: false, group: null, qty: 1 })} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">✕</button>
            </div>
            
            <div className="p-5 flex flex-col gap-5">
              {/* Visual Preview */}
              <div className="flex flex-col items-center justify-center p-4 bg-white border border-[var(--border-medium)] rounded-lg mx-auto w-[250px] shadow-sm">
                <p className="text-[10px] font-bold text-black mb-1 w-full text-center truncate">
                  {item.name} ({printModal.group.current_length} {item.unit === 'SQFT' ? 'ft' : item.unit})
                </p>
                <Barcode 
                  value={printModal.group.instances[0].instance_barcode} 
                  width={1.5} 
                  height={30} 
                  fontSize={12} 
                  margin={0} 
                  displayValue={true} 
                  lineColor="#000000" 
                  background="#ffffff" 
                />
                <p className="text-xs font-bold text-black mt-1">₹{Number(item.price).toFixed(2)}</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1 uppercase tracking-wider">Labels Per Piece</label>
                <input 
                  type="number" 
                  value={printModal.qty} 
                  onChange={e => setPrintModal({ ...printModal, qty: Number(e.target.value) })}
                  className="w-full h-10 px-3 rounded-md bg-[var(--bg-input)] border border-[var(--border-medium)] text-sm font-bold focus:outline-none focus:border-[var(--color-accent)]"
                  min="1"
                  max="100"
                />
              </div>

              <div className="mt-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)] p-3 rounded-md border border-[var(--border-light)]">
                <p><strong>Note:</strong> This will print <strong>{printModal.qty}</strong> label(s) for EACH of the <strong>{printModal.group.instances.length}</strong> piece(s) in this group, yielding a total of <strong>{printModal.qty * printModal.group.instances.length}</strong> labels.</p>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-[var(--border-light)] bg-[var(--bg-tertiary)] flex justify-end gap-3">
              <button 
                onClick={() => setPrintModal({ isOpen: false, group: null, qty: 1 })}
                className="px-4 py-2 text-sm font-semibold rounded-md border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
              <button 
                onClick={confirmPrint}
                disabled={isPrinting}
                className="px-6 py-2 text-sm font-bold rounded-md text-white shadow-sm flex items-center gap-2 transition-all hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-accent)' }}
              >
                {isPrinting ? 'Printing...' : 'Print Labels'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Hidden container for printing */}
      {isPrinting && printModal.group && createPortal(
        <div id="printable-barcodes" className="absolute -top-[9999px] left-0 opacity-0 pointer-events-none print:static print:opacity-100 print:pointer-events-auto" style={{ backgroundColor: '#ffffff', margin: 0, padding: 0 }}>
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              @page { size: 50mm 25mm; margin: 0 !important; }
              body { margin: 0 !important; padding: 0 !important; }
              #printable-barcodes { display: block !important; margin: 0 !important; padding: 0 !important; }
            }
          `}} />
          {printModal.group.instances.flatMap((inst, instIndex) => 
            Array.from({ length: printModal.qty || 1 }).map((_, qtyIndex) => (
              <div key={`${inst.instance_barcode}-${instIndex}-${qtyIndex}`} className="thermal-barcode" style={{ backgroundColor: '#ffffff', width: '50mm', height: '25mm', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', pageBreakAfter: 'always' }}>
                <p style={{ color: '#000000', fontSize: '9px', fontWeight: 'bold', lineHeight: 1, margin: 0, marginBottom: '2px', textAlign: 'center', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.name} ({inst.current_length} {item.unit === 'SQFT' ? 'ft' : item.unit})
                </p>
                <Barcode value={inst.instance_barcode} width={1.25} height={24} fontSize={10} margin={0} displayValue={true} lineColor="#000000" background="#ffffff" />
                <p style={{ color: '#000000', fontSize: '10px', fontWeight: 'bold', lineHeight: 1, margin: 0, marginTop: '2px' }}>₹{Number(item.price).toFixed(2)}</p>
              </div>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
    </>
  );
}
