import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { Spinner, PageLoader } from './SharedUI';

export default function OwnerAuditLogs() {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');

  const { data: unifiedLogs, isLoading, error } = useQuery({
    queryKey: ['unifiedAuditLogs'],
    queryFn: async () => {
      // 1. Fetch native audit logs (Updates/Deletes)
      const { data: auditData, error: auditError } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);
      
      if (auditError) throw auditError;

      // 2. Fetch Bills (Receives/Transfers) and their items
      const { data: billsData, error: billsError } = await supabase
        .from('bills')
        .select('*, bill_items(*)')
        .in('location', ['Warehouse-Inbound', 'Warehouse-Transfer'])
        .order('created_at', { ascending: false })
        .limit(300);

      if (billsError) throw billsError;

      const formatChanges = (changesStr) => {
        if (!changesStr) return '—';
        if (typeof changesStr === 'string' && changesStr.trim().startsWith('{')) {
          try {
            const data = JSON.parse(changesStr);
            let parts = [];
            if (data.quantity !== undefined) parts.push(`Qty: ${data.quantity}`);
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
      const normalizedAudit = (auditData || []).map(log => ({
        id: `audit-${log.id}`,
        timestamp: new Date(log.created_at).getTime(),
        date: new Date(log.created_at).toLocaleString(),
        action_type: log.action_type,
        barcode: log.barcode,
        item_name: log.item_name,
        changes: formatChanges(log.changes),
        performed_by: log.performed_by || 'System',
        source: 'audit'
      }));

      const normalizedBills = (billsData || []).flatMap(bill => {
        const isReceive = bill.location === 'Warehouse-Inbound';
        return (bill.bill_items || []).map(item => ({
          id: `bill-${bill.id}-${item.id}`,
          timestamp: new Date(bill.created_at).getTime(),
          date: new Date(bill.created_at).toLocaleString(),
          action_type: isReceive ? 'STOCK IN' : 'TRANSFER',
          barcode: item.barcode || '---',
          item_name: item.name,
          changes: isReceive 
            ? `Warehouse Stock +${item.quantity}` 
            : `Warehouse Stock -${item.quantity}, Store Stock +${item.quantity}`,
          performed_by: bill.cashier_name || 'System',
          source: 'bill'
        }));
      });

      // 4. Merge and sort by newest first
      const merged = [...normalizedAudit, ...normalizedBills].sort((a, b) => b.timestamp - a.timestamp);
      return merged;
    },
    refetchInterval: 30000, // refresh every 30s
  });

  const filteredLogs = unifiedLogs?.filter(log => {
    // 1. Apply Action Filter
    if (activeFilter !== 'ALL' && log.action_type !== activeFilter) return false;
    
    // 2. Apply Text Search
    if (!searchTerm) return true;
    
    const term = searchTerm.toLowerCase();
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
      case 'STOCK IN': return { bg: 'rgba(34, 197, 94, 0.1)', text: 'var(--color-success, #16a34a)' };
      case 'TRANSFER': return { bg: 'rgba(59, 130, 246, 0.1)', text: '#3b82f6' };
      case 'DELETE': return { bg: 'rgba(239, 68, 68, 0.1)', text: 'var(--color-error, #dc2626)' };
      case 'UPDATE': return { bg: 'rgba(234, 179, 8, 0.1)', text: '#ca8a04' };
      case 'RESTORE': return { bg: 'rgba(16, 185, 129, 0.1)', text: '#059669' };
      default: return { bg: 'var(--bg-hover)', text: 'var(--text-primary)' };
    }
  };

  const FILTERS = ['ALL', 'STOCK IN', 'TRANSFER', 'UPDATE', 'DELETE', 'RESTORE'];

  return (
    <div className="flex flex-col h-full animate-fade-in max-w-7xl mx-auto w-full">
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-light mb-2" style={{ color: 'var(--text-primary)' }}>Unified Audit Logs</h1>
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Track every single change across the store and warehouse in real-time.
          </p>
        </div>
        
        <div className="flex flex-col md:flex-row gap-3 w-full xl:w-auto">
          {/* Quick Filters */}
          <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
            {FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors whitespace-nowrap"
                style={{
                  backgroundColor: activeFilter === f ? 'var(--color-accent)' : 'var(--bg-secondary)',
                  color: activeFilter === f ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${activeFilter === f ? 'var(--color-accent)' : 'var(--border-medium)'}`
                }}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Quick Search */}
          <div className="relative w-full md:w-64 shrink-0">
            <input
              type="text"
              placeholder="Search barcode, item, or user..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
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
        <table className={`w-full text-left whitespace-nowrap border-collapse min-w-[900px] ${(isLoading || filteredLogs.length === 0 || error) ? 'h-full' : ''}`}>
          <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-medium)' }}>
            <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              <th className="p-3 w-44 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Date & Time</th>
              <th className="p-3 w-28 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Action</th>
              <th className="p-3 w-32 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Barcode</th>
              <th className="p-3 w-56 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Item Name</th>
              <th className="p-3 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Changes Logged</th>
              <th className="p-3 w-32 text-center">User</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan="6" className="h-[50vh] align-middle text-center"><PageLoader text="Loading logs..." /></td></tr>
            ) : error ? (
              <tr><td colSpan="6" className="p-8 text-center text-sm font-semibold text-[var(--color-error)]">Failed to load logs: {error.message}</td></tr>
            ) : filteredLogs.length === 0 ? (
              <tr><td colSpan="6" className="h-full align-middle text-center text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>No matching audit logs found.</td></tr>
            ) : (
              filteredLogs.map(log => {
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
                      {log.item_name}
                    </td>
                    <td className="p-3 text-sm whitespace-normal text-center" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                      {log.changes}
                    </td>
                    <td className="p-3 text-xs text-center font-bold capitalize" style={{ color: 'var(--text-tertiary)' }}>
                      {log.performed_by}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
