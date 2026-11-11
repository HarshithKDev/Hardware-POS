import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import { EXPENSES_CHANGED_EVENT } from './services/liveRefresh';
import { generateId, formatDateTime, formatINR } from './utils';
import { 
  Receipt, 
  Plus, 
  CheckCircle, 
  AlertCircle,
  Copy,
  X
} from 'lucide-react';
import { PageLoader } from './SharedUI';
import { Modal, Button, buttonClass, useSort, SortTh, TableSkeleton } from './components/ui';

const EXPENSE_SORT = {
  date: (e) => new Date(e.created_at).getTime() || 0,
  reason: { get: (e) => e.reason || '', textual: true },
  staff: { get: (e) => e.worker_name || 'General', textual: true },
  amount: (e) => Number(e.amount) || 0,
  by: { get: (e) => e.recorded_by || '', textual: true },
};
import PageTitleReset from './components/PageTitleReset';

const getLocalStorageKey = (shopId) => `hardware_pos_expenses_${shopId || 'default'}`;
// Expenses that could not be saved to the database yet (uploaded automatically later)
const getPendingKey = (shopId) => `hardware_pos_expenses_pending_${shopId || 'default'}`;

const EXPENSE_CATEGORIES = [
  'Staff Advance', 'Salary', 'Tea / Food', 'Transport / Delivery', 'Electricity',
  'Rent', 'Repairs / Maintenance', 'Shop Supplies', 'Other'
];
const PAYMENT_MODES = ['CASH', 'UPI'];

const readPending = (shopId) => {
  try { return JSON.parse(localStorage.getItem(getPendingKey(shopId)) || '[]') || []; } catch { return []; }
};
const writePending = (shopId, list) => {
  try {
    if (list.length === 0) localStorage.removeItem(getPendingKey(shopId));
    else localStorage.setItem(getPendingKey(shopId), JSON.stringify(list));
  } catch { /* storage full */ }
};

// Insert with shop_id; if the column doesn't exist yet (migration not run), retry without it.
async function insertExpenseRemote(expense) {
  const { _pending, ...row } = expense;
  let { error } = await supabase.from('expenses').insert([row]);
  if (error && (error.code === '42703' || error.code === 'PGRST204' || /shop_id/.test(error.message || ''))) {
    const { shop_id: _s, ...withoutShop } = row;
    ({ error } = await supabase.from('expenses').insert([withoutShop]));
  }
  // Already saved by an earlier attempt whose response was lost -> treat as success
  if (error && error.code === '23505') return null;
  return error;
}
export default function OwnerExpenses({ isOwner = false, cashierName: propCashierName }) {
  const { cashierName: appCashierName, userRole, showAlert, showConfirm, shopSettings } = useApp();
  const currentCashier = propCashierName || appCashierName || (userRole === 'owner' ? 'Owner' : 'Staff');
  const shopId = shopSettings?.id || localStorage.getItem('shop_id');

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
  const [category, setCategory] = useState('');
  const [paymentMode, setPaymentMode] = useState('CASH');
  const canDelete = isOwner || userRole === 'owner';
  const handleResetExpenses = () => {
    setIsModalOpen(false);
    setAmount('');
    setReason('');
    setSelectedWorkerId('');
    fetchExpenses();
  };

  // 1. Fetch Workers
  useEffect(() => {
    async function fetchWorkers() {
      try {
        let query = supabase
          .from('workers')
          .select('id, name')
          .order('name', { ascending: true });
        if (shopId) {
          query = query.eq('shop_id', shopId);
        }
        const { data, error } = await query;
        if (data && !error) {
          setWorkers(data);
        }
      } catch (err) {
        console.warn('Failed to fetch workers:', err);
      }
    }
    fetchWorkers();
  }, [shopId]);

  // 2. Fetch Expenses (Supabase with localStorage fallback)
  const fetchExpenses = async () => {
    setIsLoading(true);
    let remoteData = null;
    let dbSuccess = false;

    // Upload anything saved on this device while the database was unreachable
    const pendingBefore = readPending(shopId);
    if (pendingBefore.length > 0) {
      const stillPending = [];
      for (const exp of pendingBefore) {
        try {
          const err = await insertExpenseRemote(exp);
          if (err) stillPending.push(exp);
        } catch {
          stillPending.push(exp);
        }
      }
      writePending(shopId, stillPending);
    }

    try {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        // Fetch current shop's worker IDs to correlate
        let shopWorkerIds = new Set();
        if (shopId) {
          const { data: wData } = await supabase
            .from('workers')
            .select('id')
            .eq('shop_id', shopId);
          if (wData) {
            wData.forEach(w => shopWorkerIds.add(w.id));
          }
        }

        const filtered = shopId ? data.filter(e => {
          if (e.shop_id) return e.shop_id === shopId;
          if (e.notes === `shop:${shopId}`) return true;
          if (e.worker_id && shopWorkerIds.has(e.worker_id)) return true;
          return false;
        }) : data;

        remoteData = filtered;
        dbSuccess = true;
        setIsDbConnected(true);
      } else {
        setIsDbConnected(false);
      }
    } catch {
      setIsDbConnected(false);
    }

    // Load from local storage
    const storageKey = getLocalStorageKey(shopId);
    const localRaw = localStorage.getItem(storageKey);
    let localData = [];
    if (localRaw) {
      try {
        localData = JSON.parse(localRaw);
      } catch (e) {
        console.error(e);
      }
    }

    const pendingNow = readPending(shopId).map(e => ({ ...e, _pending: true }));
    if (dbSuccess && remoteData) {
      setExpenses([...pendingNow, ...remoteData]);
      localStorage.setItem(storageKey, JSON.stringify(remoteData));
    } else {
      setExpenses([...pendingNow, ...localData.filter(e => !pendingNow.some(p => p.id === e.id))]);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchExpenses();
  }, [shopId]);

  // Another device added or deleted an expense: reload the list
  useEffect(() => {
    const onChanged = () => fetchExpenses();
    window.addEventListener(EXPENSES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(EXPENSES_CHANGED_EVENT, onChanged);
  }, [shopId]);

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

    const finalCategory = category || (finalWorkerId ? 'Staff Advance' : 'Other');
    const newExpense = {
      id: generateId(),
      shop_id: shopId || undefined,
      worker_id: finalWorkerId,
      worker_name: finalWorkerName,
      amount: numAmount,
      reason: reason.trim(),
      category: finalCategory,
      payment_mode: paymentMode,
      notes: shopId ? `shop:${shopId}` : null,
      recorded_by: currentCashier,
      created_at: new Date().toISOString()
    };

    try {
      // 1. Try Supabase insert
      let savedRemotely = false;
      try {
        const error = await insertExpenseRemote(newExpense);
        if (error) {
          console.warn('Remote expense insert failed:', error.message);
        } else {
          savedRemotely = true;
        }
      } catch (err) {
        console.warn('Network exception inserting expense:', err);
      }
      if (!savedRemotely) {
        // Keep it in a separate "pending" list so a later reload can't overwrite it; it is
        // uploaded automatically the next time the Expenses page loads with a connection.
        writePending(shopId, [newExpense, ...readPending(shopId)]);
      }

      // 2. Log to audit_logs
      try {
        await supabase.from('audit_logs').insert([{
          shop_id: shopId,
          action_type: 'EXPENSE',
          barcode: 'CASH',
          item_name: finalWorkerName,
          changes: `Expense: ₹${formatINR(numAmount, 2)} (${paymentMode}, ${finalCategory}) for "${reason.trim()}" (${finalWorkerName})`,
          performed_by: currentCashier
        }]);
      } catch (auditErr) {
        console.warn('Audit log write error:', auditErr);
      }

      // 3. Update the list on screen
      const shown = savedRemotely ? newExpense : { ...newExpense, _pending: true };
      setExpenses(prev => [shown, ...prev]);
      if (savedRemotely) {
        const cached = (() => { try { return JSON.parse(localStorage.getItem(getLocalStorageKey(shopId)) || '[]'); } catch { return []; } })();
        localStorage.setItem(getLocalStorageKey(shopId), JSON.stringify([newExpense, ...cached]));
        showAlert(`Recorded ₹${formatINR(numAmount, 2)} for ${reason.trim()}.`, 'Recorded');
      } else {
        showAlert(`Could not reach the server. ₹${formatINR(numAmount, 2)} for ${reason.trim()} is saved on THIS device only and will upload automatically when the connection is back (shown as "Not synced"). Do not enter it again.`, 'Saved Offline');
      }

      // Reset form
      setAmount('');
      setReason('');
      setCategory('');
      setPaymentMode('CASH');
      setSelectedWorkerId('');
      setIsModalOpen(false);
    } catch (err) {
      showAlert(err.message || 'Failed to record expense.', 'Error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteExpense = (exp) => {
    showConfirm(
      `Delete the expense of ₹${formatINR(Number(exp.amount || 0), 2)} for "${exp.reason}"? This cannot be undone.`,
      async () => {
        try {
          if (exp._pending) {
            writePending(shopId, readPending(shopId).filter(p => p.id !== exp.id));
          } else {
            const { error } = await supabase.from('expenses').delete().eq('id', exp.id);
            if (error) throw error;
            try {
              await supabase.from('audit_logs').insert([{
                shop_id: shopId,
                action_type: 'EXPENSE_DELETED',
                barcode: 'CASH',
                item_name: exp.worker_name || 'General Shop',
                changes: `Deleted expense: ₹${formatINR(exp.amount, 2)} for "${exp.reason}" (recorded by ${exp.recorded_by || 'Staff'})`,
                performed_by: currentCashier
              }]);
            } catch (auditErr) { console.warn('Audit log write error:', auditErr); }
          }
          setExpenses(prev => prev.filter(e => e.id !== exp.id));
          try {
            const cached = JSON.parse(localStorage.getItem(getLocalStorageKey(shopId)) || '[]');
            localStorage.setItem(getLocalStorageKey(shopId), JSON.stringify(cached.filter(e => e.id !== exp.id)));
          } catch { /* ignore */ }
        } catch (err) {
          showAlert(`Could not delete the expense: ${err.message}`, 'Error');
        }
      },
      'Delete Expense', 'Delete', 'Cancel', true
    );
  };

  const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const { sorted: sortedExpenses, sort: expSort, toggleSort: toggleExpSort } = useSort(expenses, EXPENSE_SORT);
  return (
    <div className="h-full flex flex-col relative w-full animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-5">
        <PageTitleReset
          title="Expenses"
          onReset={handleResetExpenses}
          tooltip="Click title to refresh expenses"
        />

        <div className="flex items-center gap-2 sm:gap-3 shrink-0 w-full sm:w-auto justify-between sm:justify-end">
          {totalExpenses > 0 && (
            <div 
              className="h-10 px-3 sm:px-4 rounded-lg border flex flex-col justify-center text-center shrink-0" 
              style={{ backgroundColor: 'var(--color-accent-bg)', borderColor: 'rgba(59, 130, 246, 0.3)' }}
            >
              <span className="text-[11px] sm:text-[11px] font-bold uppercase tracking-wider leading-none" style={{ color: 'var(--color-accent)' }}>Total Expenses</span>
              <span className="text-xs sm:text-sm font-bold leading-tight mt-0.5 tabular-nums" style={{ color: 'var(--color-accent)' }}>₹{formatINR(totalExpenses, 2)}</span>
            </div>
          )}
          <button
            onClick={() => setIsModalOpen(true)}
            className={buttonClass({ variant: 'primary', size: 'md', className: 'flex-1 sm:flex-initial' })}
          >
            <Plus size={16} strokeWidth={2.5} />
            <span>Add Expense</span>
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-secondary)] rounded-[10px] border border-[var(--border-light)] shadow-sm p-4">
        {isLoading ? (
          <TableSkeleton rows={8} cols={5} label="Loading expenses…" />
        ) : expenses.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3 bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
              <Receipt size={24} />
            </div>
            <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              No Expenses Recorded
            </h3>
            <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              No expenses recorded yet.
            </p>
            <Button variant="primary" className="mt-4" onClick={() => setIsModalOpen(true)}>Add Expense</Button>
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
                      <span className="text-base font-bold tabular-nums" style={{ color: 'var(--color-accent)' }}>
                        ₹{formatINR(totalAmt, 2)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                      <span>{exp.worker_name || 'General'}{exp.category ? ` · ${exp.category}` : ''}{exp.payment_mode ? ` · ${exp.payment_mode}` : ''}</span>
                      <span>{formatDateTime(exp.created_at).full}</span>
                    </div>
                    {(exp._pending || canDelete) && (
                      <div className="flex items-center justify-between text-xs">
                        {exp._pending ? <span className="font-bold" style={{ color: 'var(--color-warning)' }}>Not synced</span> : <span />}
                        {canDelete && (
                          <button type="button" onClick={() => handleDeleteExpense(exp)} className={buttonClass({ variant: 'danger-outline', size: 'sm' })}>Delete</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block flex-1 overflow-x-hidden overflow-y-auto shadow-sm min-h-[300px] md:rounded-lg border border-[var(--border-medium)]" style={{ backgroundColor: 'transparent', overscrollBehavior: 'none' }}>
              <table className="w-full text-center border-collapse">
                <thead className="sticky top-0 z-20" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
                  <tr className="h-10 text-[11px] font-semibold uppercase tracking-wider text-center" style={{ color: 'var(--text-secondary)' }}>
                    <SortTh label="Date & Time" sortKey="date" sort={expSort} onSort={toggleExpSort} className="px-3.5 text-center w-[25%]" style={{ borderRight: '1px solid var(--border-medium)' }} />
                    <SortTh label="Description" sortKey="reason" sort={expSort} onSort={toggleExpSort} className="px-3.5 text-center w-[30%]" style={{ borderRight: '1px solid var(--border-medium)' }} />
                    <SortTh label="Staff / Category" sortKey="staff" sort={expSort} onSort={toggleExpSort} className="px-3.5 text-center w-[20%]" style={{ borderRight: '1px solid var(--border-medium)' }} />
                    <SortTh label="Amount" sortKey="amount" sort={expSort} onSort={toggleExpSort} className="px-3.5 text-center w-[15%]" style={{ borderRight: '1px solid var(--border-medium)' }} />
                    <SortTh label="By" sortKey="by" sort={expSort} onSort={toggleExpSort} className="px-3.5 text-center w-[10%]" />
                  </tr>
                </thead>
                <tbody className="text-sm font-medium">
                  {sortedExpenses.map((exp) => {
                    const totalAmt = Number(exp.amount) || 0;

                    return (
                      <tr 
                        key={exp.id} 
                        className="hover:bg-[var(--bg-hover)] transition-colors border-b border-[var(--border-medium)]"
                        style={{ borderBottom: '1px solid var(--border-medium)' }}
                      >
                        <td className="p-3.5 text-center align-middle whitespace-nowrap text-sm" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
                          {formatDateTime(exp.created_at).full}
                        </td>

                        <td className="p-3.5 text-center align-middle text-sm font-semibold" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
                          {exp.reason || '—'}
                        </td>

                        <td className="p-3.5 text-center align-middle whitespace-nowrap text-sm font-medium capitalize" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}>
                          {exp.worker_name || 'General'}
                          {exp.category && <span className="block text-xs normal-case opacity-80">{exp.category}{exp.payment_mode ? ` · ${exp.payment_mode}` : ''}</span>}
                        </td>

                        <td className="p-3.5 text-center align-middle whitespace-nowrap font-bold text-sm tabular-nums" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--color-accent)' }}>
                          ₹{formatINR(totalAmt, 2)}
                          {exp._pending && <span className="block text-[11px] font-bold uppercase" style={{ color: 'var(--color-warning)' }}>Not synced</span>}
                        </td>

                        <td className="p-3.5 text-center align-middle whitespace-nowrap text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                          {exp.recorded_by || 'Staff'}
                          {canDelete && (
                            <button type="button" onClick={() => handleDeleteExpense(exp)} aria-label={`Delete expense ${exp.reason || ''}`} className="block mx-auto mt-1 px-2 py-0.5 rounded-md text-xs font-semibold text-[var(--color-error)] hover:bg-[var(--color-error-bg)] transition-colors cursor-pointer">Delete</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 z-10" style={{ backgroundColor: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-medium)' }}>
                  <tr className="h-11">
                    <td colSpan={3} className="px-3.5 text-right text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)', borderRight: '1px solid var(--border-medium)' }}>
                      Total ({expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'})
                    </td>
                    <td className="px-3.5 text-center text-sm font-bold tabular-nums whitespace-nowrap" style={{ color: 'var(--color-accent)', borderRight: '1px solid var(--border-medium)' }}>
                      ₹{formatINR(totalExpenses, 2)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Add Expense Modal */}
      {isModalOpen && (
        <Modal
          as="form"
          onSubmit={handleSaveExpense}
          onClose={() => { if (!isSaving) setIsModalOpen(false); }}
          title="Add Expense"
          titleId="add-expense-title"
          size="sm"
          zIndex={50}
          footer={(
            <>
              <Button variant="secondary" onClick={() => setIsModalOpen(false)} disabled={isSaving}>Cancel</Button>
              <Button type="submit" variant="primary" loading={isSaving} className="min-w-[140px]">
                <CheckCircle size={14} />
                <span>Save Expense</span>
              </Button>
            </>
          )}
        >
            <div className="flex flex-col gap-4">
              {/* Description */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-secondary)]">
                  Description <span className="text-[var(--color-error)]">*</span>
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
                  Amount (₹) <span className="text-[var(--color-error)]">*</span>
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

              {/* Category & payment mode */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-secondary)]">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full h-10 px-2 text-sm font-medium rounded-md bg-[var(--bg-input)] text-[var(--text-input)] border border-[var(--border-input)] focus:outline-none focus:border-[var(--color-accent)]"
                  >
                    <option value="">{selectedWorkerId && selectedWorkerId !== 'GENERAL' ? 'Staff Advance' : 'Other'} (auto)</option>
                    {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 text-[var(--text-secondary)]">Paid By</label>
                  <select
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value)}
                    className="w-full h-10 px-2 text-sm font-medium rounded-md bg-[var(--bg-input)] text-[var(--text-input)] border border-[var(--border-input)] focus:outline-none focus:border-[var(--color-accent)]"
                  >
                    {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

            </div>
        </Modal>
      )}
    </div>
  );
}
