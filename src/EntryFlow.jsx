import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; 
import { Spinner } from './App'; 

const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const EyeSlashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
  </svg>
);

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
  
  const [isLoadingWorkers, setIsLoadingWorkers] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const [shopName, setShopName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [isSettingUp, setIsSettingUp] = useState(false);

  const [showSetupPassword, setShowSetupPassword] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  useEffect(() => {
    if (!isSetupNeeded) {
      const fetchWorkers = async () => {
        setIsLoadingWorkers(true); 
        const { data, error } = await supabase.from('workers').select('*');
        if (data && !error) setWorkers(data);
        setIsLoadingWorkers(false); 
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
      const hashedPassword = await hashPassword(setupPassword); 
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
      const hashedInput = await hashPassword(password); 
      
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
            <div className="relative">
              <input type={showSetupPassword ? "text" : "password"} value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} placeholder="Set Admin Password" className="w-full px-3 py-2 pr-10 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-lg rounded-none" />
              <button type="button" onClick={() => setShowSetupPassword(!showSetupPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-[#0078D7] focus:outline-none" tabIndex="-1">
                {showSetupPassword ? <EyeSlashIcon /> : <EyeIcon />}
              </button>
            </div>
            {error && <p className="text-[#e81123] text-sm">{error}</p>}
            <button type="submit" disabled={isSettingUp} className="w-full py-3 bg-[#0078D7] hover:bg-[#005a9e] text-white text-lg font-medium transition-colors rounded-none border border-[#005a9e] disabled:opacity-50 flex justify-center items-center h-14">
              {isSettingUp ? <Spinner className="w-6 h-6 text-white" /> : 'Register'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0078D7] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white p-8 border border-gray-400 shadow-[2px_2px_0px_rgba(0,0,0,0.2)] rounded-none overflow-hidden">
        
        <div className="text-center mb-8 border-b border-gray-400 pb-4">
          {/* FIX: Widened the container so the words wrap naturally without cutting off "AND" early */}
          <h1 className="text-xl font-bold uppercase tracking-widest text-black leading-snug w-[85%] max-w-[320px] mx-auto">
            {shopSettings?.shop_name}
          </h1>
          <p className="text-xs text-gray-500 uppercase mt-2">Select User to Continue</p>
        </div>
        
        {step === 1 && (
          <div className="mb-2 min-h-[150px] flex flex-col justify-center">
            {isLoadingWorkers ? (
              <div className="flex justify-center py-4">
                <Spinner className="w-8 h-8 text-[#0078D7]" />
              </div>
            ) : (
              <div className="space-y-3">
                <button onClick={() => handleRoleSelect('owner')} className="w-full py-3 bg-[#1e1e1e] hover:bg-[#333333] text-white border border-gray-600 text-lg transition-colors rounded-none text-left px-4">Admin (Owner)</button>
                {workers.map((worker) => (
                  <button key={worker.id} onClick={() => handleRoleSelect(worker.name)} className="w-full py-3 bg-[#cccccc] hover:bg-[#b3b3b3] text-black border border-gray-400 text-lg transition-colors rounded-none text-left px-4 capitalize">{worker.name}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <button onClick={() => { setStep(1); setError(''); setPassword(''); }} className="text-sm text-[#0078D7] hover:underline mb-4 flex items-center">Back</button>
            <h2 className="text-2xl font-light text-black mb-2">Enter Password</h2>
            <p className="text-gray-600 mb-6 text-sm capitalize">User: {role}</p>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="relative">
                <input type={showLoginPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full px-3 py-2 pr-10 border border-gray-400 focus:outline-none focus:border-[#0078D7] focus:ring-1 focus:ring-[#0078D7] text-lg rounded-none" autoFocus />
                <button type="button" onClick={() => setShowLoginPassword(!showLoginPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-[#0078D7] focus:outline-none" tabIndex="-1">
                  {showLoginPassword ? <EyeSlashIcon /> : <EyeIcon />}
                </button>
              </div>
              {error && <p className="text-[#e81123] text-sm">{error}</p>}
              <button type="submit" disabled={isAuthenticating} className="w-full py-3 bg-[#0078D7] hover:bg-[#005a9e] text-white text-lg font-medium transition-colors rounded-none border border-[#005a9e] disabled:opacity-50 flex justify-center items-center h-14">
                {isAuthenticating ? <Spinner className="w-6 h-6 text-white" /> : 'Login'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}