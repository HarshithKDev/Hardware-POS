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

  // New Expense Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
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
      showAlert('Please enter a description or reason.', 'Description Required');
      return;
    }

    let finalWorkerName = 'General Shop';
    let finalWorkerId = null;

    if (selectedWorkerId && selectedWorkerId !== 'GENERAL') {
      const found = workers.find(w => w.id === selectedWorkerId);
      if (found) {
        finalWorkerName = found.name;
        finalWorkerId = found.id;
      }
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
          changes: `Expense: ₹${numAmount} for "${reason.trim()}" (${finalWorkerName})`,
          performed_by: currentCashier
        }]);
      } catch (auditErr) {
        console.warn('Audit log write error:', auditErr);
      }

      // 3. Save locally in state & localStorage
      const updatedExpenses = [newExpense, ...expenses];
      setExpenses(updatedExpenses);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedExpenses));

      showAlert(`Recorded ₹${numAmount.toFixed(2)} for ${reason.trim()}.`, 'Recorded');

      // Reset form
      setAmount('');
      setReason('');
      setSelectedWorkerId('');
      setIsModalOpen(false);
    } catch (err) {
      showAlert(err.message || 'Failed to record expense.', 'Error');
    } finally {
      setIsSaving(false);
    }
  };

  const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  return (
    <div className="h-full flex flex-col relative w-full animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-medium" style={{ color: 'var(--text-primary)' }}>
            Expenses
          </h1>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {totalExpenses > 0 && (
            <div 
              className="h-10 px-4 rounded-lg border hidden sm:flex flex-col justify-center text-center shrink-0 min-w-[130px]" 
              style={{ backgroundColor: 'var(--color-accent-bg)', borderColor: 'rgba(59, 130, 246, 0.3)' }}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider leading-none" style={{ color: 'var(--color-accent)' }}>Total Expenses</span>
              <span className="text-sm font-bold leading-tight mt-0.5" style={{ color: 'var(--color-accent)' }}>₹{totalExpenses.toFixed(2)}</span>
            </div>
          )}
          <button
            onClick={() => setIsModalOpen(true)}
            className="h-10 px-4 rounded-lg text-xs font-semibold uppercase tracking-wider flex items-center justify-center gap-2 text-white shadow-sm transition-all active:scale-95 shrink-0"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            <Plus size={16} strokeWidth={2.5} />
            <span>Add Expense</span>
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-light)] shadow-sm p-4">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <PageLoader text="Loading expenses..." />
          </div>
        ) : expenses.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3 bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
              <Receipt size={24} />
            </div>
            <h3 className="text-base font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-primary)' }}>
              No Expenses Recorded
            </h3>
            <p className="text-xs font-medium mb-4" style={{ color: 'var(--text-secondary)' }}>
              No expenses recorded yet.
            </p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="h-9 px-4 rounded-lg text-xs font-semibold uppercase tracking-wider text-white shadow-sm cursor-pointer"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              + Add Expense
            </button>
          </div>
        ) : (
          <>
            {/* Mobile Card List */}
            <div className="md:hidden flex-1 overflow-y-auto space-y-3">
              {expenses.map((exp) => {
                const totalAmt = Number(exp.amount) || 0;

                return (
                  <div
                    key={exp.id}
                    className="rounded-xl border border-[var(--border-light)] p-3.5 flex flex-col gap-2 shadow-sm"
                    style={{ backgroundColor: 'var(--bg-tertiary)' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                        {exp.reason || 'Expense'}
                      </span>
                      <span className="text-base font-bold" style={{ color: 'var(--color-accent)' }}>
                        ₹{totalAmt.toFixed(2)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                      <span>{exp.worker_name || 'General'}</span>
                      <span>{formatDateTime(exp.created_at).full}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block flex-1 overflow-x-hidden overflow-y-auto shadow-sm min-h-[300px] md:rounded-lg border border-[var(--border-light)]" style={{ backgroundColor: 'transparent', overscrollBehavior: 'none' }}>
              <table className="w-full text-center border-collapse">
                <thead className="sticky top-0 z-20" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
                  <tr className="text-xs font-semibold uppercase tracking-wider text-center" style={{ color: 'var(--text-secondary)' }}>
                    <th className="p-3.5 text-center w-[25%]">Date &amp; Time</th>
                    <th className="p-3.5 text-center w-[30%]">Description</th>
                    <th className="p-3.5 text-center w-[20%]">Staff / Category</th>
                    <th className="p-3.5 text-center w-[15%]">Amount</th>
                    <th className="p-3.5 text-center w-[10%]">By</th>
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
                        <td className="p-3.5 text-center align-middle whitespace-nowrap text-sm" style={{ color: 'var(--text-primary)' }}>
                          {formatDateTime(exp.created_at).full}
                        </td>

                        <td className="p-3.5 text-center align-middle text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {exp.reason || '—'}
                        </td>

                        <td className="p-3.5 text-center align-middle whitespace-nowrap text-sm font-medium capitalize" style={{ color: 'var(--text-secondary)' }}>
                          {exp.worker_name || 'General'}
                        </td>

                        <td className="p-3.5 text-center align-middle whitespace-nowrap font-bold text-sm" style={{ color: 'var(--color-accent)' }}>
                          ₹{totalAmt.toFixed(2)}
                        </td>

                        <td className="p-3.5 text-center align-middle whitespace-nowrap text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
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

      {/* Add Expense Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm rounded-xl border border-[var(--border-light)] shadow-2xl overflow-hidden flex flex-col bg-[var(--bg-primary)]">
            {/* Header */}
            <div className="p-4 border-b border-[var(--border-light)] flex justify-between items-center bg-[var(--bg-tertiary)]">
              <div className="flex items-center gap-2">
                <Receipt size={18} className="text-[var(--color-accent)]" />
                <h2 className="text-base font-bold text-[var(--text-primary)]">Add Expense</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveExpense} className="p-5 flex flex-col gap-4">
              {/* Description */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-secondary)]">
                  Description <span className="text-[var(--color-accent)]">*</span>
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Tea & Snacks, Delivery, Shop Repair"
                  required
                  autoFocus
                  className="w-full h-10 px-3 text-sm rounded-md bg-[var(--bg-input)] text-[var(--text-input)] border border-[var(--border-input)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>

              {/* Amount Input */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-secondary)]">
                  Amount (₹) <span className="text-[var(--color-accent)]">*</span>
                </label>
                <div className="flex items-center rounded-md bg-[var(--bg-input)] border border-[var(--border-input)] focus-within:border-[var(--color-accent)] transition-colors px-3 h-10">
                  <span className="text-base font-bold text-[var(--color-accent)] mr-2 select-none shrink-0">₹</span>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    required
                    style={{ outline: 'none', border: 'none', boxShadow: 'none' }}
                    className="w-full h-full bg-transparent text-base font-bold text-[var(--text-input)] placeholder:text-[var(--text-tertiary)] p-0"
                  />
                </div>
              </div>

              {/* Optional Staff / Category */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-secondary)]">
                  Staff / Paid To (Optional)
                </label>
                <select
                  value={selectedWorkerId}
                  onChange={(e) => setSelectedWorkerId(e.target.value)}
                  className="w-full h-10 px-3 text-sm font-medium rounded-md bg-[var(--bg-input)] text-[var(--text-input)] border border-[var(--border-input)] focus:outline-none focus:border-[var(--color-accent)] cursor-pointer"
                >
                  <option value="">General Shop Expense</option>
                  {workers.map(w => (
                    <option key={w.id} value={w.id}>
                      {w.name} (Staff)
                    </option>
                  ))}
                </select>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-light)] mt-1">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="h-9 px-4 text-xs font-semibold rounded-md border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="h-9 px-4 text-xs font-bold uppercase tracking-wider rounded-md text-white shadow-sm transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                >
                  {isSaving ? (
                    <Spinner className="w-3.5 h-3.5 text-white" />
                  ) : (
                    <>
                      <CheckCircle size={14} />
                      <span>Save Expense</span>
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
