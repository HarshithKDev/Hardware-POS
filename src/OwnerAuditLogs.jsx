import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { Spinner, PageLoader } from './SharedUI';
import { debounce } from './utils';

export default function OwnerAuditLogs() {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [selectedUser, setSelectedUser] = useState('ALL');
  const [sortOrder, setSortOrder] = useState('newest');
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  const [limit, setLimit] = useState(300);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const debouncedSetSearch = useMemo(
    () => debounce((val) => setDebouncedSearch(val), 300),
    []
  );

  const handleSearchChange = useCallback((e) => {
    setSearchTerm(e.target.value);
    debouncedSetSearch(e.target.value);
  }, [debouncedSetSearch]);

  const { data: unifiedLogs, isLoading, error } = useQuery({
    queryKey: ['unifiedAuditLogs', limit, startDate, endDate],
    queryFn: async () => {
      // 1. Fetch native audit logs (Updates/Deletes)
      let auditQuery = supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (startDate) auditQuery = auditQuery.gte('created_at', `${startDate}T00:00:00`);
      if (endDate) auditQuery = auditQuery.lte('created_at', `${endDate}T23:59:59.999`);

      const [{ data: auditData, error: auditError }, { data: inventoryData }] = await Promise.all([
        auditQuery,
        supabase.from('inventory').select('barcode, unit')
      ]);
      
      if (auditError) throw auditError;

      const unitMap = (inventoryData || []).reduce((acc, item) => {
        acc[item.barcode] = item.unit;
        return acc;
      }, {});

      const formatChanges = (changesStr, unit) => {
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

      // 3. Normalize and map to unified structure
      const normalizedAudit = (auditData || []).map(log => {
        const actionType = log.action_type === 'RECEIVE' ? 'STOCK IN' : log.action_type;
        return {
          id: `audit-${log.id}`,
          timestamp: new Date(log.created_at).getTime(),
          date: new Date(log.created_at).toLocaleString(),
          action_type: actionType,
          barcode: log.barcode,
          item_name: log.item_name ? log.item_name.split(' (Cut from ')[0] : log.item_name,
          changes: formatChanges(log.changes, unitMap[log.barcode]),
          performed_by: log.performed_by || 'System',
          source: 'audit'
        };
      });

      return normalizedAudit;
    },
    refetchInterval: 30000, // refresh every 30s
  });

  const uniqueUsers = useMemo(() => {
    if (!unifiedLogs) return [];
    return [...new Set(unifiedLogs.map(log => log.performed_by))].sort();
  }, [unifiedLogs]);

  const filteredLogs = useMemo(() => {
    let result = unifiedLogs?.filter(log => {
      if (activeFilter !== 'ALL' && log.action_type !== activeFilter) return false;
      if (selectedUser !== 'ALL' && log.performed_by !== selectedUser) return false;
      
      if (!debouncedSearch) return true;
      
      const term = debouncedSearch.toLowerCase();
      const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regexStr = /[0-9]$/.test(term) ? escapedTerm + "(?![0-9])" : escapedTerm;
      const searchRegex = new RegExp(regexStr, 'i');

      return (
        (log.barcode && searchRegex.test(log.barcode)) ||
        (log.item_name && searchRegex.test(log.item_name)) ||
        (log.action_type && searchRegex.test(log.action_type)) ||
        (log.performed_by && searchRegex.test(log.performed_by))
      );
    }) || [];

    if (sortOrder === 'oldest') {
      result = [...result].reverse();
    }
    return result;
  }, [unifiedLogs, activeFilter, selectedUser, debouncedSearch, sortOrder]);

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

          {/* Quick Search */}
          <div className="relative w-full md:w-64 shrink-0">
            <input
              type="text"
              placeholder="Search barcode, item, or user..."
              value={searchTerm}
              onChange={handleSearchChange}
              className="w-full h-10 pl-10 pr-4 text-sm focus:outline-none shadow-sm rounded-md"
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
          </div>
        </div>
      </div>

      {showAdvanced && (
        <div className="w-full p-4 md:p-6 rounded-xl shadow-sm flex flex-col gap-6 animate-scale-in mb-6" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full h-11 md:h-10 px-3 text-sm focus:outline-none shadow-sm rounded-md cursor-pointer" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-input)', color: 'var(--text-input)' }} />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full h-11 md:h-10 px-3 text-sm focus:outline-none shadow-sm rounded-md cursor-pointer" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-input)', color: 'var(--text-input)' }} />
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Action Type</label>
              <div className="relative">
                <select value={activeFilter} onChange={e => setActiveFilter(e.target.value)} className="w-full h-11 md:h-10 pl-3 pr-8 text-sm focus:outline-none rounded-md appearance-none cursor-pointer" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}>
                  {FILTERS.map(f => <option key={f} value={f}>{f === 'ALL' ? 'All Actions' : f}</option>)}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3" style={{ color: 'var(--text-tertiary)' }}><svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg></div>
              </div>
            </div>
            
            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Performed By</label>
              <div className="relative">
                <select value={selectedUser} onChange={e => setSelectedUser(e.target.value)} className="w-full h-11 md:h-10 pl-3 pr-8 text-sm focus:outline-none rounded-md appearance-none cursor-pointer" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}>
                  <option value="ALL">All Users</option>
                  {uniqueUsers.map(u => <option key={u} value={u} className="capitalize">{u}</option>)}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3" style={{ color: 'var(--text-tertiary)' }}><svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg></div>
              </div>
            </div>

            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Sort Order</label>
              <div className="relative">
                <select value={sortOrder} onChange={e => setSortOrder(e.target.value)} className="w-full h-11 md:h-10 pl-3 pr-8 text-sm focus:outline-none rounded-md appearance-none cursor-pointer" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}>
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3" style={{ color: 'var(--text-tertiary)' }}><svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg></div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto overflow-x-hidden md:overflow-x-auto shadow-sm md:rounded-lg" style={{ backgroundColor: 'transparent' }}>
        <table className="w-full text-left md:whitespace-nowrap border-collapse block md:table min-w-0 md:min-w-[900px]">
          <thead className="hidden md:table-header-group sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-medium)' }}>
            <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              <th className="p-3 w-40 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Date & Time</th>
              <th className="p-3 w-24 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Action</th>
              <th className="p-3 w-24 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Barcode</th>
              <th className="p-3 w-64 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Item Name</th>
              <th className="p-3 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Changes Logged</th>
              <th className="p-3 w-24 text-center">User</th>
            </tr>
          </thead>
          <tbody className="block md:table-row-group p-2 md:p-0">
            {isLoading && limit === 300 ? (
              <tr className="block md:table-row"><td colSpan="6" className="block md:table-cell h-[50vh] align-middle text-center p-4"><PageLoader text="Loading logs..." /></td></tr>
            ) : error ? (
              <tr className="block md:table-row"><td colSpan="6" className="block md:table-cell p-8 text-center text-sm font-semibold text-[var(--color-error)]">Failed to load logs: {error.message}</td></tr>
            ) : filteredLogs.length === 0 ? (
              <tr className="block md:table-row"><td colSpan="6" className="block md:table-cell h-[50vh] align-middle text-center text-sm font-semibold p-4" style={{ color: 'var(--text-tertiary)' }}>No matching audit logs found.</td></tr>
            ) : (
              <>
                {filteredLogs.map(log => {
                  const styles = getActionStyles(log.action_type);
                  return (
                    <tr key={log.id} className="transition-colors hover:bg-[var(--bg-hover)] group block md:table-row bg-[var(--bg-secondary)] md:bg-transparent rounded-lg md:rounded-none mb-3 md:mb-0 border border-[var(--border-medium)] md:border-b md:border-t-0 md:border-l-0 md:border-r-0 md:border-[var(--border-light)] relative">
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
                          <div className="mt-3 pt-3 border-t border-[var(--border-medium)] text-xs text-[var(--text-primary)] leading-relaxed whitespace-normal break-words">
                            {log.changes}
                          </div>
                        )}
                      </td>
                      
                      <td className="hidden md:table-cell p-3 text-xs font-medium text-center" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>
                        {log.date}
                      </td>
                      <td className="hidden md:table-cell p-3 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>
                        <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm" style={{ 
                          backgroundColor: styles.bg,
                          color: styles.text
                        }}>
                          {log.action_type}
                        </span>
                      </td>
                      <td className="hidden md:table-cell p-3 text-sm font-mono font-semibold text-center" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--color-accent)' }}>
                        {log.barcode === 'CATEGORY' || log.barcode === 'SUB-CATEGORY' || log.barcode === '---' ? <span style={{ color: 'var(--text-tertiary)' }}>—</span> : log.barcode}
                      </td>
                      <td className="hidden md:table-cell p-3 text-sm font-medium text-center" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                        <div className="max-w-[220px] overflow-hidden text-ellipsis mx-auto">{log.item_name}</div>
                      </td>
                      <td className="hidden md:table-cell p-3 text-sm text-center" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                        <div className="w-full whitespace-normal overflow-hidden break-words mx-auto leading-relaxed">
                          {log.changes}
                        </div>
                      </td>
                      <td className="hidden md:table-cell p-3 text-xs text-center font-bold capitalize" style={{ color: 'var(--text-tertiary)' }}>
                        {log.performed_by}
                      </td>
                    </tr>
                  );
                })}
                {/* Load More Row */}
                {unifiedLogs && unifiedLogs.length >= limit && (
                  <tr className="block md:table-row">
                    <td colSpan="6" className="block md:table-cell p-4 text-center rounded-b-lg md:rounded-none" style={{ backgroundColor: 'var(--bg-quaternary)' }}>
                      <button 
                        onClick={() => setLimit(l => l + 300)} 
                        disabled={isLoading}
                        className="w-full md:w-auto h-11 md:h-8 px-6 text-sm md:text-xs font-bold uppercase tracking-wider rounded-md md:rounded-sm shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
                        style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-fg)' }}
                      >
                        {isLoading ? 'Loading...' : 'Load More Logs'}
                      </button>
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
