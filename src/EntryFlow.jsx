import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; 

// SECURE PASSWORD HASHER (SHA-256)
export const hashPassword = async (message) => {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

export default function EntryFlow({ onLoginSuccess, isSetupNeeded, onSetupComplete, shopSettings }) {
  const [step, setStep] = useState(1);
  const [role, setRole] = useState(null);         
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [workers, setWorkers] = useState([]);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const [shopName, setShopName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [isSettingUp, setIsSettingUp] = useState(false);

  useEffect(() => {
    if (!isSetupNeeded) {
      const fetchWorkers = async () => {
        const { data, error } = await supabase.from('workers').select('*');
        if (data && !error) setWorkers(data);
      };
      fetchWorkers();
    }
  }, [isSetupNeeded]);

  const handleSetup = async (e) => {
    e.preventDefault();
    if (!shopName || !ownerName || !setupPassword) return setError('All fields are required.');
    setIsSettingUp(true);
    setError('');
    
    try {
      const hashedPassword = await hashPassword(setupPassword); // HASH BEFORE SAVE
      const { data, error } = await supabase.from('shop_settings').insert([{
        shop_name: shopName,
        owner_name: ownerName,
        owner_password: hashedPassword
      }]).select();
      
      if (error) throw error;
      if (data && data.length > 0) {
        setStep(1);
        onSetupComplete(data[0]);
      }
    } catch (err) { setError(err.message); } 
    finally { setIsSettingUp(false); }
  };

  const handleRoleSelect = (selectedRole) => {
    setRole(selectedRole); 
    setStep(2);
  };

  const handleLogin = async (e) => {
    e.preventDefault(); 
    setError('');
    setIsAuthenticating(true);
    
    try {
      const hashedInput = await hashPassword(password); // HASH INPUT TO COMPARE
      
      if (role === 'owner') {
        if (hashedInput === shopSettings?.owner_password) {
          onLoginSuccess('owner');
        } else {
          setError('Incorrect Admin password.');
        }
      } else {
        const matchedWorker = workers.find(w => w.name === role);
        if (matchedWorker && hashedInput === matchedWorker.password) {
          onLoginSuccess(matchedWorker.name);
        } else {
          setError('Incorrect PIN. Please try again.');
        }
      }
    } finally { setIsAuthenticating(false); }
  };

  if (isSetupNeeded) {
    return (
      <div className="min-h-screen bg-[#0078D7] flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-white p-8 border border-gray-400 shadow-[2px_2px_0px_rgba(0,0,0,0.2)] rounded-none">
          <h2 className="text-2xl font-light text-black mb-2">Register Your Shop</h2>
          <p className="text-gray-600 mb-6 text-sm">Create your master account to get started.</p>
          <form onSubmit={handleSetup} className="space-y-4">
            <div><input type="text" value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="Shop Name (e.g. Metro Hardware)" className="w-full px-3 py-2 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-lg rounded-none" /></div>
            <div><input type="text" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Owner Name" className="w-full px-3 py-2 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-lg rounded-none" /></div>
            <div><input type="password" value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} placeholder="Set Admin Password" className="w-full px-3 py-2 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-lg rounded-none" /></div>
            {error && <p className="text-[#e81123] text-sm">{error}</p>}
            <button type="submit" disabled={isSettingUp} className="w-full py-3 bg-[#0078D7] hover:bg-[#005a9e] text-white text-lg font-medium transition-colors rounded-none border border-[#005a9e] disabled:opacity-50">{isSettingUp ? 'Registering...' : 'Register'}</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0078D7] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white p-8 border border-gray-400 shadow-[2px_2px_0px_rgba(0,0,0,0.2)] rounded-none overflow-hidden">
        <div className="text-center mb-8 border-b border-gray-400 pb-4">
          <h1 className="text-xl font-bold uppercase tracking-widest text-black leading-snug max-w-65 mx-auto">{shopSettings?.shop_name}</h1>
          <p className="text-xs text-gray-500 uppercase mt-2">Select User to Continue</p>
        </div>
        {step === 1 && (
          <div className="space-y-3 mb-2">
            <button onClick={() => handleRoleSelect('owner')} className="w-full py-3 bg-[#1e1e1e] hover:bg-[#333333] text-white border border-gray-600 text-lg transition-colors rounded-none text-left px-4">Admin (Owner)</button>
            {workers.map((worker) => (
              <button key={worker.id} onClick={() => handleRoleSelect(worker.name)} className="w-full py-3 bg-[#cccccc] hover:bg-[#b3b3b3] text-black border border-gray-400 text-lg transition-colors rounded-none text-left px-4 capitalize">{worker.name}</button>
            ))}
          </div>
        )}
        {step === 2 && (
          <div>
            <button onClick={() => { setStep(1); setError(''); setPassword(''); }} className="text-sm text-[#0078D7] hover:underline mb-4 flex items-center">Back</button>
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