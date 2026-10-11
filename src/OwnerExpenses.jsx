import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import { generateId } from './utils';
import { 
  Receipt, 
  Plus, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  Copy,
  X,
  RotateCcw
} from 'lucide-react';
import { Spinner, PageLoader } from './SharedUI';



const LOCAL_STORAGE_KEY = 'hardware_pos_expenses';

export default function OwnerExpenses({ isOwner = false, cashierName: propCashierName }) {
  const { cashierName: appCashierName, userRole, showAlert, showConfirm } = useApp();
  const currentCashier = propCashierName || appCashierName || (userRole === 'owner' ? 'Owner' : 'Staff');

  const [expenses, setExpenses] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDbConnected, setIsDbConnected] = useState(true);
  const [showSqlHelp, setShowSqlHelp] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // New Expense Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [customWorkerName, setCustomWorkerName] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  // Return Modal State (Supports Full or Partial Return)
  const [returnModalItem, setReturnModalItem] = useState(null);
  const [returnAmountInput, setReturnAmountInput] = useState('');
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false);



  // 1. Fetch Workers
  useEffect(() => {
    async function fetchWorkers() {
      try {
        const { data, error } = await supabase
          .from('workers')
          .select('id, name')
          .order('name', { ascending: true });
        if (data && !error) {
          setWorkers(data);
        }
      } catch (err) {
        console.warn('Failed to fetch workers:', err);
      }
    }
    fetchWorkers();
  }, []);

  // 2. Fetch Expenses (Supabase with localStorage fallback)
  const fetchExpenses = async () => {
    setIsLoading(true);
    let remoteData = null;
    let dbSuccess = false;

    try {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        remoteData = data;
        dbSuccess = true;
        setIsDbConnected(true);
      } else {
        setIsDbConnected(false);
      }
    } catch {
      setIsDbConnected(false);
    }

    // Load from local storage
    const localRaw = localStorage.getItem(LOCAL_STORAGE_KEY);
    let localData = [];
    if (localRaw) {
      try {
        localData = JSON.parse(localRaw);
      } catch (e) {
        console.error(e);
      }
    }

    if (dbSuccess && remoteData) {
      // Parse return metadata (supports both native columns and notes JSON storage)
      const parsedRemote = remoteData.map(row => {
        let status = row.status || 'PENDING';
        let returned_amount = Number(row.returned_amount) || 0;
        let returned_at = row.returned_at || null;
        let returned_by = row.returned_by || null;

        let cleanNotes = row.notes;
        // Check if metadata was encoded in notes
        if (row.notes) {
          try {
            const meta = JSON.parse(row.notes);
            if (meta && typeof meta === 'object') {
              if (meta.status) status = meta.status;
              if (meta.returned_amount !== undefined) returned_amount = Number(meta.returned_amount) || 0;
              if (meta.returned_at) returned_at = meta.returned_at;
              if (meta.returned_by) returned_by = meta.returned_by;
              cleanNotes = null;
            }
          } catch {}
        }

        const total = Number(row.amount) || 0;
        if (returned_amount >= total && total > 0) {
          status = 'RETURNED';
        } else if (returned_amount > 0) {
          status = 'PARTIAL';
        }

        return {
          ...row,
          notes: cleanNotes,
          status,
          returned_amount,
          returned_at,
          returned_by
        };
      });

      // Merge with local storage so local returns are never prematurely wiped
      const localMap = new Map(localData.map(item => [item.id, item]));
      const finalExpenses = parsedRemote.map(remoteItem => {
        const localItem = localMap.get(remoteItem.id);
        if (localItem) {
          const localRet = Number(localItem.returned_amount) || 0;
          const remoteRet = Number(remoteItem.returned_amount) || 0;
          if (localRet > remoteRet) {
            return {
              ...remoteItem,
              ...localItem
            };
          }
        }
        return remoteItem;
      });

      setExpenses(finalExpenses);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(finalExpenses));
    } else {
      setExpenses(localData);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchExpenses();
  }, []);

  // Handle Save Expense
  const handleSaveExpense = async (e) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      showAlert('Please enter a valid positive amount.', 'Invalid Amount');
      return;
    }

    if (!reason.trim()) {
      showAlert('Please enter a reason or purpose for this advance.', 'Reason Required');
      return;
    }

    let finalWorkerName = 'General Shop';
    let finalWorkerId = null;

    if (selectedWorkerId === 'GENERAL') {
      finalWorkerName = customWorkerName.trim() || 'General Shop';
    } else if (selectedWorkerId) {
      const found = workers.find(w => w.id === selectedWorkerId);
      if (found) {
        finalWorkerName = found.name;
        finalWorkerId = found.id;
      }
    } else {
      showAlert('Please select a worker or choose General Shop.', 'Worker Required');
      return;
    }

    setIsSaving(true);

    const newExpense = {
      id: generateId(),
      worker_id: finalWorkerId,
      worker_name: finalWorkerName,
      amount: numAmount,
      reason: reason.trim(),
      status: 'PENDING',
      notes: null,
      recorded_by: currentCashier,
      created_at: new Date().toISOString()
    };

    try {
      // 1. Try Supabase insert
      try {
        const { error } = await supabase.from('expenses').insert([newExpense]);
        if (error) {
          // If status or returned_amount columns don't exist in Supabase, insert without them
          const { status, returned_amount, ...compatibleExpense } = newExpense;
          await supabase.from('expenses').insert([compatibleExpense]);
        }
      } catch {
        // Fallback
      }

      // 2. Also log to audit_logs
      try {
        await supabase.from('audit_logs').insert([{
          action_type: 'EXPENSE',
          barcode: 'CASH',
          item_name: finalWorkerName,
          changes: `Advance: ₹${numAmount} given to ${finalWorkerName} for "${reason.trim()}"`,
          performed_by: currentCashier
        }]);
      } catch (auditErr) {
        console.warn('Audit log write error:', auditErr);
      }

      // 3. Save locally in state & localStorage
      const updatedExpenses = [newExpense, ...expenses];
      setExpenses(updatedExpenses);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedExpenses));

      showAlert(`Recorded ₹${numAmount.toFixed(2)} given to ${finalWorkerName}.`, 'Recorded');

      // Reset form
      setAmount('');
      setReason('');
      setSelectedWorkerId('');
      setCustomWorkerName('');
      setIsModalOpen(false);
    } catch (err) {
      showAlert(err.message || 'Failed to record advance.', 'Error');
    } finally {
      setIsSaving(false);
    }
  };

  // Open Return Modal (pre-fills remaining balance)
  const handleOpenReturnModal = (item) => {
    const total = Number(item.amount) || 0;
    const alreadyReturned = Number(item.returned_amount) || (item.status === 'RETURNED' ? total : 0);
    const remaining = Math.max(0, total - alreadyReturned);

    setReturnModalItem(item);
    setReturnAmountInput(remaining > 0 ? String(remaining) : String(total));
  };

  // Confirm Return (Full or Partial)
  const handleConfirmReturn = async (e) => {
    e.preventDefault();
    if (!returnModalItem) return;

    const returnAmt = parseFloat(returnAmountInput);
    if (isNaN(returnAmt) || returnAmt <= 0) {
      showAlert('Please enter a valid amount to return.', 'Invalid Amount');
      return;
    }

    const total = Number(returnModalItem.amount) || 0;
    const prevReturned = Number(returnModalItem.returned_amount) || (returnModalItem.status === 'RETURNED' ? total : 0);
    const remainingBefore = Math.max(0, total - prevReturned);

    if (returnAmt > remainingBefore) {
      showAlert(`Return amount cannot exceed remaining due (₹${remainingBefore.toFixed(2)}).`, 'Exceeds Balance');
      return;
    }

    const newReturnedTotal = prevReturned + returnAmt;
    const isFull = newReturnedTotal >= total;
    const newStatus = isFull ? 'RETURNED' : 'PARTIAL';

    setIsSubmittingReturn(true);

    const updatedItem = {
      ...returnModalItem,
      notes: null,
      returned_amount: newReturnedTotal,
      status: newStatus,
      returned_at: new Date().toISOString(),
      returned_by: currentCashier
    };

    const returnMeta = {
      status: newStatus,
      returned_amount: newReturnedTotal,
      returned_at: updatedItem.returned_at,
      returned_by: updatedItem.returned_by
    };

    try {
      // 1. Try Supabase update (saves in notes JSON as guaranteed fallback + native columns)
      try {
        const metaJson = JSON.stringify(returnMeta);
        const { error } = await supabase
          .from('expenses')
          .update({
            notes: metaJson,
            returned_amount: newReturnedTotal,
            status: newStatus,
            returned_at: updatedItem.returned_at,
            returned_by: updatedItem.returned_by
          })
          .eq('id', returnModalItem.id);

        if (error) {
          // If native columns don't exist in Supabase, update notes JSON alone
          await supabase
            .from('expenses')
            .update({
              notes: metaJson
            })
            .eq('id', returnModalItem.id);
        }
      } catch (err) {
        console.warn('Supabase return update fallback:', err);
      }

      // 2. Log to audit_logs
      try {
        const remainingAfter = Math.max(0, total - newReturnedTotal);
        await supabase.from('audit_logs').insert([{
          action_type: 'UPDATE',
          barcode: 'CASH',
          item_name: returnModalItem.worker_name,
          changes: `Returned ₹${returnAmt.toFixed(2)} by ${returnModalItem.worker_name}. Total paid: ₹${newReturnedTotal.toFixed(2)} / ₹${total.toFixed(2)}. ${isFull ? 'Fully Settled' : `Remaining due: ₹${remainingAfter.toFixed(2)}`}`,
          performed_by: currentCashier
        }]);
      } catch {}

      // 3. Save locally in state & localStorage
      const updatedList = expenses.map(e => e.id === returnModalItem.id ? updatedItem : e);
      setExpenses(updatedList);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedList));

      showAlert(
        isFull
          ? `Full advance of ₹${total.toFixed(2)} marked as returned by ${returnModalItem.worker_name}.`
          : `Partial return of ₹${returnAmt.toFixed(2)} recorded. Remaining due: ₹${(total - newReturnedTotal).toFixed(2)}.`,
        'Return Recorded'
      );

      setReturnModalItem(null);
      setReturnAmountInput('');
    } catch (err) {
      showAlert(err.message || 'Failed to record return', 'Error');
    } finally {
      setIsSubmittingReturn(false);
    }
  };

  // Revert Return back to Pending
  const handleRevertReturn = (item) => {
    showConfirm(
      `Revert all returned money for ${item.worker_name} back to Pending?`,
      async () => {
        const updatedItem = {
          ...item,
          returned_amount: 0,
          status: 'PENDING',
          returned_at: null,
          returned_by: null
        };

        try {
          try {
            const { error } = await supabase
              .from('expenses')
              .update({
                notes: null,
                returned_amount: 0,
                status: 'PENDING',
                returned_at: null,
                returned_by: null
              })
              .eq('id', item.id);

            if (error) {
              await supabase
                .from('expenses')
                .update({ notes: null })
                .eq('id', item.id);
            }
          } catch {}

          try {
            await supabase.from('audit_logs').insert([{
              action_type: 'UPDATE',
              barcode: 'CASH',
              item_name: item.worker_name,
              changes: `Reverted returns for ${item.worker_name}. Status set back to PENDING.`,
              performed_by: currentCashier
            }]);
          } catch {}

          const updatedList = expenses.map(e => e.id === item.id ? updatedItem : e);
          setExpenses(updatedList);
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedList));

          showAlert(`Returns reverted for ${item.worker_name}. Advance is now Pending.`, 'Reverted');
        } catch (err) {
          showAlert(err.message || 'Failed to revert', 'Error');
        }
      },
      'Revert Return',
      'Revert',
      'Cancel',
      true
    );
  };

  // Handle Delete Expense
  const handleDeleteExpense = (expenseItem) => {
    showConfirm(
      `Are you sure you want to delete this record of ₹${expenseItem.amount} for ${expenseItem.worker_name}?`,
      async () => {
        try {
          try {
            await supabase.from('expenses').delete().eq('id', expenseItem.id);
          } catch {}

          try {
            await supabase.from('audit_logs').insert([{
              action_type: 'VOID',
              barcode: 'CASH',
              item_name: expenseItem.worker_name,
              changes: `Deleted Expense: ₹${expenseItem.amount} for "${expenseItem.reason}"`,
              performed_by: currentCashier
            }]);
          } catch {}

          const updated = expenses.filter(e => e.id !== expenseItem.id);
          setExpenses(updated);
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
          showAlert('Expense record removed.', 'Deleted');
        } catch (err) {
          showAlert(err.message || 'Failed to remove expense', 'Error');
        }
      },
      'Confirm Delete',
      'Delete',
      'Cancel',
      true
    );
  };



  const sqlSnippet = `CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID REFERENCES public.workers(id) ON DELETE SET NULL,
    worker_name TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    returned_amount NUMERIC DEFAULT 0,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING',
    returned_at TIMESTAMPTZ,
    returned_by TEXT,
    notes TEXT,
    recorded_by TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS returned_amount NUMERIC DEFAULT 0;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on expenses" ON public.expenses FOR ALL USING (true) WITH CHECK (true);`;

  const copySql = () => {
    navigator.clipboard.writeText(sqlSnippet);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden p-2 md:p-4 gap-4 animate-fade-in" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Top Title Bar */}
      <div className="flex items-center justify-between gap-3 p-3 md:p-4 rounded-xl shadow-sm border border-[var(--border-light)]" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <div className="flex items-center gap-2.5 md:gap-3">
          <div className="p-2 md:p-2.5 rounded-lg bg-[var(--color-accent-bg)] text-[var(--color-accent)] shrink-0">
            <Receipt size={20} className="md:w-[22px] md:h-[22px]" />
          </div>
          <h1 className="text-lg md:text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Expenses
          </h1>
        </div>

        <div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-3.5 py-2 md:px-5 md:py-2.5 rounded-lg text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 md:gap-2 text-white shadow-md transition-all active:scale-95 shrink-0"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            <Plus size={15} strokeWidth={3} />
            <span>Record Advance</span>
          </button>
        </div>
      </div>

      {/* Cloud DB Notice if table not yet in Supabase */}
      {!isDbConnected && (
        <div className="p-3.5 rounded-xl border border-blue-500/30 bg-blue-500/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 text-blue-400 font-medium">
            <AlertCircle size={18} className="shrink-0" />
            <span>
              <strong>Local Mode Active:</strong> Expenses are saving locally & logged to Audit Logs. To enable full cloud sync across devices, run the 1-click SQL table snippet in your Supabase SQL Editor.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={copySql}
              className="px-3 py-1.5 rounded-lg font-bold bg-[var(--color-accent)] text-white flex items-center gap-1.5 transition-transform active:scale-95"
            >
              <Copy size={13} />
              {copiedSql ? 'Copied SQL!' : 'Copy SQL Script'}
            </button>
            <button
              onClick={() => setShowSqlHelp(!showSqlHelp)}
              className="px-2.5 py-1.5 rounded-lg font-bold border border-blue-500/40 text-blue-300 hover:bg-blue-500/20"
            >
              {showSqlHelp ? 'Hide SQL' : 'View SQL'}
            </button>
          </div>
        </div>
      )}

      {showSqlHelp && (
        <div className="p-4 rounded-xl bg-black/60 border border-[var(--border-light)] text-xs font-mono relative">
          <button onClick={() => setShowSqlHelp(false)} className="absolute top-3 right-3 text-gray-400 hover:text-white">
            <X size={16} />
          </button>
          <p className="text-[var(--color-accent)] font-bold mb-2">Paste this in your Supabase SQL Editor:</p>
          <pre className="p-3 bg-zinc-900 rounded text-emerald-400 overflow-x-auto text-[11px] leading-relaxed">
            {sqlSnippet}
          </pre>
        </div>
      )}

      {/* Main Container */}
      <div className="flex-1 rounded-xl border border-[var(--border-light)] overflow-hidden flex flex-col shadow-sm" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <PageLoader text="Loading expenses..." />
          </div>
        ) : expenses.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
              <Receipt size={32} />
            </div>
            <h3 className="text-base font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-primary)' }}>
              No Expenses Recorded
            </h3>
            <p className="text-xs font-medium max-w-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              No expenses or advances have been recorded yet. Click below to add one.
            </p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-white shadow"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              + Record Advance
            </button>
          </div>
        ) : (
          <>
            {/* Mobile Card List (md:hidden) */}
            <div className="md:hidden flex-1 overflow-y-auto p-3 space-y-3">
              {expenses.map((exp) => {
                const d = new Date(exp.created_at);
                const totalAmt = Number(exp.amount) || 0;
                const returnedAmt = Number(exp.returned_amount) || (exp.status === 'RETURNED' ? totalAmt : 0);
                const remainingAmt = Math.max(0, totalAmt - returnedAmt);
                const isFullReturn = exp.status === 'RETURNED' || (returnedAmt >= totalAmt && totalAmt > 0);
                const isPartialReturn = !isFullReturn && returnedAmt > 0;

                return (
                  <div
                    key={exp.id}
                    className="rounded-xl border border-[var(--border-light)] p-3.5 flex flex-col gap-2.5 shadow-sm"
                    style={{ backgroundColor: 'var(--bg-tertiary)' }}
                  >
                    {/* Worker & Status */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                        {exp.worker_name || 'General Shop'}
                      </span>
                      <div className="shrink-0">
                        {isFullReturn ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-bold rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle size={11} />
                            <span>Returned</span>
                          </span>
                        ) : isPartialReturn ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-bold rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20" title={`₹${returnedAmt.toFixed(2)} returned of ₹${totalAmt.toFixed(2)}`}>
                            <Clock size={11} />
                            <span>Partial</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-bold rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                            <Clock size={11} />
                            <span>Pending</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Amount & Reason */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-black" style={{ color: isFullReturn ? 'var(--text-primary)' : 'var(--color-accent)' }}>
                          ₹{totalAmt.toFixed(2)}
                        </div>
                        {isPartialReturn && (
                          <div className="text-[11px] font-bold text-amber-400 mt-0.5">
                            Due: ₹{remainingAmt.toFixed(2)}
                          </div>
                        )}
                      </div>
                      <div className="text-right flex-1 min-w-0">
                        <span className="text-xs font-semibold block truncate" style={{ color: 'var(--text-secondary)' }} title={exp.reason}>
                          {exp.reason}
                        </span>
                      </div>
                    </div>

                    {/* Date / Time & Given By */}
                    <div className="flex items-center justify-between text-[11px] pt-2 border-t border-[var(--border-light)]" style={{ color: 'var(--text-tertiary)' }}>
                      <span>
                        {d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })} • {d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </span>
                      <span>
                        By: <strong style={{ color: 'var(--text-secondary)' }}>{exp.recorded_by || 'Staff'}</strong>
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-1">
                      {!isFullReturn && (
                        <button
                          onClick={() => handleOpenReturnModal(exp)}
                          className="flex-1 h-9 px-3 text-xs font-bold rounded-lg text-white shadow-sm transition-all active:scale-95 flex items-center justify-center gap-1.5"
                          style={{ backgroundColor: 'var(--color-accent)' }}
                        >
                          <CheckCircle size={14} />
                          <span>{isPartialReturn ? 'Add Return' : 'Mark Returned'}</span>
                        </button>
                      )}

                      {(isFullReturn || isPartialReturn) && (
                        <button
                          onClick={() => handleRevertReturn(exp)}
                          className={`h-9 px-3 text-xs font-semibold rounded-lg border border-[var(--border-medium)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-white transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-95 ${isFullReturn ? 'flex-1' : ''}`}
                          title="Revert returns back to Pending"
                        >
                          <RotateCcw size={13} />
                          <span>Revert</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table (hidden md:block) */}
            <div className="hidden md:block flex-1 overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-[850px] text-left border-collapse table-fixed">
                <thead className="sticky top-0 z-10 text-[11px] font-bold uppercase tracking-wider border-b border-[var(--border-medium)]" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                  <tr>
                    <th className="p-3.5 w-40 text-left">Date & Time</th>
                    <th className="p-3.5 w-44 text-left">Worker</th>
                    <th className="p-3.5 text-left">Reason / Purpose</th>
                    <th className="p-3.5 w-36 text-center">Amount</th>
                    <th className="p-3.5 w-36 text-center">Given By</th>
                    <th className="p-3.5 w-36 text-center">Status</th>
                    <th className="p-3.5 w-60 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-light)] text-xs font-medium">
                  {expenses.map((exp) => {
                    const d = new Date(exp.created_at);
                    const totalAmt = Number(exp.amount) || 0;
                    const returnedAmt = Number(exp.returned_amount) || (exp.status === 'RETURNED' ? totalAmt : 0);
                    const remainingAmt = Math.max(0, totalAmt - returnedAmt);
                    const isFullReturn = exp.status === 'RETURNED' || (returnedAmt >= totalAmt && totalAmt > 0);
                    const isPartialReturn = !isFullReturn && returnedAmt > 0;

                    return (
                      <tr key={exp.id} className="hover:bg-[var(--bg-hover)] transition-colors">
                        {/* Date & Time */}
                        <td className="p-3.5 w-40 text-left whitespace-nowrap">
                          <div className="font-bold" style={{ color: 'var(--text-primary)' }}>
                            {d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
                          </div>
                          <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                            {d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })}
                          </div>
                        </td>

                        {/* Worker */}
                        <td className="p-3.5 w-44 text-left whitespace-nowrap">
                          <span className="font-bold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                            {exp.worker_name || 'General Shop'}
                          </span>
                        </td>

                        {/* Reason */}
                        <td className="p-3.5 text-left">
                          <span className="font-bold truncate" style={{ color: 'var(--text-primary)' }} title={exp.reason}>
                            {exp.reason}
                          </span>
                        </td>

                        {/* Amount */}
                        <td className="p-3.5 w-36 text-center whitespace-nowrap font-bold">
                          <div className="text-base font-bold" style={{ color: isFullReturn ? 'var(--text-primary)' : 'var(--color-accent)' }}>
                            ₹{totalAmt.toFixed(2)}
                          </div>
                          {isPartialReturn && (
                            <div className="text-[11px] font-semibold text-amber-400 mt-0.5">
                              Due: ₹{remainingAmt.toFixed(2)}
                            </div>
                          )}
                        </td>

                        {/* Given By */}
                        <td className="p-3.5 w-36 text-center whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          {exp.recorded_by || 'Staff'}
                        </td>

                        {/* Status */}
                        <td className="p-3.5 w-36 text-center whitespace-nowrap">
                          {isFullReturn ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                              <CheckCircle size={12} />
                              <span>Returned</span>
                            </span>
                          ) : isPartialReturn ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20" title={`₹${returnedAmt.toFixed(2)} returned of ₹${totalAmt.toFixed(2)}`}>
                              <Clock size={12} />
                              <span>Partial</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                              <Clock size={12} />
                              <span>Pending</span>
                            </span>
                          )}
                        </td>

                        {/* Action */}
                        <td className="p-3.5 w-60 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-2">
                            {!isFullReturn && (
                              <button
                                onClick={() => handleOpenReturnModal(exp)}
                                className="h-8 px-3 text-xs font-bold rounded-lg text-white shadow-sm transition-all active:scale-95 hover:opacity-90 flex items-center gap-1.5 shrink-0"
                                style={{ backgroundColor: 'var(--color-accent)' }}
                              >
                                <CheckCircle size={14} />
                                <span>{isPartialReturn ? 'Add Return' : 'Mark Returned'}</span>
                              </button>
                            )}

                            {(isFullReturn || isPartialReturn) && (
                              <button
                                onClick={() => handleRevertReturn(exp)}
                                className="h-8 px-3 text-xs font-semibold rounded-lg border border-[var(--border-medium)] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-white transition-all flex items-center gap-1.5 shadow-sm active:scale-95 shrink-0"
                                title="Revert returns back to Pending"
                              >
                                <RotateCcw size={13} />
                                <span>Revert</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Record Advance Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-medium)] shadow-2xl overflow-hidden flex flex-col" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            {/* Header */}
            <div className="p-4 flex justify-between items-center border-b border-[var(--border-light)]" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
                  <Receipt size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Record Money Given</h2>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Logged by: <strong>{currentCashier}</strong></p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[var(--bg-hover)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveExpense} className="p-5 flex flex-col gap-4">
              {/* 1. Worker Selection */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Who is taking the money? <span className="text-[var(--color-accent)]">*</span>
                </label>
                <select
                  value={selectedWorkerId}
                  onChange={(e) => setSelectedWorkerId(e.target.value)}
                  required
                  className="w-full h-10 px-3 text-sm font-semibold rounded-lg bg-[var(--bg-input)] text-[var(--text-input)] border border-[var(--border-input)] focus:outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="" disabled>-- Select Worker / Staff Member --</option>
                  {workers.map(w => (
                    <option key={w.id} value={w.id}>
                      {w.name} (Staff)
                    </option>
                  ))}
                  <option value="GENERAL">General Shop Expense (No Worker)</option>
                </select>
              </div>

              {/* Custom Name if General */}
              {selectedWorkerId === 'GENERAL' && (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    Expense Payee / Description
                  </label>
                  <input
                    type="text"
                    value={customWorkerName}
                    onChange={(e) => setCustomWorkerName(e.target.value)}
                    placeholder="e.g. Tea stall, Electrician, Auto / Tempo driver"
                    className="w-full h-10 px-3 text-sm rounded-lg bg-[var(--bg-input)] text-[var(--text-input)] border border-[var(--border-input)] focus:outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
              )}

              {/* 2. Amount Input */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Amount Taken (₹) <span className="text-[var(--color-accent)]">*</span>
                </label>
                <div className="flex items-center rounded-lg bg-[var(--bg-input)] border border-[var(--border-input)] focus-within:border-[var(--color-accent)] transition-colors px-3 h-11">
                  <span className="text-base font-bold text-[var(--color-accent)] mr-2 select-none shrink-0">₹</span>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    required
                    autoFocus
                    style={{ outline: 'none', border: 'none', boxShadow: 'none' }}
                    className="w-full h-full bg-transparent text-base font-bold text-[var(--text-input)] placeholder:text-[var(--text-tertiary)] p-0"
                  />
                </div>
              </div>

              {/* 3. Reason */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Reason / Purpose <span className="text-[var(--color-accent)]">*</span>
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Lunch advance, Petrol for delivery, Emergency"
                  required
                  className="w-full h-10 px-3 text-sm rounded-lg bg-[var(--bg-input)] text-[var(--text-input)] border border-[var(--border-input)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center gap-3 pt-3 border-t border-[var(--border-light)] mt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg border border-[var(--color-error)] text-[var(--color-error)] hover:bg-red-500/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg text-white shadow-lg transition-transform active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                >
                  {isSaving ? (
                    <Spinner size="sm" />
                  ) : (
                    <>
                      <CheckCircle size={15} />
                      <span>Confirm & Record</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Record Return Modal (supports full or partial) */}
      {returnModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border-medium)] shadow-2xl overflow-hidden flex flex-col" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            {/* Header */}
            <div className="p-4 flex justify-between items-center border-b border-[var(--border-light)]" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
                  <CheckCircle size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Record Return</h2>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Worker: <strong>{returnModalItem.worker_name}</strong></p>
                </div>
              </div>
              <button
                onClick={() => setReturnModalItem(null)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[var(--bg-hover)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content Form */}
            <form onSubmit={handleConfirmReturn} className="p-5 flex flex-col gap-4">
              {/* Advance Overview Card */}
              <div className="p-3 rounded-lg border border-[var(--border-light)] text-xs flex justify-between items-center" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[var(--text-tertiary)] block">Total Advance</span>
                  <span className="font-bold text-sm text-[var(--text-primary)]">
                    ₹{(Number(returnModalItem.amount) || 0).toFixed(2)}
                  </span>
                </div>
                {Number(returnModalItem.returned_amount) > 0 && (
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[var(--text-tertiary)] block">Paid So Far</span>
                    <span className="font-bold text-sm text-emerald-400">
                      ₹{Number(returnModalItem.returned_amount).toFixed(2)}
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-[10px] uppercase font-bold text-[var(--text-tertiary)] block">Remaining Due</span>
                  <span className="font-bold text-sm text-amber-400">
                    ₹{(Math.max(0, (Number(returnModalItem.amount) || 0) - (Number(returnModalItem.returned_amount) || 0))).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Amount Returning Now Input */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    Amount Returning Now (₹) <span className="text-[var(--color-accent)]">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const total = Number(returnModalItem.amount) || 0;
                      const prev = Number(returnModalItem.returned_amount) || 0;
                      setReturnAmountInput(String(Math.max(0, total - prev)));
                    }}
                    className="text-[11px] font-bold text-[var(--color-accent)] hover:underline"
                  >
                    Full Balance
                  </button>
                </div>

                <div className="flex items-center rounded-lg bg-[var(--bg-input)] border border-[var(--border-input)] focus-within:border-[var(--color-accent)] transition-colors px-3 h-11">
                  <span className="text-base font-bold text-[var(--color-accent)] mr-2 select-none shrink-0">₹</span>
                  <input
                    type="number"
                    min="1"
                    max={Math.max(0, (Number(returnModalItem.amount) || 0) - (Number(returnModalItem.returned_amount) || 0))}
                    step="any"
                    value={returnAmountInput}
                    onChange={(e) => setReturnAmountInput(e.target.value)}
                    placeholder="0.00"
                    required
                    autoFocus
                    style={{ outline: 'none', border: 'none', boxShadow: 'none' }}
                    className="w-full h-full bg-transparent text-base font-bold text-[var(--text-input)] placeholder:text-[var(--text-tertiary)] p-0"
                  />
                </div>
                <p className="text-[11px] mt-1 text-[var(--text-tertiary)]">
                  Enter partial amount or keep full balance.
                </p>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center gap-3 pt-3 border-t border-[var(--border-light)] mt-1">
                <button
                  type="button"
                  onClick={() => setReturnModalItem(null)}
                  className="flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg border border-[var(--color-error)] text-[var(--color-error)] hover:bg-red-500/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReturn}
                  className="flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg text-white shadow-lg transition-transform active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                >
                  {isSubmittingReturn ? (
                    <Spinner size="sm" />
                  ) : (
                    <>
                      <CheckCircle size={15} />
                      <span>Confirm Return</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
