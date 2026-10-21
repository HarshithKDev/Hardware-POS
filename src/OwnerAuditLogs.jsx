import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { Spinner, PageLoader } from './SharedUI';
import { debounce, formatDateTime, formatDayHeader, escapeIlike } from './utils';
import { useApp } from './AppContext';
import { X, Calendar } from 'lucide-react';

const formatChanges = (changes) => {
  if (!changes || changes === '—') return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
  
  const renderPill = (text, i) => {
    if (text.includes(': ')) {
      const [key, ...rest] = text.split(': ');
      return (
        <span key={i} className="inline-flex items-center px-2 py-1 rounded text-[11px] whitespace-nowrap" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)' }}>
          <span className="font-bold mr-1 uppercase text-[9px] tracking-wider" style={{ color: 'var(--text-secondary)' }}>{key}:</span>
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{rest.join(': ')}</span>
        </span>
      );
    }
    return (
      <span key={i} className="inline-flex items-center px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
        {text}
      </span>
    );
  };

  if (changes.includes(' | ')) {
    return (
      <div className="flex flex-wrap items-center justify-start md:justify-center gap-1.5 md:gap-2">
        {changes.split(' | ').map((part, i) => renderPill(part, i))}
      </div>
    );
  }

  if (changes.includes('(') && changes.includes(')')) {
    const mainText = changes.split('(')[0].trim();
    const innerText = changes.split('(')[1].split(')')[0].trim(); 
    
    return (
      <div className="flex flex-wrap items-center justify-start md:justify-center gap-1.5 md:gap-2">
        {renderPill(mainText, 'main')}
        {innerText.split(', ').map((part, i) => renderPill(part, `inner_${i}`))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-start md:justify-center gap-1.5 md:gap-2">
      {renderPill(changes, 'single')}
    </div>
  );
};

export default function OwnerAuditLogs() {
  const { shopSettings } = useApp();
  const ownerName = shopSettings?.owner_name || 'Owner';
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [selectedUser, setSelectedUser] = useState('ALL');
  const [sortOrder, setSortOrder] = useState('newest');
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  const [datePageIndex, setDatePageIndex] = useState(0);
  const [customDate, setCustomDate] = useState('');
  const [searchPage, setSearchPage] = useState(0);

  const AUDIT_SEARCH_PER_PAGE = 50;

  const debouncedSetSearch = useMemo(
    () => debounce((val) => {
      setDebouncedSearch(val);
      setSearchPage(0);
    }, 300),
    []
  );

  const handleSearchChange = useCallback((e) => {
    setSearchTerm(e.target.value);
    debouncedSetSearch(e.target.value);
  }, [debouncedSetSearch]);

  const shopId = localStorage.getItem('shop_id');

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
        const start = `${currentDay}T00:00:00`;
        const end = `${currentDay}T23:59:59.999`;
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
            if (data.price !== undefined) parts.push(`Price: ₹${data.price}`);
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
        const actionType = log.action_type === 'RECEIVE' ? 'STOCK IN' : log.action_type;
        return {
          id: `audit-${log.id}`,
          timestamp: new Date(log.created_at).getTime(),
          date: formatDateTime(log.created_at).full,
          action_type: actionType,
          barcode: log.barcode,
          item_name: log.item_name ? log.item_name.split(' (Cut from ')[0] : log.item_name,
          changes: formatChangesText(log.changes, unitMap[log.barcode]),
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
    switch (action) {
      case 'CREATE': return { bg: 'rgba(14, 165, 233, 0.1)', text: '#0ea5e9' }; // Sky blue
      case 'STOCK IN': return { bg: 'rgba(34, 197, 94, 0.1)', text: 'var(--color-success, #16a34a)' };
      case 'TRANSFER': return { bg: 'rgba(59, 130, 246, 0.1)', text: '#3b82f6' };
      case 'SALE': return { bg: 'rgba(168, 85, 247, 0.1)', text: '#a855f7' };
      case 'DELETE': return { bg: 'rgba(239, 68, 68, 0.1)', text: 'var(--color-error, #dc2626)' };
      case 'UPDATE': return { bg: 'rgba(234, 179, 8, 0.1)', text: '#ca8a04' };
      case 'RESTORE': return { bg: 'rgba(16, 185, 129, 0.1)', text: '#059669' };
      default: return { bg: 'var(--bg-hover)', text: 'var(--text-primary)' };
    }
  };

  const FILTERS = ['ALL', 'CREATE', 'STOCK IN', 'TRANSFER', 'SALE', 'UPDATE', 'DELETE', 'RESTORE'];

  return (
    <div className="flex flex-col h-full animate-fade-in w-full">
      <div className="flex flex-col gap-4 mb-6">
        <h1 className="text-2xl font-medium whitespace-nowrap shrink-0" style={{ color: 'var(--text-primary)' }}>Unified Audit Logs</h1>
        
        <div className="flex flex-col md:flex-row gap-3 w-full items-start md:items-center">

          {/* Advanced Filter Toggle */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="h-10 px-4 text-xs font-bold uppercase tracking-wider focus:outline-none shadow-sm rounded-md flex items-center gap-2 transition-colors shrink-0"
            style={{
              backgroundColor: showAdvanced ? 'var(--color-accent)' : 'var(--bg-input)',
              border: showAdvanced ? '1px solid var(--color-accent)' : '1px solid var(--border-medium)',
              color: showAdvanced ? '#fff' : 'var(--text-primary)'
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
              <input
                type="date"
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
                className="h-10 px-2.5 text-xs font-semibold focus:outline-none rounded-md shadow-sm cursor-pointer"
                style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
                title="Jump to date"
              />
              {(datePageIndex > 0 || customDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomDate('');
                    setDatePageIndex(0);
                  }}
                  className="h-10 px-2.5 text-[11px] font-bold uppercase tracking-wider rounded-md transition-colors hover:bg-[var(--bg-hover)]"
                  style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)', color: 'var(--color-accent)' }}
                  title="Return to latest active day"
                >
                  Latest Day
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: 'var(--color-accent)' }}>
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
                  {FILTERS.map(f => <option key={f} value={f}>{f === 'ALL' ? 'All Actions' : f}</option>)}
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
          <div className="h-full min-h-[400px] flex flex-col items-center justify-center">
            <PageLoader text="Loading logs..." />
          </div>
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
          <table className="block md:table w-full text-left md:whitespace-nowrap border-collapse min-w-full">
          <thead className="hidden md:table-header-group sticky top-0 z-20 glass-header" style={{ borderBottom: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-tertiary)' }}>
            <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
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
              return (
                <tr key={log.id} className="transition-colors hover:bg-[var(--bg-hover)] group block md:table-row bg-[var(--bg-secondary)] md:bg-transparent rounded-lg md:rounded-none mb-3 md:mb-0 border border-[var(--border-medium)] md:border-b md:border-t-0 md:border-l-0 md:border-r-0 md:border-[var(--border-medium)] relative" style={{ borderBottom: '1px solid var(--border-medium)' }}>
                  <td className="md:hidden block p-4 border-none w-full">
                    <div className="flex justify-between items-start mb-2 gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-bold tracking-widest text-[var(--color-accent)] mb-1">
                          {log.barcode === 'CATEGORY' || log.barcode === 'SUB-CATEGORY' || log.barcode === '---' ? <span style={{ color: 'var(--text-tertiary)' }}>—</span> : log.barcode}
                        </div>
                        <div className="text-sm font-bold text-[var(--text-primary)] leading-tight whitespace-normal break-words">{log.item_name}</div>
                        <div className="text-[10px] text-[var(--text-secondary)] mt-1">{log.date}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm text-right" style={{ backgroundColor: styles.bg, color: styles.text }}>
                          {log.action_type}
                        </span>
                        <div className="text-[10px] uppercase text-[var(--text-tertiary)] font-bold mt-1">
                          By {log.performed_by}
                        </div>
                      </div>
                    </div>
                    {log.changes && log.changes !== '—' && (
                      <div className="mt-3 pt-3 border-t border-[var(--border-medium)] w-full">
                        {formatChanges(log.changes)}
                      </div>
                    )}
                  </td>
                  
                  <td className="hidden md:table-cell p-3 w-40 text-xs font-medium text-center" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}>
                    {log.date}
                  </td>
                  <td className="hidden md:table-cell p-3 w-24 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
                    <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm" style={{ 
                      backgroundColor: styles.bg,
                      color: styles.text
                    }}>
                      {log.action_type}
                    </span>
                  </td>
                  <td className="hidden md:table-cell p-3 w-24 text-sm font-bold text-center" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--color-accent)' }}>
                    {log.barcode === 'CATEGORY' || log.barcode === 'SUB-CATEGORY' || log.barcode === '---' ? <span style={{ color: 'var(--text-tertiary)' }}>—</span> : log.barcode}
                  </td>
                  <td className="hidden md:table-cell p-3 w-64 text-sm font-medium text-center" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
                    <div className="max-w-[220px] overflow-hidden text-ellipsis mx-auto">{log.item_name}</div>
                  </td>
                  <td className="hidden md:table-cell p-3 text-sm text-center" style={{ borderRight: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
                    <div className="w-full mx-auto">
                      {formatChanges(log.changes)}
                    </div>
                  </td>
                  <td className="hidden md:table-cell p-3 w-24 text-xs text-center font-bold capitalize" style={{ color: 'var(--text-tertiary)' }}>
                    {log.performed_by}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        )}
      </div>

      {/* Pagination Footer */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-3 p-3 mt-auto shadow-sm rounded-lg shrink-0" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-medium)' }}>
        {!isSearching ? (
          <>
            <button 
              onClick={() => {
                setCustomDate('');
                setDatePageIndex(p => Math.max(0, p - 1));
              }} 
              disabled={datePageIndex === 0 && (!customDate || customDate === availableDates[0])} 
              className="h-8 px-4 text-xs font-semibold disabled:opacity-40 focus:outline-none rounded-md transition-colors hover:bg-[var(--bg-hover)] flex items-center gap-1.5"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
              title="View newer day"
            >
              <span>&larr; Previous (Newer)</span>
            </button>

            <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] text-center">
              <span className="font-bold text-[var(--text-primary)] px-2.5 py-1 rounded-md inline-flex items-center gap-1.5" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
                <Calendar className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
                <span>{formatDayHeader(currentDay)}</span>
              </span>
              <span>•</span>
              <span>{filteredLogs.length} {filteredLogs.length === 1 ? 'log' : 'logs'}</span>
              {availableDates.length > 0 && (
                <>
                  <span>•</span>
                  <span className="text-[11px] text-[var(--text-tertiary)]">
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
              className="h-8 px-4 text-xs font-semibold disabled:opacity-40 focus:outline-none rounded-md transition-colors hover:bg-[var(--bg-hover)] flex items-center gap-1.5"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
              title="View older day (yesterday & before)"
            >
              <span>Next (Older Day) &rarr;</span>
            </button>
          </>
        ) : (
          <>
            <button 
              onClick={() => setSearchPage(p => Math.max(0, p - 1))} 
              disabled={searchPage === 0} 
              className="h-8 px-5 text-xs font-semibold disabled:opacity-40 focus:outline-none rounded-md transition-colors hover:bg-[var(--bg-hover)]"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
            >
              Previous
            </button>

            <div className="text-xs text-[var(--text-secondary)] text-center">
              <span className="font-semibold text-[var(--color-accent)]">Global Search:</span> Results for "{searchTerm}" • Page {searchPage + 1} ({filteredLogs.length} items)
            </div>

            <button 
              onClick={() => setSearchPage(p => p + 1)} 
              disabled={rawLogs.length < AUDIT_SEARCH_PER_PAGE} 
              className="h-8 px-5 text-xs font-semibold disabled:opacity-40 focus:outline-none rounded-md transition-colors hover:bg-[var(--bg-hover)]"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
            >
              Next
            </button>
          </>
        )}
      </div>
    </div>
  );
}
