import { useState, useMemo, useCallback, useEffect, Fragment } from 'react';
import { localToUtcIso, formatINR } from './utils';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { Spinner, PageLoader } from './SharedUI';
import { debounce, formatDateTime, formatDayHeader, escapeIlike, useSessionState } from './utils';
import { useApp } from './AppContext';
import { X, Calendar } from 'lucide-react';
import PageTitleReset from './components/PageTitleReset';
import { buttonClass, DateField, TableSkeleton } from './components/ui';

/** Every action that is written to the audit log, with a plain name for the filter. */
const ACTION_LABELS = {
  BILL: 'Bills (totals, payment, discount)',
  SALE: 'Sale items',
  SHOWROOM: 'Showroom dispatches',
  'STOCK IN': 'Stock received',
  TRANSFER: 'Moved to store',
  RETURN: 'Returns',
  VOID: 'Bills fully returned',
  SCRAP: 'Scrap',
  BOX_OPENED: 'Screw box opened',
  CREATE: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  RESTORE: 'Restored',
  EXPENSE: 'Expenses',
  EXPENSE_DELETED: 'Expenses deleted',
  'CART CLEARED': 'Carts cleared without billing',
  PRINT: 'Labels printed',
  'DAY CLOSING': 'Day closing',
  SETTINGS: 'Settings changed',
  LOGIN: 'Sign in',
  LOGOUT: 'Sign out',
  EXPORT: 'Data downloads',
  SYNC_FAILED: 'Failed syncs',
};
const ACTION_TONE = {
  BILL: 'purple', SALE: 'purple', SHOWROOM: 'warning', 'STOCK IN': 'success', TRANSFER: 'accent',
  RETURN: 'error', VOID: 'error', SCRAP: 'warning', BOX_OPENED: 'accent', CREATE: 'accent',
  UPDATE: 'warning', DELETE: 'error', RESTORE: 'success', EXPENSE: 'warning', EXPENSE_DELETED: 'error',
  'CART CLEARED': 'error', PRINT: 'neutral', 'DAY CLOSING': 'success', SETTINGS: 'accent',
  LOGIN: 'neutral', LOGOUT: 'neutral', EXPORT: 'neutral', SYNC_FAILED: 'error',
};

/** The full breakdown shown when a log row is expanded: one "Label: value" per line. */
const LogDetails = ({ details }) => (
  <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 text-left">
    {details.map((part, i) => {
      const idx = part.indexOf(': ');
      const label = idx > 0 ? part.slice(0, idx) : '';
      const value = idx > 0 ? part.slice(idx + 2) : part;
      return (
        <div key={i} className="flex gap-2 min-w-0 text-sm">
          {label && <dt className="shrink-0 text-[var(--text-secondary)]">{label}:</dt>}
          <dd className="min-w-0 break-words text-[var(--text-primary)]">{value}</dd>
        </div>
      );
    })}
  </dl>
);

const DetailsToggle = ({ count, open, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-expanded={open}
    className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-accent)] hover:underline cursor-pointer"
  >
    {open ? 'Hide details' : `+${count} detail${count === 1 ? '' : 's'}`}
    <span aria-hidden="true">{open ? '▴' : '▾'}</span>
  </button>
);

/**
 * One short, readable line per log entry, plus the remaining details (shown when the row
 * is expanded). Works with the three formats stored in audit_logs.changes:
 *  - JSON from stock actions: {"quantity":3,"location":"Store","price":450,...}
 *  - "Part A | Part B | Part C" (catalog, batches)
 *  - a plain sentence (expenses, staff, categories…) → shown as is, no details.
 */
export function describeLogChange(actionType, rawChanges, unit) {
  const u = unit ? ` ${String(unit).toLowerCase()}` : '';
  const raw = typeof rawChanges === 'string' ? rawChanges.trim() : '';
  if (!raw || raw === '—') return { summary: '—', details: [] };

  if (raw.startsWith('{')) {
    try {
      const o = JSON.parse(raw);
      const qty = o.quantity !== undefined ? `${o.quantity}${u}` : '';
      const price = o.price !== undefined ? ` at ₹${formatINR(o.price, 2)} each` : '';
      const disc = Number(o.discountPct) > 0 ? ` (${o.discountPct}% off)` : '';
      const loc = o.location ? String(o.location) : '';
      let summary = '';
      if (actionType === 'SALE' && qty) summary = `Sold ${qty}${price}${disc}`;
      else if (actionType === 'STOCK IN' && qty) summary = `Received ${qty}${loc ? ` into ${loc}` : ''}`;
      else if (actionType === 'TRANSFER' && qty) summary = `Moved ${qty}${loc ? ` (${loc})` : ''}`;
      else if (actionType === 'SHOWROOM' && qty) summary = `Sent ${qty} to the showroom${price}`;
      const LABELS = { quantity: 'Quantity', location: 'Location', price: 'Price', discountPct: 'Discount', instance: 'Piece' };
      const details = Object.entries(o)
        .filter(([k, v]) => v !== null && v !== undefined && v !== '' && !(k === 'discountPct' && !(Number(v) > 0)))
        .map(([k, v]) => {
          const label = LABELS[k] || k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
          const value = k === 'price' ? `₹${formatINR(v, 2)}`
            : k === 'discountPct' ? `${v}%`
            : k === 'quantity' ? `${v}${u}`
            : (typeof v === 'object' ? JSON.stringify(v) : v);
          return `${label}: ${value}`;
        });
      if (!summary) summary = [qty && `Qty ${qty}`, loc, o.price !== undefined && `₹${formatINR(o.price, 2)}`].filter(Boolean).join(' · ') || details[0] || '—';
      return { summary, details: details.length > 1 ? details : [] };
    } catch { /* not JSON: fall through */ }
  }

  if (raw.startsWith('[')) {
    try {
      const arr = JSON.parse(raw).map(String);
      if (arr.length === 0) return { summary: '—', details: [] };
      return { summary: arr.length === 1 ? arr[0] : `${arr[0]} (+${arr.length - 1} more)`, details: arr.length > 1 ? arr : [] };
    } catch { /* fall through */ }
  }

  if (raw.includes(' | ')) {
    const parts = raw.split(' | ').map(p => p.trim()).filter(Boolean);
    let summary = parts[0];
    if (/^Bulk Imported CSV Item:/i.test(summary)) summary = 'Imported from CSV';
    else if (/^Item:/i.test(summary)) summary = 'Added to catalog';
    return { summary, details: parts.slice(1) };
  }

  return { summary: raw, details: [] };
}

export default function OwnerAuditLogs() {
  const { shopSettings } = useApp();
  const ownerName = shopSettings?.owner_name || 'Owner';
  const shopId = localStorage.getItem('shop_id');

  const [searchTerm, setSearchTerm] = useSessionState(`pos_audit_search_${shopId}`, '');
  const [debouncedSearch, setDebouncedSearch] = useSessionState(`pos_audit_debounced_${shopId}`, () => searchTerm || '');
  const [activeFilter, setActiveFilter] = useSessionState(`pos_audit_filter_${shopId}`, 'ALL');
  const [selectedUser, setSelectedUser] = useSessionState(`pos_audit_user_${shopId}`, 'ALL');
  const [sortOrder, setSortOrder] = useSessionState(`pos_audit_sort_${shopId}`, 'newest');
  const [showAdvanced, setShowAdvanced] = useSessionState(`pos_audit_adv_${shopId}`, false);
  // Rows whose full details are open
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const toggleExpanded = useCallback((id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  
  const [datePageIndex, setDatePageIndex] = useSessionState(`pos_audit_date_idx_${shopId}`, 0);
  const [customDate, setCustomDate] = useSessionState(`pos_audit_date_${shopId}`, '');
  const [searchPage, setSearchPage] = useSessionState(`pos_audit_page_${shopId}`, 0);

  const handleResetAuditLogs = () => {
    setSearchTerm('');
    setDebouncedSearch('');
    setActiveFilter('ALL');
    setSelectedUser('ALL');
    setSortOrder('newest');
    setDatePageIndex(0);
    setCustomDate('');
    setSearchPage(0);
    setShowAdvanced(false);
    try {
      window.sessionStorage.removeItem(`pos_audit_search_${shopId}`);
      window.sessionStorage.removeItem(`pos_audit_debounced_${shopId}`);
      window.sessionStorage.removeItem(`pos_audit_filter_${shopId}`);
      window.sessionStorage.removeItem(`pos_audit_user_${shopId}`);
      window.sessionStorage.removeItem(`pos_audit_sort_${shopId}`);
      window.sessionStorage.removeItem(`pos_audit_date_idx_${shopId}`);
      window.sessionStorage.removeItem(`pos_audit_date_${shopId}`);
      window.sessionStorage.removeItem(`pos_audit_page_${shopId}`);
      window.sessionStorage.removeItem(`pos_audit_adv_${shopId}`);
    } catch (e) {}
  };

  const AUDIT_SEARCH_PER_PAGE = 50;

  const debouncedSetSearch = useMemo(
    () => debounce((val) => {
      setDebouncedSearch(val);
      setSearchPage(0);
    }, 300),
    [setDebouncedSearch, setSearchPage]
  );

  useEffect(() => {
    if (searchTerm && debouncedSearch !== searchTerm) {
      setDebouncedSearch(searchTerm);
    }
  }, [searchTerm, debouncedSearch, setDebouncedSearch]);

  const handleSearchChange = useCallback((e) => {
    setSearchTerm(e.target.value);
    debouncedSetSearch(e.target.value);
  }, [debouncedSetSearch, setSearchTerm]);

  // Query distinct dates with audit activity for day-by-day pagination
  const { data: availableDates = [] } = useQuery({
    queryKey: ['auditAvailableDates', shopId],
    queryFn: async () => {
      let query = supabase
        .from('audit_logs')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(3000);

      if (shopId) {
        query = query.eq('shop_id', shopId);
      }
      const { data, error } = await query;
      if (error) throw error;
      const dates = [];
      const seen = new Set();
      for (const row of (data || [])) {
        if (!row.created_at) continue;
        const d = new Date(row.created_at).toLocaleDateString('en-CA');
        if (!seen.has(d)) {
          seen.add(d);
          dates.push(d);
        }
      }
      return dates;
    },
    staleTime: 1000 * 60 * 2,
  });

  const isSearching = Boolean(debouncedSearch.trim());

  // Active day: custom selected date, or date at current page index, or latest available date
  const currentDay = useMemo(() => {
    if (customDate) return customDate;
    if (availableDates && availableDates.length > 0) {
      return availableDates[datePageIndex] || availableDates[0];
    }
    return new Date().toLocaleDateString('en-CA');
  }, [customDate, availableDates, datePageIndex]);

  const { data: auditResult, isLoading, error } = useQuery({
    queryKey: ['unifiedAuditLogs', shopId, isSearching, debouncedSearch, searchPage, currentDay, sortOrder],
    queryFn: async () => {
      let auditQuery = supabase
        .from('audit_logs')
        .select('*', { count: isSearching ? 'exact' : undefined });

      if (shopId) {
        auditQuery = auditQuery.eq('shop_id', shopId);
      }

      if (isSearching) {
        // GLOBAL SEARCH: Search all available data across all history
        const raw = debouncedSearch.trim();
        const cleanQ = escapeIlike(raw);
        auditQuery = auditQuery
          .or(`barcode.ilike.%${cleanQ}%,item_name.ilike.%${cleanQ}%,performed_by.ilike.%${cleanQ}%,action_type.ilike.%${cleanQ}%`)
          .order('created_at', { ascending: sortOrder === 'oldest' })
          .range(searchPage * AUDIT_SEARCH_PER_PAGE, (searchPage + 1) * AUDIT_SEARCH_PER_PAGE - 1);
      } else {
        // DAY-BY-DAY MODE: Load records strictly of currentDay
        const start = localToUtcIso(`${currentDay}T00:00:00`);
        const end = localToUtcIso(`${currentDay}T23:59:59.999`);
        auditQuery = auditQuery
          .gte('created_at', start)
          .lte('created_at', end)
          .order('created_at', { ascending: sortOrder === 'oldest' });
      }

      let prodQuery = supabase.from('product_master').select('barcode, unit');
      if (shopId) {
        prodQuery = prodQuery.eq('shop_id', shopId);
      }

      const [{ data: auditData, count, error: auditError }, { data: inventoryData }] = await Promise.all([
        auditQuery,
        prodQuery
      ]);
      
      if (auditError) throw auditError;

      const unitMap = (inventoryData || []).reduce((acc, item) => {
        acc[item.barcode] = item.unit;
        return acc;
      }, {});

      const formatChangesText = (changesStr, unit) => {
        const u = unit ? ` ${unit}` : '';
        if (!changesStr) return '—';
        if (typeof changesStr === 'string' && (changesStr.trim().startsWith('{') || changesStr.trim().startsWith('['))) {
          try {
            const data = JSON.parse(changesStr);
            if (Array.isArray(data)) {
              return data.map(str => (str.includes('Stock') || str.includes('Length') || str.includes('Width') || str.includes('Quantity')) ? `${str}${u}` : str).join(', ');
            }
            let parts = [];
            if (data.quantity !== undefined) parts.push(`Qty: ${data.quantity}${u}`);
            if (data.location) parts.push(`Loc: ${data.location}`);
            if (data.instance) parts.push(`Piece: #${data.instance.split('-')[1] || data.instance}`);
            if (data.price !== undefined) parts.push(`Price: ₹${formatINR(data.price, 2)}`);
            if (data.discountPct !== undefined && data.discountPct > 0) parts.push(`Disc: ${data.discountPct}%`);
            
            if (parts.length > 0) return parts.join(' | ');
            return Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(', ');
          } catch (e) {
            return changesStr;
          }
        }
        return changesStr;
      };

      const normalizedAudit = (auditData || []).map(log => {
        const actionType = (log.action_type === 'RECEIVE' || log.action_type === 'STOCK_IN') ? 'STOCK IN' : log.action_type;
        return {
          id: `audit-${log.id}`,
          timestamp: new Date(log.created_at).getTime(),
          date: formatDateTime(log.created_at).full,
          action_type: actionType,
          barcode: log.barcode,
          item_name: log.item_name ? log.item_name.split(' (Cut from ')[0] : log.item_name,
          changes: formatChangesText(log.changes, unitMap[log.barcode]),
          ...(() => {
            const d = describeLogChange(actionType, log.changes, unitMap[log.barcode]);
            return { summary: d.summary, details: d.details };
          })(),
          performed_by: (log.performed_by === 'Owner' || log.performed_by === 'owner' || log.performed_by === 'Administrator') ? ownerName : (log.performed_by || 'System'),
          source: 'audit'
        };
      });

      return {
        logs: normalizedAudit,
        totalCount: count !== null && count !== undefined ? count : normalizedAudit.length
      };
    },
    refetchInterval: 30000, // refresh every 30s
  });

  const rawLogs = auditResult?.logs || [];
  const totalCount = auditResult?.totalCount || rawLogs.length;

  const uniqueUsers = useMemo(() => {
    const set = new Set();
    rawLogs.forEach(log => {
      if (log.performed_by) set.add(log.performed_by);
    });
    return Array.from(set).sort();
  }, [rawLogs]);

  const filteredLogs = useMemo(() => {
    return rawLogs.filter(log => {
      if (activeFilter !== 'ALL' && log.action_type !== activeFilter) return false;
      if (selectedUser !== 'ALL' && log.performed_by !== selectedUser) return false;
      return true;
    });
  }, [rawLogs, activeFilter, selectedUser]);

  const getActionStyles = (action) => {
    const tone = ACTION_TONE[action] || 'neutral';
    return {
      accent: { bg: 'var(--color-accent-bg)', text: 'var(--color-accent)' },
      success: { bg: 'var(--color-success-bg)', text: 'var(--color-success)' },
      warning: { bg: 'var(--color-warning-bg)', text: 'var(--color-warning)' },
      error: { bg: 'var(--color-error-bg)', text: 'var(--color-error)' },
      purple: { bg: 'var(--color-purple-bg)', text: 'var(--color-purple)' },
      neutral: { bg: 'var(--bg-hover)', text: 'var(--text-secondary)' },
    }[tone];
  };

  // every action type: the known ones plus any other found in the loaded logs
  const FILTERS = ['ALL', ...Object.keys(ACTION_LABELS), ...[...new Set(rawLogs.map(l => l.action_type))].filter(a => a && !ACTION_LABELS[a])];

  return (
    <div className="flex flex-col h-full animate-fade-in w-full">
      <div className="flex flex-col gap-4 mb-6">
        <PageTitleReset
          title="Unified Audit Logs"
          onReset={handleResetAuditLogs}
          tooltip="Click title to reset audit log filters, user selection, and date to default"
        />
        
        <div className="flex flex-col md:flex-row gap-3 w-full items-start md:items-center">

          {/* Advanced Filter Toggle */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="h-10 px-4 text-sm font-semibold rounded-md flex items-center gap-2 transition-colors shrink-0 cursor-pointer" aria-pressed={showAdvanced}
            style={{
              backgroundColor: showAdvanced ? 'var(--color-accent-solid)' : 'var(--bg-input)',
              border: showAdvanced ? '1px solid var(--color-accent-solid)' : '1px solid var(--border-medium)',
              color: showAdvanced ? 'var(--text-on-solid)' : 'var(--text-primary)'
            }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
            </svg>
            Filters
          </button>

          {/* Quick Search across all data */}
          <div className="relative w-full md:w-80 shrink-0">
            <input
              type="text"
              placeholder="Search barcode, item, or user..."
              value={searchTerm}
              onChange={handleSearchChange}
              className="w-full h-10 pr-9 text-sm focus:outline-none shadow-sm rounded-md"
              style={{
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-input)',
                paddingLeft: '2.5rem'
              }}
            />
            <svg className="w-4 h-4 absolute left-3 top-3 pointer-events-none" style={{ color: 'var(--text-tertiary)' }} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            {searchTerm && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setDebouncedSearch('');
                  setSearchPage(0);
                }}
                className="absolute right-2.5 top-2.5 p-0.5 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                title="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Day Navigation & Date Picker */}
          {!isSearching ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-semibold uppercase text-[var(--text-secondary)]">Date:</span>
              <DateField
                value={currentDay}
                max={new Date().toLocaleDateString('en-CA')}
                onChange={(e) => {
                  const selected = e.target.value;
                  if (!selected) return;
                  const idx = availableDates.indexOf(selected);
                  if (idx >= 0) {
                    setDatePageIndex(idx);
                    setCustomDate('');
                  } else {
                    setCustomDate(selected);
                  }
                }}
                aria-label="Date filter"
                title="Jump to date"
              />
              {(datePageIndex > 0 || customDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomDate('');
                    setDatePageIndex(0);
                  }}
                  className={buttonClass({ variant: 'secondary', size: 'md' })}
                  title="Return to latest active day"
                >
                  Latest Day
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold" style={{ backgroundColor: 'var(--color-accent-bg)', color: 'var(--color-accent)' }}>
              <span>Searching all logs across all history</span>
            </div>
          )}
        </div>
      </div>

      {showAdvanced && (
        <div className="w-full p-4 md:p-6 rounded-xl shadow-sm flex flex-col gap-6 animate-scale-in mb-6" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Action Type</label>
              <div>
                <select value={activeFilter} onChange={e => setActiveFilter(e.target.value)} className="w-full py-2.5 pl-3 pr-8 text-sm focus:outline-none rounded-md cursor-pointer leading-normal" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}>
                  {FILTERS.map(f => <option key={f} value={f}>{f === 'ALL' ? 'All Actions' : (ACTION_LABELS[f] || f)}</option>)}
                </select>
              </div>
            </div>
            
            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Performed By</label>
              <div>
                <select value={selectedUser} onChange={e => setSelectedUser(e.target.value)} className="w-full py-2.5 pl-3 pr-8 text-sm focus:outline-none rounded-md cursor-pointer leading-normal" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}>
                  <option value="ALL">All Users</option>
                  {uniqueUsers.map(u => <option key={u} value={u} className="capitalize">{u}</option>)}
                </select>
              </div>
            </div>

            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Sort Order</label>
              <div>
                <select value={sortOrder} onChange={e => setSortOrder(e.target.value)} className="w-full py-2.5 pl-3 pr-8 text-sm focus:outline-none rounded-md cursor-pointer leading-normal" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}>
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-x-hidden overflow-y-auto shadow-sm md:rounded-lg border border-[var(--border-light)] mb-4" style={{ backgroundColor: 'transparent', overscrollBehavior: 'none' }}>
        {isLoading && rawLogs.length === 0 ? (
          <TableSkeleton rows={10} cols={5} label="Loading logs…" />
        ) : error ? (
          <div className="h-full min-h-[400px] flex items-center justify-center">
            <p className="text-sm font-semibold" style={{ color: 'var(--color-error)' }}>Failed to load logs: {error.message}</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="h-full min-h-[400px] flex items-center justify-center">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>
              {isSearching ? `No matching audit logs found across all history for "${searchTerm}".` : `No audit logs found for ${formatDayHeader(currentDay)}.`}
            </p>
          </div>
        ) : (
        <div className="w-full">
          <table className="block md:table w-full text-left md:text-center md:whitespace-nowrap border-collapse min-w-full">
          <thead className="hidden md:table-header-group sticky top-0 z-20 glass-header" style={{ borderBottom: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-tertiary)' }}>
            <tr className="h-10 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              <th className="p-3 w-40 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Date &amp; Time</th>
              <th className="p-3 w-24 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Action</th>
              <th className="p-3 w-24 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Barcode</th>
              <th className="p-3 w-64 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Item Name</th>
              <th className="p-3 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Changes Logged</th>
              <th className="p-3 w-24 text-center">User</th>
            </tr>
          </thead>
          <tbody className="block md:table-row-group p-2 md:p-0">
            {filteredLogs.map(log => {
              const styles = getActionStyles(log.action_type);
              const details = log.details || [];
              const isOpen = expandedIds.has(log.id);
              return (
                <Fragment key={log.id}>
                <tr className="transition-colors hover:bg-[var(--bg-hover)] group block md:table-row bg-[var(--bg-secondary)] md:bg-transparent rounded-lg md:rounded-none mb-3 md:mb-0 border border-[var(--border-medium)] md:border-b md:border-t-0 md:border-l-0 md:border-r-0 md:border-[var(--border-medium)] relative md:static" style={{ borderBottom: '1px solid var(--border-medium)' }}>
                  <td className="md:hidden block p-4 border-none w-full">
                    <div className="flex justify-between items-start mb-2 gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold tracking-widest text-[var(--color-accent)] mb-1">
                          {log.barcode === 'CATEGORY' || log.barcode === 'SUB-CATEGORY' || log.barcode === '---' ? <span style={{ color: 'var(--text-tertiary)' }}>—</span> : log.barcode}
                        </div>
                        <div className="text-sm font-bold text-[var(--text-primary)] leading-tight whitespace-normal break-words">{log.item_name}</div>
                        <div className="text-xs text-[var(--text-secondary)] mt-1">{log.date}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider rounded-sm text-right" style={{ backgroundColor: styles.bg, color: styles.text }}>
                          {String(log.action_type || '').replace(/_/g, ' ')}
                        </span>
                        <div className="text-[11px] uppercase text-[var(--text-tertiary)] font-bold mt-1">
                          By {log.performed_by}
                        </div>
                      </div>
                    </div>
                    {log.summary && log.summary !== '—' && (
                      <div className="mt-3 pt-3 border-t border-[var(--border-medium)] w-full flex flex-col gap-2">
                        <p className="text-sm text-[var(--text-primary)] whitespace-normal break-words">{log.summary}</p>
                        {details.length > 0 && <DetailsToggle count={details.length} open={isOpen} onClick={() => toggleExpanded(log.id)} />}
                        {isOpen && details.length > 0 && <LogDetails details={details} />}
                      </div>
                    )}
                  </td>
                  
                  <td className="hidden md:table-cell p-3 w-40 text-xs font-medium text-center" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}>
                    {log.date}
                  </td>
                  <td className="hidden md:table-cell p-3 w-24 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
                    <span className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider rounded-sm" style={{ 
                      backgroundColor: styles.bg,
                      color: styles.text
                    }}>
                      {String(log.action_type || '').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="hidden md:table-cell p-3 w-24 text-sm font-bold text-center" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--color-accent)' }}>
                    {log.barcode === 'CATEGORY' || log.barcode === 'SUB-CATEGORY' || log.barcode === '---' ? <span style={{ color: 'var(--text-tertiary)' }}>—</span> : log.barcode}
                  </td>
                  <td className="hidden md:table-cell p-3 w-64 text-sm font-medium text-center" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
                    <div title={String(log.item_name ?? '')} className="max-w-[220px] overflow-hidden text-ellipsis mx-auto">{log.item_name}</div>
                  </td>
                  <td className="hidden md:table-cell p-3 text-sm text-center whitespace-normal" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
                    <div className="flex flex-col items-center gap-1 max-w-[560px] mx-auto">
                      <span className={`break-words ${log.summary === '—' ? 'text-[var(--text-tertiary)]' : ''}`}>{log.summary}</span>
                      {details.length > 0 && <DetailsToggle count={details.length} open={isOpen} onClick={() => toggleExpanded(log.id)} />}
                    </div>
                  </td>
                  <td className="hidden md:table-cell p-3 w-24 text-xs text-center font-semibold capitalize" style={{ color: 'var(--text-secondary)' }}>
                    {log.performed_by}
                  </td>
                </tr>
                {isOpen && details.length > 0 && (
                  <tr className="hidden md:table-row" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
                    <td colSpan={6} className="px-6 py-3 whitespace-normal">
                      <LogDetails details={details} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
        )}
      </div>

      {/* Pagination Footer */}
      <div className="flex flex-row justify-between items-center gap-2 p-2.5 sm:p-3 mt-auto shadow-sm rounded-lg shrink-0 w-full" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)' }}>
        {!isSearching ? (
          <>
            <button 
              onClick={() => {
                setCustomDate('');
                setDatePageIndex(p => Math.max(0, p - 1));
              }} 
              disabled={datePageIndex === 0 && (!customDate || customDate === availableDates[0])} 
              className={buttonClass({ variant: 'secondary', size: 'sm', className: 'sm:px-4' })}
              title="Previous Day"
            >
              <span>&larr;<span className="hidden sm:inline"> Previous</span></span>
            </button>

            <div className="flex items-center gap-1.5 sm:gap-2 text-xs font-medium text-[var(--text-secondary)] text-center min-w-0">
              <span className="font-bold text-[var(--text-primary)] px-2 sm:px-2.5 py-1 rounded-md inline-flex items-center gap-1 sm:gap-1.5 truncate" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
                <Calendar className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
                <span className="truncate">{formatDayHeader(currentDay)}</span>
              </span>
              <span>•</span>
              <span className="shrink-0">{filteredLogs.length} {filteredLogs.length === 1 ? 'log' : 'logs'}</span>
              {availableDates.length > 0 && (
                <>
                  <span className="hidden sm:inline">•</span>
                  <span className="hidden sm:inline text-xs text-[var(--text-tertiary)]">
                    Day {availableDates.indexOf(currentDay) >= 0 ? availableDates.indexOf(currentDay) + 1 : datePageIndex + 1} of {availableDates.length}
                  </span>
                </>
              )}
            </div>

            <button 
              onClick={() => {
                setCustomDate('');
                setDatePageIndex(p => Math.min(Math.max(0, availableDates.length - 1), p + 1));
              }} 
              disabled={availableDates.length === 0 || (datePageIndex >= availableDates.length - 1 && (!customDate || customDate === availableDates[availableDates.length - 1]))} 
              className={buttonClass({ variant: 'secondary', size: 'sm', className: 'sm:px-4' })}
              title="Next Day"
            >
              <span><span className="hidden sm:inline">Next </span>&rarr;</span>
            </button>
          </>
        ) : (
          <>
            <button 
              onClick={() => setSearchPage(p => Math.max(0, p - 1))} 
              disabled={searchPage === 0} 
              className={buttonClass({ variant: 'secondary', size: 'sm', className: 'sm:px-5' })}
              title="Previous Page"
            >
              <span>&larr;<span className="hidden sm:inline"> Prev</span></span>
            </button>

            <div className="text-xs text-[var(--text-secondary)] text-center truncate px-1">
              <span className="font-semibold text-[var(--color-accent)] hidden sm:inline">Global Search: </span>Page {searchPage + 1} • {filteredLogs.length} items
            </div>

            <button 
              onClick={() => setSearchPage(p => p + 1)} 
              disabled={rawLogs.length < AUDIT_SEARCH_PER_PAGE} 
              className={buttonClass({ variant: 'secondary', size: 'sm', className: 'sm:px-5' })}
              title="Next Page"
            >
              <span><span className="hidden sm:inline">Next </span>&rarr;</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
