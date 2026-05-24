import { useState } from 'react';
import { supabase, provisioningClient } from './supabaseClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { generateId } from './utils';
import { getWorkerEmail } from './constants';
import { Spinner, PageLoader } from './SharedUI';

export default function OwnerStaff() {
  const { showAlert, showConfirm } = useApp();
  const queryClient = useQueryClient();

  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');

  const { data: staffList = [], isLoading } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data, error } = await supabase.from('workers').select('*').order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const addStaffMutation = useMutation({
    mutationFn: async ({ name, password }) => {
      const email = getWorkerEmail(name);
      
      const { data: authData, error: authError } = await provisioningClient.auth.signUp({
        email,
        password,
      });

      if (authError) {
        if (authError.message.toLowerCase().includes('already registered')) {
          console.warn('Auth account already exists, attempting to recover DB entry...');
        } else {
          throw new Error(authError.message);
        }
      } else if (!authData.user) {
        throw new Error("Failed to create worker account.");
      }

      const { error: dbError } = await supabase.from('workers').insert([{
        id: generateId(),
        name: name.trim(),
        password: 'SECURED_IN_AUTH'
      }]);

      if (dbError) throw new Error(dbError.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      setNewStaffName('');
      setNewStaffPassword('');
      showAlert('Staff member added successfully.', 'Success');
    },
    onError: (e) => showAlert(e.message, 'Failed to add staff'),
  });

  const removeStaffMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('workers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      showAlert(
        "Worker removed from active staff. \n\nIMPORTANT: To fully revoke login access, you must also delete their account from the Supabase Authentication dashboard.", 
        "Partial Success"
      );
    },
    onError: (e) => showAlert(e.message, 'Failed to remove staff'),
  });

  const handleAddStaff = (e) => {
    e.preventDefault();
    if (!newStaffName.trim()) return showAlert("Name cannot be empty.", "Validation");
    if (newStaffPassword.length < 6) return showAlert("Password must be at least 6 characters.", "Validation");
    addStaffMutation.mutate({ name: newStaffName, password: newStaffPassword });
  };

  const handleRemove = (id, name) => {
    showConfirm(
      `Remove ${name} from staff list? \n\nNote: This will prevent them from opening the terminal, but their Supabase Auth account will still exist.`,
      () => removeStaffMutation.mutate(id),
      "Confirm Removal"
    );
  };

  return (
    <div className="flex flex-col h-full gap-6 max-w-5xl mx-auto animate-fade-in w-full">
      <h1 className="text-2xl font-light" style={{ color: 'var(--text-primary)' }}>Manage Staff</h1>
      
      <div className="p-6 shadow-sm flex-shrink-0" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>Add New Cashier</h2>
        <form onSubmit={handleAddStaff} className="flex flex-col md:flex-row gap-4 items-start md:items-end">
          <div className="w-full md:flex-1">
            <label className="block text-xs font-semibold uppercase mb-1" style={{ color: 'var(--text-tertiary)' }} htmlFor="staff-name">Full Name</label>
            <input 
              id="staff-name"
              type="text" 
              value={newStaffName} 
              onChange={(e) => setNewStaffName(e.target.value)} 
              placeholder="e.g. John Doe" 
              className="w-full h-10 px-3 text-sm focus:outline-none" 
              style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} 
            />
          </div>
          <div className="w-full md:flex-1">
            <label className="block text-xs font-semibold uppercase mb-1" style={{ color: 'var(--text-tertiary)' }} htmlFor="staff-pwd">Login Password</label>
            <input 
              id="staff-pwd"
              type="text" 
              value={newStaffPassword} 
              onChange={(e) => setNewStaffPassword(e.target.value)} 
              placeholder="Min. 6 characters" 
              className="w-full h-10 px-3 text-sm focus:outline-none" 
              style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} 
            />
          </div>
          <div className="w-full md:w-auto">
            <button 
              type="submit" 
              disabled={addStaffMutation.isPending} 
              className="w-full md:w-auto h-10 px-8 text-white text-sm font-semibold uppercase tracking-wider disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-1 flex justify-center items-center min-w-[150px]" 
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {addStaffMutation.isPending ? <Spinner className="w-5 h-5 text-white" /> : 'Create Account'}
            </button>
          </div>
        </form>
      </div>

      <div className="flex-1 overflow-auto shadow-sm" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-medium)' }}>
            <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              <th className="p-4 w-1/2" style={{ borderRight: '1px solid var(--border-light)' }}>Staff Name</th>
              <th className="p-4 text-center w-1/2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan="2" className="p-8 text-center"><PageLoader text="Loading staff..." /></td></tr>
            ) : staffList.length === 0 ? (
              <tr><td colSpan="2" className="p-8 text-center text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>No staff members added yet.</td></tr>
            ) : staffList.map(staff => (
              <tr key={staff.id} className="transition-colors hover:bg-[var(--bg-hover)]" style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td className="p-4 text-sm font-medium" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-light)' }}>{staff.name}</td>
                <td className="p-4 text-center">
                  <button 
                    onClick={() => handleRemove(staff.id, staff.name)} 
                    disabled={removeStaffMutation.isPending}
                    className="h-8 px-4 text-xs font-semibold uppercase tracking-wider focus:outline-none transition-colors disabled:opacity-50"
                    style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--color-error)', border: '1px solid var(--color-error)' }}
                    onMouseEnter={(e) => {
                      if(!removeStaffMutation.isPending) {
                        e.target.style.backgroundColor = 'var(--color-error)';
                        e.target.style.color = '#ffffff';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if(!removeStaffMutation.isPending) {
                        e.target.style.backgroundColor = 'var(--bg-secondary)';
                        e.target.style.color = 'var(--color-error)';
                      }
                    }}
                    aria-label={`Remove ${staff.name}`}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}