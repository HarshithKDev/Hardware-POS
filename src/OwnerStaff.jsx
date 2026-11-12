import { useState } from 'react';
import { getPerformedBy } from './utils';
import { supabase, provisioningClient } from './supabaseClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { generateId } from './utils';
import { getWorkerEmail, getAdminEmail } from './constants';
import { Spinner, PageLoader } from './SharedUI';
import PageTitleReset from './components/PageTitleReset';
import { buttonClass, Modal, Button, Input, TableSkeleton } from './components/ui';

export default function OwnerStaff() {
  const { showAlert, showConfirm } = useApp();
  const queryClient = useQueryClient();

  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [newStaffIsBillable, setNewStaffIsBillable] = useState("true");
  // Phones: the add form opens on demand so the staff list is visible first
  const [showAddForm, setShowAddForm] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [promptPassword, setPromptPassword] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const handleResetStaff = () => {
    setNewStaffName('');
    setNewStaffPassword('');
    setNewStaffIsBillable('true');
  };

  const shopId = localStorage.getItem('shop_id');

  const { data: staffList = [], isLoading } = useQuery({
    queryKey: ['staff', shopId],
    queryFn: async () => {
      let query = supabase.from('workers').select('*').order('name', { ascending: true });
      if (shopId) {
        query = query.eq('shop_id', shopId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  const addStaffMutation = useMutation({
    mutationFn: async ({ name, password, isBillable }) => {
      const email = getWorkerEmail(name, shopId);

      const { data: authData, error: authError } = await provisioningClient.auth.signUp({
        email,
        password,
      });

      if (authError) {
        if (authError.message.toLowerCase().includes('already registered')) {
          throw new Error("This staff member already exists in the Auth system but failed to save to the database previously. Please delete them from the Supabase Authentication Dashboard first, and then try creating them again.");
        } else {
          throw new Error(authError.message);
        }
      } else if (!authData?.user) {
        throw new Error("Failed to create worker account.");
      }

      const { error: dbError } = await supabase.from('workers').insert([{
        id: authData.user.id,
        shop_id: shopId,
        name: name.trim(),
        password: isBillable ? 'SECURED_IN_AUTH:BILLABLE' : 'SECURED_IN_AUTH:NON_BILLABLE'
      }]);

      if (dbError) throw new Error(dbError.message);

      await supabase.from('audit_logs').insert([{
        shop_id: shopId,
        action_type: 'CREATE',
        barcode: 'STAFF',
        item_name: name.trim(),
        changes: `Created Staff Account: ${name.trim()} (${isBillable ? 'Billable' : 'Non-Billable'})`,
        performed_by: getPerformedBy()
      }]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      setNewStaffName('');
      setNewStaffPassword('');
      setNewStaffIsBillable("true");
      showAlert('Staff member added successfully.', 'Success');
    },
    onError: (e) => showAlert(e.message, 'Failed to add staff'),
  });

  const removeStaffMutation = useMutation({
    mutationFn: async ({ id, name }) => {
      let delQuery = supabase.from('workers').delete().eq('id', id);
      if (shopId) {
        delQuery = delQuery.eq('shop_id', shopId);
      }
      const { error } = await delQuery;
      if (error) throw error;

      await supabase.from('audit_logs').insert([{
        shop_id: shopId,
        action_type: 'DELETE',
        barcode: 'STAFF',
        item_name: name,
        changes: `Removed Staff Account: ${name}`,
        performed_by: getPerformedBy()
      }]);
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
    
    setPromptPassword('');
    setShowPromptModal(true);
  };

  const confirmAddStaff = async (e) => {
    e.preventDefault();
    if (!promptPassword) return;

    setIsVerifying(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: getAdminEmail(),
        password: promptPassword
      });
      
      if (authError) {
        setIsVerifying(false);
        return showAlert("Invalid Owner Password. Cannot add staff.", "Authentication Failed");
      }

      addStaffMutation.mutate({ name: newStaffName, password: newStaffPassword, isBillable: newStaffIsBillable === "true" });
      setShowPromptModal(false);
    } catch (err) {
      showAlert(err.message, "Error");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRemove = (id, name) => {
    showConfirm(
      `Remove ${name} from staff list? \n\nNote: This will prevent them from opening the terminal, but their Supabase Auth account will still exist.`,
      () => removeStaffMutation.mutate({ id, name }),
      "Remove Staff",
      "Remove Staff",
      "Cancel",
      true
    );
  };

  return (
    <div className="flex flex-col h-full gap-6 animate-fade-in w-full">
      <PageTitleReset
        title="Manage Staff"
        onReset={handleResetStaff}
        tooltip="Click title to clear staff form inputs"
      />

      <div className={`${showAddForm ? 'p-4 bg-[var(--bg-secondary)]' : 'p-0 max-md:border-0 md:bg-[var(--bg-secondary)]'} md:p-6 rounded-lg flex-shrink-0 border border-[var(--border-light)]`}>
        <button
          type="button"
          onClick={() => setShowAddForm(v => !v)}
          aria-expanded={showAddForm}
          className={buttonClass({ variant: showAddForm ? 'secondary' : 'primary', size: 'md', className: `md:hidden w-full ${showAddForm ? 'mb-4' : ''}` })}
        >
          {showAddForm ? 'Close' : '+ Add New Cashier'}
        </button>
        <h2 className={`${showAddForm ? '' : 'max-md:hidden'} text-sm font-semibold uppercase tracking-wider mb-4`} style={{ color: 'var(--text-secondary)' }}>Add New Cashier</h2>
        <form onSubmit={handleAddStaff} className={`${showAddForm ? '' : 'max-md:hidden'} flex flex-col md:flex-row gap-4 items-start md:items-end`}>
          <div className="w-full md:flex-1">
            <label className="block text-xs font-semibold uppercase mb-1" style={{ color: 'var(--text-tertiary)' }} htmlFor="staff-name">Full Name</label>
            <input
              id="staff-name"
              type="text"
              value={newStaffName}
              onChange={(e) => setNewStaffName(e.target.value)}
              placeholder="e.g. John Doe"
              className="w-full h-10 px-3 text-sm focus:outline-none rounded-md"
              style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
            />
          </div>
          <div className="w-full md:flex-1">
            <label className="block text-xs font-semibold uppercase mb-1" style={{ color: 'var(--text-tertiary)' }} htmlFor="staff-pwd">Login Password</label>
            <div className="relative">
              <input
                id="staff-pwd"
                type={showNewPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={newStaffPassword}
                onChange={(e) => setNewStaffPassword(e.target.value)}
                placeholder="Min. 6 characters"
                className="w-full h-10 pl-3 pr-16 text-sm focus:outline-none rounded-md"
                style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(v => !v)}
                aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                className="tap-area absolute inset-y-0 right-0 px-3 text-xs font-semibold text-[var(--color-accent)] bg-transparent border-0"
              >
                {showNewPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div className="w-full md:flex-1">
            <label className="block text-xs font-semibold uppercase mb-1" style={{ color: 'var(--text-tertiary)' }} htmlFor="staff-type">Account Type</label>
            <div className="relative">
              <select
                id="staff-type"
                value={newStaffIsBillable}
                onChange={(e) => setNewStaffIsBillable(e.target.value)}
                className="w-full h-10 px-3 text-sm focus:outline-none rounded-md appearance-none cursor-pointer"
                style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
              >
                <option value="true">Billable</option>
                <option value="false">Non-Billable</option>
              </select>
            </div>
          </div>
          <div className="w-full md:w-auto">
            <button
              type="submit"
              disabled={addStaffMutation.isPending}
              className={buttonClass({ variant: 'primary', size: 'md', className: 'w-full md:w-auto min-w-[150px]' })}
            >
              {addStaffMutation.isPending ? <Spinner className="w-5 h-5 text-white" /> : 'Create Account'}
            </button>
          </div>
        </form>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-[var(--border-light)] shadow-sm" style={{ backgroundColor: 'var(--bg-secondary)', overscrollBehavior: 'none' }}>
        {/* Mobile View: Card List */}
        <div className="md:hidden flex flex-col divide-y divide-[var(--border-medium)]">
          {isLoading ? (
            <TableSkeleton rows={4} cols={2} label="Loading staff…" />
          ) : staffList.length === 0 ? (
            <div className="p-8 text-center text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>No staff members added yet.</div>
          ) : staffList.map(staff => (
            <div key={staff.id} className="p-4 flex items-center justify-between gap-3">
              <div className="flex flex-col gap-1 min-w-0">
                <span title={String(staff.name ?? '')} className="font-bold text-base truncate" style={{ color: 'var(--text-primary)' }}>{staff.name}</span>
                <div>
                  {staff.password?.includes('NON_BILLABLE') ? (
                    <span className="px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider rounded-sm inline-block" style={{ backgroundColor: 'var(--color-error-bg)', color: 'var(--color-error)' }}>
                      Non-Billable
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider rounded-sm inline-block" style={{ backgroundColor: 'var(--color-success-bg)', color: 'var(--color-success)' }}>
                      Billable
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleRemove(staff.id, staff.name)}
                disabled={removeStaffMutation.isPending}
                className={buttonClass({ variant: 'danger-outline', size: 'sm', className: 'shrink-0' })}
                aria-label={`Remove ${staff.name}`}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        {/* Laptop / Desktop View: Exact Table */}
        <table className={`hidden md:table w-full min-w-[480px] text-center border-collapse ${(isLoading || staffList.length === 0) ? 'h-full' : ''}`}>
          <thead className="sticky top-0 z-20" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
            <tr className="h-10 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              <th className="p-4 w-5/12 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Staff Name</th>
              <th className="p-4 w-4/12 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>Account Type</th>
              <th className="p-4 text-center w-3/12">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan="3" className="p-0"><TableSkeleton rows={4} cols={3} label="Loading staff…" /></td></tr>
            ) : staffList.length === 0 ? (
              <tr><td colSpan="3" className="h-full align-middle text-center text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>No staff members added yet.</td></tr>
            ) : staffList.map(staff => (
              <tr key={staff.id} className="transition-colors hover:bg-[var(--bg-hover)]" style={{ borderBottom: '1px solid var(--border-medium)' }}>
                <td className="p-4 text-sm font-medium text-center" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-medium)' }}>{staff.name}</td>
                <td className="p-4 text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
                  {staff.password?.includes('NON_BILLABLE') ? (
                    <span className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider rounded-sm" style={{ backgroundColor: 'var(--color-error-bg)', color: 'var(--color-error)' }}>
                      Non-Billable
                    </span>
                  ) : (
                    <span className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider rounded-sm" style={{ backgroundColor: 'var(--color-success-bg)', color: 'var(--color-success)' }}>
                      Billable
                    </span>
                  )}
                </td>
                <td className="p-4 text-center">
                  <button
                    onClick={() => handleRemove(staff.id, staff.name)}
                    disabled={removeStaffMutation.isPending}
                    className="h-8 px-4 text-xs font-semibold focus:outline-none transition-colors disabled:opacity-50 rounded-md"
                    style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--color-error)', border: '1px solid var(--color-error)' }}
                    onMouseEnter={(e) => {
                      if (!removeStaffMutation.isPending) {
                        e.target.style.backgroundColor = 'var(--color-error-solid)';
                        e.target.style.color = 'var(--text-on-solid)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!removeStaffMutation.isPending) {
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
      {/* Owner Password Prompt Modal */}
      {showPromptModal && (
        <Modal
          as="form"
          onSubmit={confirmAddStaff}
          onClose={() => { if (!isVerifying) setShowPromptModal(false); }}
          title="Confirm Staff Addition"
          subtitle="Enter the owner password to confirm adding this staff member."
          titleId="confirm-staff-title"
          size="sm"
          zIndex={50}
          footer={(
            <>
              <Button variant="secondary" onClick={() => setShowPromptModal(false)} disabled={isVerifying}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={!promptPassword} loading={isVerifying} className="min-w-[96px]">Confirm</Button>
            </>
          )}
        >
          <Input
            id="owner-password-confirm"
            label="Owner Password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={promptPassword}
            onChange={(e) => setPromptPassword(e.target.value)}
            placeholder="Owner Password"
          />
        </Modal>
      )}
    </div>
  );
}