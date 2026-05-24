import { useState } from 'react';
import { supabase } from './supabaseClient';
import { Spinner, EyeIcon, EyeSlashIcon } from './SharedUI';

const ADMIN_EMAIL = 'admin@hardwarepos.com';
const getWorkerEmail = (name) =>
  `${name.trim().toLowerCase().replace(/[^a-z0-9]/g, '')}@hardwarepos.com`;

export default function EntryFlow({ onLoginSuccess, isSetupNeeded, onSetupComplete, shopSettings }) {
  const [step, setStep] = useState(1);
  const [role, setRole] = useState(null);
  const [operatorId, setOperatorId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const [shopName, setShopName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [isSettingUp, setIsSettingUp] = useState(false);

  const [showSetupPassword, setShowSetupPassword] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const handleSetup = async (e) => {
    e.preventDefault();
    const cleanShop = shopName.trim();
    const cleanOwner = ownerName.trim();
    const cleanPass = setupPassword.trim();

    if (!cleanShop || !cleanOwner || !cleanPass) return setError('All fields are required.');
    if (cleanPass.length < 6) return setError('Admin Password must be at least 6 characters long.');

    setIsSettingUp(true);
    setError('');

    try {
      const { error: authError } = await supabase.auth.signUp({ email: ADMIN_EMAIL, password: cleanPass });

      if (authError) {
        if (authError.message.toLowerCase().includes('already registered')) {
          throw new Error(
            'This master account already exists. If you previously deleted the shop_settings table, ' +
            'you must also go to Supabase Dashboard → Authentication → Users and delete the admin email to allow a fresh setup.'
          );
        }
        throw new Error(authError.message);
      }

      const { data, error: dbError } = await supabase
        .from('shop_settings')
        .insert([{ shop_name: cleanShop, owner_name: cleanOwner, owner_password: 'SECURED_IN_AUTH' }])
        .select();

      if (dbError) throw dbError;
      if (data && data.length > 0) {
        setStep(1);
        onSetupComplete(data[0]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSettingUp(false);
    }
  };

  const handleRoleSelect = (selectedRole) => {
    setRole(selectedRole);
    setStep(2);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsAuthenticating(true);

    const targetId = role === 'owner' ? 'owner' : operatorId.trim();

    if (role === 'worker' && !targetId) {
      setError('Please enter your Staff Username.');
      setIsAuthenticating(false);
      return;
    }

    try {
      const targetEmail = role === 'owner' ? ADMIN_EMAIL : getWorkerEmail(targetId);

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: targetEmail,
        password,
      });

      if (authError) {
        setError('Incorrect Password or Username. Access denied.');
        setIsAuthenticating(false);
        return;
      }

      // Server-side check: ensure the owner hasn't removed this staff member
      if (role === 'worker') {
        const { data: activeWorker, error: dbError } = await supabase
          .from('workers')
          .select('name')
          .ilike('name', targetId)
          .single();

        if (!activeWorker || dbError) {
          await supabase.auth.signOut();
          setError('Access Denied: Your account was removed by the owner.');
          setIsAuthenticating(false);
          return;
        }
      }

      // Pass only the role — supabase-js manages the session token internally
      onLoginSuccess(role === 'owner' ? 'owner' : targetId);
    } catch (_err) {
      setError('A system error occurred. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  if (isSetupNeeded) {
    return (
      <div className="min-h-screen bg-[#0078D7] flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-white p-8 border border-gray-400 shadow-[2px_2px_0px_rgba(0,0,0,0.2)] rounded-none">
          <h2 className="text-2xl font-light text-black mb-2">Register Your Shop</h2>
          <p className="text-gray-600 mb-6 text-sm">Create your master account to get started.</p>
          <form onSubmit={handleSetup} className="space-y-4">
            <input
              type="text"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              placeholder="Shop Name (e.g. Metro Hardware)"
              className="w-full h-12 px-3 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-lg rounded-none"
            />
            <input
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Owner Name"
              className="w-full h-12 px-3 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-lg rounded-none"
            />
            <div className="relative">
              <input
                type={showSetupPassword ? 'text' : 'password'}
                value={setupPassword}
                onChange={(e) => setSetupPassword(e.target.value)}
                placeholder="Set Admin Password (Min 6 chars)"
                className="w-full h-12 px-3 pr-10 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-lg rounded-none"
              />
              <button
                type="button"
                onClick={() => setShowSetupPassword(!showSetupPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-[#0078D7] focus:outline-none"
                tabIndex="-1"
              >
                {showSetupPassword ? <EyeSlashIcon /> : <EyeIcon />}
              </button>
            </div>
            {error && <p className="text-[#e81123] text-sm font-semibold">{error}</p>}
            <button
              type="submit"
              disabled={isSettingUp}
              className="w-full h-12 bg-[#0078D7] hover:bg-[#005a9e] text-white text-lg font-medium transition-colors rounded-none border border-transparent disabled:opacity-50 flex justify-center items-center"
            >
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
          <h1 className="text-xl font-bold uppercase tracking-widest text-black leading-snug w-[85%] max-w-[320px] mx-auto">
            {shopSettings?.shop_name}
          </h1>
          <p className="text-xs text-gray-500 uppercase mt-2">Select User to Continue</p>
        </div>

        {step === 1 && (
          <div className="mb-2 min-h-[150px] flex flex-col justify-center">
            <div className="space-y-4">
              <button
                onClick={() => handleRoleSelect('worker')}
                className="w-full py-4 bg-[#f3f3f3] hover:bg-[#e6e6e6] text-black border border-gray-400 text-lg transition-colors rounded-none text-center font-medium"
              >
                Staff Login
              </button>
              <button
                onClick={() => handleRoleSelect('owner')}
                className="w-full py-4 bg-[#1e1e1e] hover:bg-[#333333] text-white border border-gray-600 text-lg transition-colors rounded-none text-center font-medium"
              >
                Owner Login
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <button
              onClick={() => { setStep(1); setError(''); setPassword(''); setOperatorId(''); }}
              className="text-sm text-[#0078D7] hover:underline mb-4 flex items-center"
            >
              ← Back
            </button>
            <h2 className="text-2xl font-light text-black mb-2">Welcome Back</h2>
            <p className="text-gray-600 mb-6 text-sm">
              {role === 'owner' ? 'Enter Owner Password' : 'Enter Staff Details'}
            </p>
            <form onSubmit={handleLogin} className="space-y-4">
              {role === 'worker' && (
                <input
                  type="text"
                  value={operatorId}
                  onChange={(e) => setOperatorId(e.target.value)}
                  placeholder="Staff Username"
                  className="w-full h-12 px-3 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-lg rounded-none"
                  autoFocus
                />
              )}
              <div className="relative">
                <input
                  type={showLoginPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={role === 'owner' ? 'Owner Password' : 'Login PIN'}
                  className="w-full h-12 px-3 pr-10 border border-gray-400 focus:outline-none focus:border-[#0078D7] text-lg rounded-none"
                  autoFocus={role === 'owner'}
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword(!showLoginPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-[#0078D7] focus:outline-none"
                  tabIndex="-1"
                >
                  {showLoginPassword ? <EyeSlashIcon /> : <EyeIcon />}
                </button>
              </div>
              {error && <p className="text-[#e81123] text-sm font-semibold">{error}</p>}
              <button
                type="submit"
                disabled={isAuthenticating}
                className="w-full h-12 mt-2 bg-[#0078D7] hover:bg-[#005a9e] text-white text-lg font-medium transition-colors rounded-none border border-transparent disabled:opacity-50 flex justify-center items-center"
              >
                {isAuthenticating ? <Spinner className="w-6 h-6 text-white" /> : 'Login'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}