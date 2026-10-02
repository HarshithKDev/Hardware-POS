import { useState } from 'react';
import { supabase } from './supabaseClient';
import { Spinner, EyeIcon, EyeSlashIcon } from './SharedUI';

const getWorkerEmail = (name) =>
  `${name.trim().toLowerCase().replace(/[^a-z0-9]/g, '')}@hardwarepos.com`;

export default function EntryFlow({ onLoginSuccess, isSetupNeeded, onSetupComplete, shopSettings }) {
  const [step, setStep] = useState(1);
  const [role, setRole] = useState(null);
  const [operatorId, setOperatorId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const [shopName, setShopName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [isExistingLogin, setIsExistingLogin] = useState(false);
  const [shopAddress, setShopAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [upiId, setUpiId] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);

  const [showSetupPassword, setShowSetupPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState(localStorage.getItem('owner_email') || '');

  const handleLogoSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setError('Logo must be under 2MB.');
        return;
      }
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const handleOwnerLogin = async (e) => {
    e.preventDefault();
    const cleanEmail = ownerEmail.trim();
    const cleanPass = setupPassword.trim();
    if (!cleanEmail || !cleanPass) return setError('Email and password are required.');

    setIsSettingUp(true);
    setError('');

    try {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPass
      });
      if (signInError) throw signInError;

      const { data: shopData, error: dbError } = await supabase
        .from('shop_settings')
        .select('*')
        .ilike('admin_email', cleanEmail)
        .single();

      if (dbError) throw new Error('Could not find your shop details. Please contact support.');
      
      localStorage.setItem('owner_email', cleanEmail);
      localStorage.setItem('shop_id', shopData.id);
      setStep(1);
      onSetupComplete(shopData);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSettingUp(false);
    }
  };

  const handleSetup = async (e) => {
    e.preventDefault();
    const cleanShop = shopName.trim();
    const cleanOwner = ownerName.trim();
    const cleanEmail = ownerEmail.trim();
    const cleanPass = setupPassword.trim();

    if (!cleanShop || !cleanOwner || !cleanEmail || !cleanPass) return setError('Shop Name, Owner Name, Email, and Password are required.');
    if (!cleanEmail.includes('@')) return setError('Please enter a valid email address.');
    if (cleanPass.length < 6) return setError('Password must be at least 6 characters long.');
    if (cleanPass !== confirmPassword.trim()) return setError('Passwords do not match.');

    setIsSettingUp(true);
    setError('');

    try {
      let authDataResult;
      const { data: signUpData, error: authError } = await supabase.auth.signUp({ email: cleanEmail, password: cleanPass });

      if (authError) {
        if (authError.message.toLowerCase().includes('already registered')) {
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password: cleanPass
          });
          
          if (signInError) {
            throw new Error('This email is already registered. Please use your existing password, or contact support.');
          }
          authDataResult = signInData;
        } else {
          throw new Error(authError.message);
        }
      } else {
        authDataResult = signUpData;
      }

      // Upload logo if provided
      let logoUrl = null;
      if (logoFile) {
        const fileExt = logoFile.name.split('.').pop();
        const fileName = `${cleanEmail.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('shop-logos')
          .upload(fileName, logoFile, { cacheControl: '3600', upsert: true });
        
        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('shop-logos').getPublicUrl(fileName);
          logoUrl = urlData.publicUrl;
        }
      }

      const shopRecord = {
        shop_name: cleanShop,
        owner_name: cleanOwner,
        admin_email: cleanEmail,
        shop_address: shopAddress.trim() || null,
        phone: phone.trim() || null,
        upi_id: upiId.trim() || null,
        logo_url: logoUrl,
      };

      const { data, error: dbError } = await supabase
        .from('shop_settings')
        .insert([shopRecord])
        .select();

      if (dbError) throw dbError;
      if (data && data.length > 0) {
        localStorage.setItem('owner_email', cleanEmail);
        localStorage.setItem('shop_id', data[0].id);
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
      const targetEmail = role === 'owner' ? (ownerEmail.trim() || 'admin@hardwarepos.com') : getWorkerEmail(targetId);

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
      if (role === 'owner') {
        localStorage.setItem('owner_email', targetEmail);
      }
      onLoginSuccess(role === 'owner' ? 'owner' : targetId, rememberMe);
    } catch (_err) {
      setError('A system error occurred. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  if (isSetupNeeded) {
    const inputClass = "w-full h-11 px-3 rounded-lg focus:outline-none text-sm";
    const inputStyle = { border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' };
    const labelClass = "block text-xs font-bold uppercase tracking-wider mb-1";
    const labelStyle = { color: 'var(--text-secondary)' };

    if (isExistingLogin) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
          <div className="w-full max-w-sm p-6 md:p-8 rounded-xl border border-[var(--border-light)] shadow-2xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Owner Login</h2>
            <p className="mb-5 text-sm" style={{ color: 'var(--text-secondary)' }}>Log in to access your registered shop.</p>
            <form onSubmit={handleOwnerLogin} className="space-y-4">
              <div>
                <label className={labelClass} style={labelStyle}>Email</label>
                <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="you@example.com" className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>Password</label>
                <div className="relative">
                  <input type={showSetupPassword ? 'text' : 'password'} value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} placeholder="Password" className={`${inputClass} pr-10`} style={inputStyle} />
                  <button type="button" onClick={() => setShowSetupPassword(!showSetupPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center focus:outline-none" style={{ color: 'var(--text-tertiary)' }} tabIndex="-1">
                    {showSetupPassword ? <EyeSlashIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>
              {error && <p className="text-sm font-semibold" style={{ color: 'var(--color-error)' }}>{error}</p>}
              <button type="submit" disabled={isSettingUp} className="w-full h-12 text-sm font-bold uppercase tracking-wider disabled:opacity-50 flex justify-center items-center rounded-lg" style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-fg)' }}>
                {isSettingUp ? <Spinner className="w-5 h-5 text-white" /> : 'Log In'}
              </button>
              <div className="text-center pt-2">
                <button type="button" onClick={() => { setIsExistingLogin(false); setError(''); }} className="text-sm font-semibold hover:underline focus:outline-none" style={{ color: 'var(--color-accent)' }}>
                  Don't have a shop? Register instead
                </button>
              </div>
            </form>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
        <div className="w-full max-w-lg p-6 md:p-8 rounded-xl border border-[var(--border-light)] shadow-2xl max-h-[90vh] overflow-y-auto" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Register Your Shop</h2>
          <p className="mb-5 text-sm" style={{ color: 'var(--text-secondary)' }}>Set up your POS system in minutes.</p>
          <form onSubmit={handleSetup} className="space-y-4">
            
            {/* Logo Upload */}
            <div className="flex items-center gap-4">
              <label htmlFor="logo-upload" className="cursor-pointer flex-shrink-0">
                <div className="w-20 h-20 rounded-full border-2 border-dashed flex items-center justify-center overflow-hidden" style={{ borderColor: 'var(--border-medium)', backgroundColor: 'var(--bg-tertiary)' }}>
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl" style={{ color: 'var(--text-tertiary)' }}>+</span>
                  )}
                </div>
                <input id="logo-upload" type="file" accept="image/*" onChange={handleLogoSelect} className="hidden" />
              </label>
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Shop Logo</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Click to upload (Max 2MB)</p>
              </div>
            </div>

            {/* Required Fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} style={labelStyle}>Shop Name *</label>
                <input type="text" value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="Metro Hardware" className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>Owner Name *</label>
                <input type="text" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Your Name" className={inputClass} style={inputStyle} />
              </div>
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>Email *</label>
              <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="you@example.com" className={inputClass} style={inputStyle} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} style={labelStyle}>Password *</label>
                <div className="relative">
                  <input type={showSetupPassword ? 'text' : 'password'} value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} placeholder="Min 6 chars" className={`${inputClass} pr-10`} style={inputStyle} />
                  <button type="button" onClick={() => setShowSetupPassword(!showSetupPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center focus:outline-none" style={{ color: 'var(--text-tertiary)' }} tabIndex="-1">
                    {showSetupPassword ? <EyeSlashIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>Confirm Password *</label>
                <div className="relative">
                  <input type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter" className={`${inputClass} pr-10`} style={inputStyle} />
                  <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center focus:outline-none" style={{ color: 'var(--text-tertiary)' }} tabIndex="-1">
                    {showConfirmPassword ? <EyeSlashIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="pt-2 pb-1">
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>— Bill & Contact Details (Optional) —</p>
            </div>

            <div>
              <label className={labelClass} style={labelStyle}>Shop Address</label>
              <textarea value={shopAddress} onChange={(e) => setShopAddress(e.target.value)} placeholder="Full address (printed on bills)" rows="2" className="w-full px-3 py-2 rounded-lg focus:outline-none text-sm resize-none" style={inputStyle} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} style={labelStyle}>Phone Number</label>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label className={labelClass} style={labelStyle}>UPI ID</label>
                <input type="text" value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="shop@upi" className={inputClass} style={inputStyle} />
              </div>
            </div>

            {error && <p className="text-sm font-semibold" style={{ color: 'var(--color-error)' }}>{error}</p>}
            <button
              type="submit"
              disabled={isSettingUp}
              className="w-full h-12 text-sm font-bold uppercase tracking-wider disabled:opacity-50 flex justify-center items-center rounded-lg"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-fg)' }}
            >
              {isSettingUp ? <Spinner className="w-5 h-5 text-white" /> : 'Register My Shop'}
            </button>
            <div className="text-center pt-2">
              <button type="button" onClick={() => { setIsExistingLogin(true); setError(''); }} className="text-sm font-semibold hover:underline focus:outline-none" style={{ color: 'var(--color-accent)' }}>
                Already registered? Log in here
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="w-full max-w-md p-8 md:p-10 rounded-xl overflow-hidden border border-[var(--border-light)] shadow-2xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>

        <div className="text-center mb-8 pb-4" style={{ borderBottom: '1px solid var(--border-medium)' }}>
          <img src="/logo.png" alt="Shop Logo" className="mx-auto mb-4 object-cover h-24 w-24 rounded-full border border-[var(--border-light)] shadow-sm" />
          <h1 className="text-xl font-bold uppercase tracking-widest leading-snug w-[85%] max-w-[320px] mx-auto" style={{ color: 'var(--text-primary)' }}>
            {shopSettings?.shop_name}
          </h1>
          <p className="text-xs uppercase mt-2" style={{ color: 'var(--text-tertiary)' }}>Select User to Continue</p>
        </div>

        {step === 1 && (
          <div className="mb-2 min-h-[150px] flex flex-col justify-center">
            <div className="space-y-3">
              <button
                onClick={() => handleRoleSelect('worker')}
                className="w-full py-3 text-sm text-center font-medium rounded-md border border-[var(--border-light)] transition-colors hover:bg-[var(--bg-hover)]"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
              >
                Staff Login
              </button>
              <button
                onClick={() => handleRoleSelect('owner')}
                className="w-full py-3 text-sm text-center font-medium rounded-md transition-colors"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-fg)' }}
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
              className="text-sm hover:underline mb-4 flex items-center"
              style={{ color: 'var(--color-accent)' }}
            >
              ← Back
            </button>
            <h2 className="text-2xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Welcome Back</h2>
            <p className="mb-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {role === 'owner' ? 'Enter Owner Password' : 'Enter Staff Details'}
            </p>
            <form onSubmit={handleLogin} className="space-y-4">
              {role === 'worker' ? (
                <input
                  type="text"
                  value={operatorId}
                  onChange={(e) => setOperatorId(e.target.value)}
                  placeholder="Staff Name"
                  className="w-full h-12 px-3 focus:outline-none text-lg"
                  style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
                  autoFocus
                />
              ) : (
                <input
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="Owner Email"
                  className="w-full h-12 px-3 focus:outline-none text-lg"
                  style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
                  autoFocus
                />
              )}
              <div className="relative">
                <input
                  type={showLoginPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={role === 'owner' ? 'Owner Password' : 'Login PIN'}
                  className="w-full h-12 px-3 pr-10 focus:outline-none text-lg"
                  style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword(!showLoginPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center focus:outline-none"
                  style={{ color: 'var(--text-tertiary)' }}
                  tabIndex="-1"
                >
                  {showLoginPassword ? <EyeSlashIcon /> : <EyeIcon />}
                </button>
              </div>
              {role === 'owner' && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    id="rememberMe"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 focus:ring-[var(--color-accent)]"
                    style={{ accentColor: 'var(--color-accent)' }}
                  />
                  <label htmlFor="rememberMe" className="text-sm font-medium select-none cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                    Remember me
                  </label>
                </div>
              )}
              {error && <p className="text-sm font-semibold" style={{ color: 'var(--color-error)' }}>{error}</p>}
              <button
                type="submit"
                disabled={isAuthenticating}
                className="w-full h-11 mt-4 text-sm font-medium disabled:opacity-50 flex justify-center items-center rounded-md transition-all"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-fg)' }}
              >
                {isAuthenticating ? <Spinner className="w-5 h-5 text-white" /> : 'Login'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}