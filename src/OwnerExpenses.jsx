import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import { generateId, formatDateTime } from './utils';
import { 
  Receipt, 
  Plus, 
  CheckCircle, 
  AlertCircle,
  Copy,
  X
} from 'lucide-react';
import { Spinner, PageLoader } from './SharedUI';

const LOCAL_STORAGE_KEY = 'hardware_pos_expenses';

export default function OwnerExpenses({ isOwner = false, cashierName: propCashierName }) {
  const { cashierName: appCashierName, userRole, showAlert } = useApp();
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
      setExpenses(remoteData);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(remoteData));
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
      notes: null,
      recorded_by: currentCashier,
      created_at: new Date().toISOString()
    };

    try {
      // 1. Try Supabase insert
      try {
        const { error } = await supabase.from('expenses').insert([newExpense]);
        if (error) {
          await supabase.from('expenses').insert([newExpense]);
        }
      } catch {
        // Fallback to local
      }

      // 2. Log to audit_logs
      try {
        await supabase.from('audit_logs').insert([{
          action_type: 'EXPENSE',
          barcode: 'CASH',
          item_name: finalWorkerName,
          changes: `Advance: ₹${numAmount} given to ${finalWorkerName} for "${reason.trim()}" (Deducted from salary)`,
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

  const sqlSnippet = `CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID REFERENCES public.workers(id) ON DELETE SET NULL,
    worker_name TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    reason TEXT NOT NULL,
    notes TEXT,
    recorded_by TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on expenses" ON public.expenses FOR ALL USING (true) WITH CHECK (true);`;

  const copySql = () => {
    navigator.clipboard.writeText(sqlSnippet);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  };

  const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  return (
    <div className="h-full flex flex-col relative w-full animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-medium" style={{ color: 'var(--text-primary)' }}>
            Expenses &amp; Advances
          </h1>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {totalExpenses > 0 && (
            <div 
              className="h-11 px-4 rounded-lg border hidden sm:flex flex-col justify-center text-center shrink-0 min-w-[140px]" 
              style={{ backgroundColor: 'var(--color-accent-bg)', borderColor: 'rgba(59, 130, 246, 0.3)' }}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider leading-none" style={{ color: 'var(--color-accent)' }}>Total Advances</span>
              <span className="text-base font-bold leading-tight mt-0.5" style={{ color: 'var(--color-accent)' }}>₹{totalExpenses.toFixed(2)}</span>
            </div>
          )}
          <button
            onClick={() => setIsModalOpen(true)}
            className="h-11 px-5 rounded-lg text-xs font-semibold uppercase tracking-wider flex items-center justify-center gap-2 text-white shadow-sm transition-all active:scale-95 shrink-0"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            <Plus size={16} strokeWidth={2.5} />
            <span>Record Advance</span>
          </button>
        </div>
      </div>

      {/* Cloud DB Notice if table not yet in Supabase */}
      {!isDbConnected && (
        <div className="p-3.5 mb-4 rounded-xl border border-blue-500/30 bg-blue-500/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-2.5 text-blue-400 font-medium">
            <AlertCircle size={18} className="shrink-0" />
            <span>
              <strong>Local Mode Active:</strong> Expenses are saving locally &amp; logged to Audit Logs. To enable full cloud sync across devices, run the 1-click SQL snippet in your Supabase SQL Editor.
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
        <div className="p-4 mb-4 rounded-xl bg-black/60 border border-[var(--border-light)] text-xs font-mono relative shrink-0">
          <button onClick={() => setShowSqlHelp(false)} className="absolute top-3 right-3 text-gray-400 hover:text-white">
            <X size={16} />
          </button>
          <p className="text-[var(--color-accent)] font-bold mb-2">Paste this in your Supabase SQL Editor:</p>
          <pre className="p-3 bg-zinc-900 rounded text-emerald-400 overflow-x-auto text-[11px] leading-relaxed">
            {sqlSnippet}
          </pre>
        </div>
      )}

      {/* Main Table Container */}
      <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-light)] shadow-sm p-4">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <PageLoader text="Loading expenses..." />
          </div>
        ) : expenses.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3 bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
              <Receipt size={28} />
            </div>
            <h3 className="text-base font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-primary)' }}>
              No Expenses Recorded
            </h3>
            <p className="text-xs font-medium max-w-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              No staff salary advances or shop expenses have been recorded yet. Click below to add one.
            </p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="h-9 px-4 rounded-lg text-xs font-semibold uppercase tracking-wider text-white shadow-sm"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              + Record Advance
            </button>
          </div>
        ) : (
          <>
            {/* Mobile Card List (md:hidden) */}
            <div className="md:hidden flex-1 overflow-y-auto space-y-3">
              {expenses.map((exp) => {
                const totalAmt = Number(exp.amount) || 0;

                return (
                  <div
                    key={exp.id}
                    className="rounded-xl border border-[var(--border-light)] p-3.5 flex flex-col gap-2 shadow-sm"
                    style={{ backgroundColor: 'var(--bg-tertiary)' }}
                  >
                    {/* Worker & Amount */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                        {exp.worker_name || 'General Shop'}
                      </span>
                      <span className="text-base font-bold" style={{ color: 'var(--color-accent)' }}>
                        ₹{totalAmt.toFixed(2)}
                      </span>
                    </div>

                    {/* Reason */}
                    <p className="text-xs font-medium text-[var(--text-secondary)] truncate" title={exp.reason}>
                      {exp.reason}
                    </p>

                    {/* Date / Time & Given By */}
                    <div className="flex items-center justify-between text-[11px] pt-2 border-t border-[var(--border-light)]" style={{ color: 'var(--text-tertiary)' }}>
                      <span>
                        {formatDateTime(exp.created_at).full}
                      </span>
                      <span>
                        By: <strong style={{ color: 'var(--text-secondary)' }}>{exp.recorded_by || 'Staff'}</strong>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table (hidden md:block) */}
            <div className="hidden md:block flex-1 overflow-x-hidden overflow-y-auto shadow-sm min-h-[300px] md:rounded-lg border border-[var(--border-light)]" style={{ backgroundColor: 'transparent', overscrollBehavior: 'none' }}>
              <table className="w-full text-center border-collapse">
                <thead className="sticky top-0 z-20" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
                  <tr className="text-xs font-semibold uppercase tracking-wider text-center" style={{ color: 'var(--text-secondary)' }}>
                    <th className="p-3.5 md:p-4 text-center w-[22%]">Date &amp; Time</th>
                    <th className="p-3.5 md:p-4 text-center w-[20%]">Worker</th>
                    <th className="p-3.5 md:p-4 text-center w-[28%]">Reason / Purpose</th>
                    <th className="p-3.5 md:p-4 text-center w-[15%]">Amount</th>
                    <th className="p-3.5 md:p-4 text-center w-[15%]">Given By</th>
                  </tr>
                </thead>
                <tbody className="text-sm font-medium">
                  {expenses.map((exp) => {
                    const totalAmt = Number(exp.amount) || 0;

                    return (
                      <tr 
                        key={exp.id} 
                        className="hover:bg-[var(--bg-hover)] transition-colors border-b border-[var(--border-light)]"
                        style={{ borderBottom: '1px solid var(--border-light)' }}
                      >
                        {/* Date & Time */}
                        <td className="p-3.5 md:p-4 text-center align-middle whitespace-nowrap text-sm" style={{ color: 'var(--text-primary)' }}>
                          {formatDateTime(exp.created_at).full}
                        </td>

                        {/* Worker */}
                        <td className="p-3.5 md:p-4 text-center align-middle whitespace-nowrap text-sm font-medium capitalize" style={{ color: 'var(--text-primary)' }}>
                          {exp.worker_name || 'General Shop'}
                        </td>

                        {/* Reason */}
                        <td className="p-3.5 md:p-4 text-center align-middle text-sm font-medium" style={{ color: 'var(--text-secondary)' }} title={exp.reason}>
                          {exp.reason || '—'}
                        </td>

                        {/* Amount */}
                        <td className="p-3.5 md:p-4 text-center align-middle whitespace-nowrap font-bold text-sm" style={{ color: 'var(--color-accent)' }}>
                          ₹{totalAmt.toFixed(2)}
                        </td>

                        {/* Given By */}
                        <td className="p-3.5 md:p-4 text-center align-middle whitespace-nowrap text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                          {exp.recorded_by || 'Staff'}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-xl border border-[var(--border-light)] shadow-2xl overflow-hidden flex flex-col bg-[var(--bg-primary)]">
            {/* Header */}
            <div className="p-4 md:p-5 border-b border-[var(--border-light)] flex justify-between items-center glass-header sticky top-0 z-10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-md bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
                  <Receipt size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[var(--text-primary)]">Record Money Given</h2>
                  <p className="text-xs text-[var(--text-tertiary)] font-medium">Logged by: {currentCashier}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveExpense} className="p-5 flex flex-col gap-4">
              {/* 1. Worker Selection */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-secondary)]">
                  Who is taking the money? <span className="text-[var(--color-accent)]">*</span>
                </label>
                <select
                  value={selectedWorkerId}
                  onChange={(e) => setSelectedWorkerId(e.target.value)}
                  required
                  className="w-full h-10 px-3 text-sm font-medium rounded-md bg-[var(--bg-input)] text-[var(--text-input)] border border-[var(--border-input)] focus:outline-none focus:border-[var(--color-accent)] cursor-pointer"
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
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-secondary)]">
                    Expense Payee / Description
                  </label>
                  <input
                    type="text"
                    value={customWorkerName}
                    onChange={(e) => setCustomWorkerName(e.target.value)}
                    placeholder="e.g. Tea stall, Electrician, Auto / Tempo driver"
                    className="w-full h-10 px-3 text-sm rounded-md bg-[var(--bg-input)] text-[var(--text-input)] border border-[var(--border-input)] focus:outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
              )}

              {/* 2. Amount Input */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-secondary)]">
                  Amount Taken (₹) <span className="text-[var(--color-accent)]">*</span>
                </label>
                <div className="flex items-center rounded-md bg-[var(--bg-input)] border border-[var(--border-input)] focus-within:border-[var(--color-accent)] transition-colors px-3 h-11">
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
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-secondary)]">
                  Reason / Purpose <span className="text-[var(--color-accent)]">*</span>
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Lunch advance, Petrol for delivery, Emergency"
                  required
                  className="w-full h-10 px-3 text-sm rounded-md bg-[var(--bg-input)] text-[var(--text-input)] border border-[var(--border-input)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--border-light)] mt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="h-10 px-4 text-sm font-semibold rounded-md border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="h-10 px-5 text-sm font-bold uppercase tracking-wider rounded-md text-white shadow-sm transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                >
                  {isSaving ? (
                    <Spinner size="sm" />
                  ) : (
                    <>
                      <CheckCircle size={15} />
                      <span>Confirm &amp; Record</span>
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
