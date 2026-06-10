import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { Spinner, PageLoader } from './SharedUI';
import { debounce } from './utils';

export default function OwnerAuditLogs() {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');
  
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

  const filteredLogs = unifiedLogs?.filter(log => {
    // 1. Apply Action Filter
    if (activeFilter !== 'ALL' && log.action_type !== activeFilter) return false;
    
    // 2. Apply Text Search
    if (!debouncedSearch) return true;
    
    const term = debouncedSearch.toLowerCase();
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Smart matching: If the search term ends with a number, prevent it from matching 
    // if the very next character is ALSO a number. (e.g. '1' won't match '10')
    const regexStr = /[0-9]$/.test(term) ? escapedTerm + "(?![0-9])" : escapedTerm;
    const searchRegex = new RegExp(regexStr, 'i');

    return (
      (log.barcode && searchRegex.test(log.barcode)) ||
      (log.item_name && searchRegex.test(log.item_name)) ||
      (log.action_type && searchRegex.test(log.action_type)) ||
      (log.performed_by && searchRegex.test(log.performed_by))
    );
  }) || [];

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
    <div className="flex flex-col h-full animate-fade-in max-w-7xl mx-auto w-full">
      <div className="flex flex-col gap-4 mb-6">
        <h1 className="text-2xl font-light" style={{ color: 'var(--text-primary)' }}>Unified Audit Logs</h1>
        
        <div className="flex flex-col md:flex-row gap-3 w-full items-start md:items-center">
          {/* Date Filters */}
          <div className="flex gap-2 shrink-0">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 px-3 text-xs font-semibold uppercase tracking-wider focus:outline-none shadow-sm"
              style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-medium)', color: 'var(--text-input)' }}
              title="Start Date"
            />
            <span className="flex items-center text-xs font-bold" style={{ color: 'var(--text-tertiary)' }}>TO</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 px-3 text-xs font-semibold uppercase tracking-wider focus:outline-none shadow-sm"
              style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-medium)', color: 'var(--text-input)' }}
              title="End Date"
            />
          </div>

          {/* Quick Filters */}
          <div className="relative shrink-0">
            <select
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value)}
              className="appearance-none h-9 pl-3 pr-8 text-xs font-bold uppercase tracking-wider focus:outline-none shadow-sm cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-primary)'
              }}
            >
              {FILTERS.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2" style={{ color: 'var(--text-tertiary)' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
          </div>

          {/* Quick Search */}
          <div className="relative w-full md:w-64 shrink-0">
            <input
              type="text"
              placeholder="Search barcode, item, or user..."
              value={searchTerm}
              onChange={handleSearchChange}
              className="w-full h-9 pl-9 pr-4 text-sm focus:outline-none shadow-sm"
              style={{
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-input)'
              }}
            />
            <svg className="w-4 h-4 absolute left-3 top-2.5" style={{ color: 'var(--text-tertiary)' }} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto shadow-sm" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)' }}>
        <table className="w-full text-left whitespace-nowrap border-collapse min-w-[900px]">
          <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-medium)' }}>
            <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              <th className="p-3 w-40 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Date & Time</th>
              <th className="p-3 w-24 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Action</th>
              <th className="p-3 w-24 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Barcode</th>
              <th className="p-3 w-64 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Item Name</th>
              <th className="p-3 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Changes Logged</th>
              <th className="p-3 w-24 text-center">User</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && limit === 300 ? (
              <tr><td colSpan="6" className="h-[50vh] align-middle text-center"><PageLoader text="Loading logs..." /></td></tr>
            ) : error ? (
              <tr><td colSpan="6" className="p-8 text-center text-sm font-semibold text-[var(--color-error)]">Failed to load logs: {error.message}</td></tr>
            ) : filteredLogs.length === 0 ? (
              <tr><td colSpan="6" className="h-[50vh] align-middle text-center text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>No matching audit logs found.</td></tr>
            ) : (
              <>
                {filteredLogs.map(log => {
                  const styles = getActionStyles(log.action_type);
                  return (
                    <tr key={log.id} className="transition-colors hover:bg-[var(--bg-hover)] group" style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td className="p-3 text-xs font-medium text-center" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>
                        {log.date}
                      </td>
                      <td className="p-3 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>
                        <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm" style={{ 
                          backgroundColor: styles.bg,
                          color: styles.text
                        }}>
                          {log.action_type}
                        </span>
                      </td>
                      <td className="p-3 text-sm font-mono font-semibold text-center" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--color-accent)' }}>
                        {log.barcode === 'CATEGORY' || log.barcode === 'SUB-CATEGORY' || log.barcode === '---' ? <span style={{ color: 'var(--text-tertiary)' }}>—</span> : log.barcode}
                      </td>
                      <td className="p-3 text-sm font-medium text-center" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                        <div className="max-w-[220px] overflow-hidden text-ellipsis mx-auto">{log.item_name}</div>
                      </td>
                      <td className="p-3 text-sm text-center" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                        <div className="w-full whitespace-normal overflow-hidden break-words mx-auto leading-relaxed">
                          {log.changes}
                        </div>
                      </td>
                      <td className="p-3 text-xs text-center font-bold capitalize" style={{ color: 'var(--text-tertiary)' }}>
                        {log.performed_by}
                      </td>
                    </tr>
                  );
                })}
                {/* Load More Row */}
                {unifiedLogs && unifiedLogs.length >= limit && (
                  <tr>
                    <td colSpan="6" className="p-4 text-center" style={{ backgroundColor: 'var(--bg-quaternary)' }}>
                      <button 
                        onClick={() => setLimit(l => l + 300)} 
                        disabled={isLoading}
                        className="px-6 py-2 text-xs font-bold uppercase tracking-wider rounded-sm shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
                        style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
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
