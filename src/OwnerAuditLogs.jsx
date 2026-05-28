import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { Spinner } from './SharedUI';

export default function OwnerAuditLogs() {
  const [searchTerm, setSearchTerm] = useState('');

  const { data: logs, isLoading, error } = useQuery({
    queryKey: ['auditLogs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000, // refresh every 30s
  });

  const filteredLogs = logs?.filter(log => 
    log.barcode.toLowerCase().includes(searchTerm.toLowerCase()) || 
    log.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.action_type.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="flex flex-col h-full animate-fade-in max-w-7xl mx-auto w-full">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-light mb-2" style={{ color: 'var(--text-primary)' }}>Audit Logs</h1>
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Permanent record of manual item modifications and deletions
          </p>
        </div>
        <div className="relative w-full md:w-72">
          <input
            type="text"
            placeholder="Search logs by item or barcode..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-10 pl-10 pr-4 text-sm focus:outline-none"
            style={{
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-input)'
            }}
          />
          <svg className="w-4 h-4 absolute left-3 top-3" style={{ color: 'var(--text-tertiary)' }} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
      </div>

      <div className="flex-1 overflow-auto shadow-sm" style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)' }}>
        <table className="w-full text-left whitespace-nowrap border-collapse min-w-[800px]">
          <thead className="sticky top-0" style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-medium)' }}>
            <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              <th className="p-3 w-40" style={{ borderRight: '1px solid var(--border-light)' }}>Date & Time</th>
              <th className="p-3 w-28" style={{ borderRight: '1px solid var(--border-light)' }}>Action</th>
              <th className="p-3 w-28" style={{ borderRight: '1px solid var(--border-light)' }}>Barcode</th>
              <th className="p-3 w-48" style={{ borderRight: '1px solid var(--border-light)' }}>Item Name</th>
              <th className="p-3" style={{ borderRight: '1px solid var(--border-light)' }}>Changes</th>
              <th className="p-3 w-28 text-center">User</th>
            </tr>
          </thead>
          <tbody style={{ borderBottom: '1px solid var(--border-medium)' }}>
            {isLoading ? (
              <tr><td colSpan="6" className="p-8 text-center"><Spinner size="md" /></td></tr>
            ) : error ? (
              <tr><td colSpan="6" className="p-8 text-center text-sm font-semibold text-[var(--color-error)]">Failed to load logs: {error.message}</td></tr>
            ) : filteredLogs.length === 0 ? (
              <tr><td colSpan="6" className="p-8 text-center text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>No audit logs found.</td></tr>
            ) : (
              filteredLogs.map(log => (
                <tr key={log.id} className="transition-colors hover:bg-[var(--bg-hover)]" style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td className="p-3 text-xs" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}>
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="p-3" style={{ borderRight: '1px solid var(--border-light)' }}>
                    <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm" style={{ 
                      backgroundColor: log.action_type === 'DELETE' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                      color: log.action_type === 'DELETE' ? 'var(--color-error)' : '#3b82f6'
                    }}>
                      {log.action_type}
                    </span>
                  </td>
                  <td className="p-3 text-sm font-mono font-semibold" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--color-accent)' }}>{log.barcode}</td>
                  <td className="p-3 text-sm font-medium" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>{log.item_name}</td>
                  <td className="p-3 text-sm whitespace-normal" style={{ borderRight: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>{log.changes}</td>
                  <td className="p-3 text-xs text-center font-bold" style={{ color: 'var(--text-tertiary)' }}>{log.performed_by}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
