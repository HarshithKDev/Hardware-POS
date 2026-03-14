import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; 

export default function EntryFlow({ onLoginSuccess }) {
  const [step, setStep] = useState(1);
  const [role, setRole] = useState(null);         
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [workers, setWorkers] = useState([]);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    const fetchWorkers = async () => {
      const { data, error } = await supabase.from('workers').select('*');
      if (data && !error) setWorkers(data);
    };
    fetchWorkers();
  }, []);

  const handleRoleSelect = (selectedRole) => {
    setRole(selectedRole); 
    setStep(2);
  };

  const handleLogin = async (e) => {
    e.preventDefault(); 
    setError('');
    
    if (role === 'owner') {
      if (password === 'owner') {
        onLoginSuccess('owner');
      } else {
        setError('Incorrect Admin password.');
      }
    } else {
      const matchedWorker = workers.find(w => w.name === role);
      if (matchedWorker && password === matchedWorker.password) {
        onLoginSuccess(matchedWorker.name);
      } else {
        setError('Incorrect PIN. Please try again.');
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#0078D7] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white p-8 border border-gray-400 shadow-[2px_2px_0px_rgba(0,0,0,0.2)] rounded-none">
        {step === 1 && (
          <div>
            <h2 className="text-2xl font-light text-black mb-6">Select User</h2>
            <div className="space-y-3">
              <button onClick={() => handleRoleSelect('owner')} className="w-full py-3 bg-[#1e1e1e] hover:bg-[#333333] text-white border border-gray-600 text-lg transition-colors rounded-none text-left px-4">Admin (Owner)</button>
              {workers.map((worker) => (
                <button key={worker.id} onClick={() => handleRoleSelect(worker.name)} className="w-full py-3 bg-[#cccccc] hover:bg-[#b3b3b3] text-black border border-gray-400 text-lg transition-colors rounded-none text-left px-4 capitalize">{worker.name}</button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <button onClick={() => { setStep(1); setError(''); setPassword(''); }} className="text-sm text-[#0078D7] hover:underline mb-4 flex items-center">← Back</button>
            <h2 className="text-2xl font-light text-black mb-2">Enter Password</h2>
            <p className="text-gray-600 mb-6 text-sm capitalize">User: {role}</p>
            <form onSubmit={handleLogin} className="space-y-4">
              <div><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full px-3 py-2 border border-gray-400 focus:outline-none focus:border-[#0078D7] focus:ring-1 focus:ring-[#0078D7] text-lg rounded-none" autoFocus /></div>
              {error && <p className="text-[#e81123] text-sm">{error}</p>}
              <button type="submit" disabled={isAuthenticating} className="w-full py-3 bg-[#0078D7] hover:bg-[#005a9e] text-white text-lg font-medium transition-colors rounded-none border border-[#005a9e] disabled:opacity-50">{isAuthenticating ? 'Verifying...' : 'Login'}</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}