import { useState, useEffect } from 'react';
import { supabase, provisioningClient } from './supabaseClient';

export default function OwnerStaff({ showAlert, showConfirm }) {
  const [workers, setWorkers] = useState([]);
  const [newWorker, setNewWorker] = useState({ name: '', password: '' });
  const [isAddingWorker, setIsAddingWorker] = useState(false);

  const fetchWorkers = async () => {
    const { data } = await supabase.from('workers').select('*').order('name', { ascending: true });
    if (data) setWorkers(data);
  };

  useEffect(() => { fetchWorkers(); }, []);

  const getFriendlyErrorMessage = (errorMsg) => {
    const msg = errorMsg.toLowerCase();
    if (msg.includes('missing email') || msg.includes('invalid email')) return "The Operator ID provided is invalid. Please use only letters and numbers.";
    if (msg.includes('already registered')) return "An operator with this exact ID already exists in the secure backend system.";
    if (msg.includes('password should be at least')) return "For security purposes, the Auth PIN must be at least 6 characters long.";
    return errorMsg; 
  };

  const handleAddWorker = async (e) => {
    e.preventDefault();
    const cleanName = newWorker.name.trim();
    const cleanPin = newWorker.password.trim();

    if (!cleanName || !cleanPin) return showAlert("Please provide both an Operator ID and an Auth PIN.", "Validation Error");
    if (cleanPin.length < 6) return showAlert("For security purposes, the Auth PIN must be at least 6 characters long.", "Security Requirement");

    try {
      setIsAddingWorker(true);
      const emailSafeName = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!emailSafeName) return showAlert("Operator ID must contain letters or numbers.", "Validation Error");
      
      const workerEmail = `${emailSafeName}@hardwarepos.com`;
      const { error: authError } = await provisioningClient.auth.signUp({ email: workerEmail, password: cleanPin });
      if (authError) throw new Error(getFriendlyErrorMessage(authError.message));

      const { error: dbError } = await supabase.from('workers').insert([{ name: cleanName, password: 'SECURED_IN_AUTH' }]);
      if (dbError) throw new Error(getFriendlyErrorMessage(dbError.message));

      setNewWorker({ name: '', password: '' }); 
      fetchWorkers();
      showAlert(`Operator '${cleanName}' provisioned successfully.`, "Success");
    } catch (e) { showAlert(e.message, "Provisioning Failed"); } finally { setIsAddingWorker(false); }
  };

  const handleDeleteWorker = (id) => {
    showConfirm("Revoke access for this operator?", async () => {
      await supabase.from('workers').delete().eq('id', id); fetchWorkers(); 
    });
  };

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-light text-black mb-6">Security & Access Control</h1>
      <div className="bg-[#f9f9f9] border border-gray-400 p-6 max-w-3xl mb-8 rounded-none">
        <h2 className="text-sm font-semibold uppercase text-gray-600 mb-6 border-b border-gray-300 pb-2 tracking-wider">Provision Terminal Operator</h2>
        <form onSubmit={handleAddWorker} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="flex flex-col"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Operator ID</label><input type="text" value={newWorker.name} onChange={e=>setNewWorker({...newWorker,name:e.target.value})} className="border-2 border-gray-300 bg-white px-3 py-2 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></div>
          <div className="flex flex-col"><label className="text-xs font-semibold mb-1.5 uppercase text-gray-700">Auth PIN</label><input type="password" value={newWorker.password} onChange={e=>setNewWorker({...newWorker,password:e.target.value})} className="border-2 border-gray-300 bg-white px-3 py-2 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" /></div>
          <button type="submit" disabled={isAddingWorker} className="bg-[#0078D7] hover:bg-[#005a9e] text-white py-2 text-sm font-semibold rounded-none border border-transparent focus:outline-none focus:ring-1 focus:ring-black">{isAddingWorker ? 'Wait...' : 'Grant Access'}</button>
        </form>
      </div>
      
      <div className="border border-gray-400 bg-white max-w-3xl overflow-x-auto rounded-none">
        <table className="w-full text-left border-collapse">
          <thead className="bg-[#f3f3f3]">
            <tr className="text-xs font-semibold uppercase tracking-wider text-gray-600 border-b border-gray-400"><th className="p-3 border-r border-gray-300">Operator ID</th><th className="p-3 border-r border-gray-300 text-center w-32">Auth State</th><th className="p-3 text-center w-32">Sys Admin</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-200 border-b border-gray-400">
            {workers.length === 0 ? (<tr><td colSpan="3" className="p-6 text-center text-gray-500 text-sm font-semibold">No terminal operators provisioned.</td></tr>) : workers.map(w => (
              <tr key={w.id} className="hover:bg-[#f9f9f9]">
                <td className="p-3 border-r border-gray-200 text-sm text-black font-medium capitalize">{w.name}</td>
                <td className="p-3 border-r border-gray-200 text-sm text-center text-gray-500 tracking-widest">••••</td>
                <td className="p-2 text-center"><button onClick={()=>handleDeleteWorker(w.id)} className="bg-white border border-[#e81123] text-[#e81123] hover:bg-[#e81123] hover:text-white px-4 py-1 text-xs font-semibold rounded-none focus:outline-none">Revoke</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}