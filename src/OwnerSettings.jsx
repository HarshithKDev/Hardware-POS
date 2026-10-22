import React, { useState, useRef, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import { Save, Upload, Eye, EyeOff, Edit2, Trash2, Volume2, VolumeX, SlidersHorizontal, Boxes, Store } from 'lucide-react';
import { isAudioEnabled, setAudioEnabled, playScanSuccessSound } from './services/audio';

export default function OwnerSettings() {
  const { shopSettings, setShopSettings, showAlert, setWarehouseDisabled } = useApp();
  const fileInputRef = useRef(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    shop_name: '',
    owner_name: '',
    shop_address: '',
    phone: '',
    upi_id: '',
    admin_email: ''
  });
  
  const [logoPreview, setLogoPreview] = useState(null);
  const [logoFile, setLogoFile] = useState(null);
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [showAddress, setShowAddress] = useState(true);
  const [showUpi, setShowUpi] = useState(true);
  const [disableWarehouse, setDisableWarehouse] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => isAudioEnabled());

  useEffect(() => {
    if (shopSettings) {
      let addr = shopSettings.shop_address || '';
      let upi = shopSettings.upi_id || '';
      let sAddr = true;
      let sUpi = true;
      
      if (addr.startsWith('HIDDEN::')) {
        sAddr = false;
        addr = addr.substring(8);
      }
      if (upi.startsWith('HIDDEN::')) {
        sUpi = false;
        upi = upi.substring(8);
      }

      setFormData({
        shop_name: shopSettings.shop_name || '',
        owner_name: shopSettings.owner_name || '',
        shop_address: addr,
        phone: shopSettings.phone || '',
        upi_id: upi,
        admin_email: shopSettings.admin_email || ''
      });
      setShowAddress(sAddr);
      setShowUpi(sUpi);
      setDisableWarehouse(Boolean(
        shopSettings.disable_warehouse ??
        (localStorage.getItem(`disable_warehouse_${shopSettings.id}`) === 'true' ||
         localStorage.getItem('disable_warehouse') === 'true')
      ));
      if (shopSettings.sound_enabled !== undefined && shopSettings.sound_enabled !== null) {
        setSoundEnabled(Boolean(shopSettings.sound_enabled));
        setAudioEnabled(Boolean(shopSettings.sound_enabled));
      } else {
        setSoundEnabled(isAudioEnabled());
      }
      setLogoPreview(shopSettings.logo_url);
    }
  }, [shopSettings]);

  const handleToggleWarehouse = async (checked) => {
    setDisableWarehouse(checked);
    if (setWarehouseDisabled) {
      setWarehouseDisabled(checked);
    }
    if (shopSettings?.id) {
      localStorage.setItem(`disable_warehouse_${shopSettings.id}`, String(checked));
      localStorage.setItem('disable_warehouse', String(checked));
      try {
        const { error } = await supabase
          .from('shop_settings')
          .update({ disable_warehouse: checked })
          .eq('id', shopSettings.id);
        if (error && error.code !== '42703' && !error.message?.includes('disable_warehouse')) {
          console.error("Failed to update remote warehouse setting:", error);
        }
        const updated = { ...shopSettings, disable_warehouse: checked };
        try {
          localStorage.setItem('cached_shop_settings', JSON.stringify(updated));
        } catch (e) {}
        setShopSettings(updated);
        showAlert(
          checked 
            ? "Warehouse bypassed: Incoming stock deposits directly into Store stock." 
            : "Warehouse mode enabled: Main Storage and Move to Shop active.",
          "success"
        );
      } catch (err) {
        console.error("Error updating warehouse setting:", err);
      }
    }
  };

  const handleToggleSound = async (checked) => {
    setSoundEnabled(checked);
    setAudioEnabled(checked);
    if (checked) {
      playScanSuccessSound();
    }
    if (shopSettings?.id) {
      try {
        const { error } = await supabase
          .from('shop_settings')
          .update({ sound_enabled: checked })
          .eq('id', shopSettings.id);
        if (error && error.code !== '42703' && !error.message?.includes('sound_enabled')) {
          console.error("Failed to update remote sound setting:", error);
        }
        const updated = { ...shopSettings, sound_enabled: checked };
        try {
          localStorage.setItem('cached_shop_settings', JSON.stringify(updated));
        } catch (e) {}
        setShopSettings(updated);
        showAlert(checked ? "POS sound effects enabled (Scan & Checkout Audio)" : "POS sound effects muted", "success");
      } catch (err) {
        console.error("Error updating sound setting:", err);
      }
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleLogoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        showAlert('Logo must be under 2MB', 'error');
        return;
      }
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setPassword('');
    setConfirmPassword('');
    if (shopSettings) {
      let addr = shopSettings.shop_address || '';
      let upi = shopSettings.upi_id || '';
      let sAddr = true;
      let sUpi = true;
      
      if (addr.startsWith('HIDDEN::')) {
        sAddr = false;
        addr = addr.substring(8);
      }
      if (upi.startsWith('HIDDEN::')) {
        sUpi = false;
        upi = upi.substring(8);
      }

      setFormData({
        shop_name: shopSettings.shop_name || '',
        owner_name: shopSettings.owner_name || '',
        shop_address: addr,
        phone: shopSettings.phone || '',
        upi_id: upi,
        admin_email: shopSettings.admin_email || ''
      });
      setShowAddress(sAddr);
      setShowUpi(sUpi);
      setDisableWarehouse(Boolean(
        shopSettings.disable_warehouse ??
        (localStorage.getItem(`disable_warehouse_${shopSettings.id}`) === 'true' ||
         localStorage.getItem('disable_warehouse') === 'true')
      ));
      setSoundEnabled(isAudioEnabled());
      setLogoPreview(shopSettings.logo_url);
      setLogoFile(null);
    }
  };

  const handleSave = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!formData.shop_name.trim() || !formData.owner_name.trim()) {
      return showAlert('Shop Name and Owner Name are required.', 'error');
    }

    if (password) {
      if (password.length < 6) return showAlert('Password must be at least 6 characters.', 'error');
      if (password !== confirmPassword) return showAlert('Passwords do not match.', 'error');
    }

    setIsLoading(true);
    try {
      let updatedLogoUrl = logoPreview ? shopSettings.logo_url : null;

      // 1. Upload Logo if changed
      if (logoFile) {
        const fileExt = logoFile.name.split('.').pop();
        const baseKey = (shopSettings.id || shopSettings.admin_email || 'logo').replace(/[^a-z0-9]/gi, '_');
        const fileName = `${baseKey}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('shop-logos')
          .upload(fileName, logoFile, { cacheControl: '0', upsert: true });
        
        if (uploadError) throw new Error('Failed to upload logo: ' + uploadError.message);

        const { data: urlData } = supabase.storage.from('shop-logos').getPublicUrl(fileName);
        updatedLogoUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      }

      // 2. Update Auth Password if provided
      if (password) {
        const { error: authError } = await supabase.auth.updateUser({
          password: password
        });
        if (authError) throw new Error('Failed to update password: ' + authError.message);
      }

      // 3. Update Database Record
      const updates = {
        shop_name: formData.shop_name.trim(),
        owner_name: formData.owner_name.trim(),
        shop_address: formData.shop_address.trim() ? (!showAddress ? 'HIDDEN::' + formData.shop_address.trim() : formData.shop_address.trim()) : null,
        phone: formData.phone.trim() || null,
        upi_id: formData.upi_id.trim() ? (!showUpi ? 'HIDDEN::' + formData.upi_id.trim() : formData.upi_id.trim()) : null,
        logo_url: updatedLogoUrl,
        disable_warehouse: disableWarehouse,
        sound_enabled: soundEnabled
      };

      let savedRecord = null;
      const { data, error } = await supabase
        .from('shop_settings')
        .update(updates)
        .eq('id', shopSettings.id)
        .select()
        .single();

      if (error && (error.code === '42703' || error.message?.includes('disable_warehouse') || error.message?.includes('sound_enabled'))) {
        delete updates.disable_warehouse;
        delete updates.sound_enabled;
        const retry = await supabase
          .from('shop_settings')
          .update(updates)
          .eq('id', shopSettings.id)
          .select()
          .single();
        if (retry.error) throw retry.error;
        savedRecord = { ...retry.data, disable_warehouse: disableWarehouse, sound_enabled: soundEnabled };
      } else if (error) {
        throw error;
      } else {
        savedRecord = { ...data, disable_warehouse: disableWarehouse, sound_enabled: soundEnabled };
      }

      setAudioEnabled(soundEnabled);
      localStorage.setItem(`disable_warehouse_${shopSettings.id}`, String(disableWarehouse));
      localStorage.setItem('disable_warehouse', String(disableWarehouse));
      try {
        localStorage.setItem('cached_shop_settings', JSON.stringify(savedRecord));
      } catch (e) {
        console.error('Failed to update cached_shop_settings:', e);
      }
      setShopSettings(savedRecord);
      localStorage.setItem('owner_name', savedRecord.owner_name);
      setPassword('');
      setConfirmPassword('');
      setIsEditing(false);
      showAlert('Profile & settings updated successfully!', 'success');

    } catch (error) {
      showAlert(error.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col overflow-hidden animate-fade-in" style={{ backgroundColor: 'transparent' }}>
      <div className="w-full max-w-7xl mx-auto flex flex-col h-full gap-3 p-1">

        {/* TOP BAR / PAGE HEADER */}
        <div className="flex items-center justify-between pb-2.5 border-b border-[var(--border-light)] shrink-0">
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Shop Settings
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing ? (
              <button 
                type="button" 
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all border shadow-sm hover:bg-[var(--bg-hover)] active:scale-95 cursor-pointer"
                style={{ borderColor: 'var(--border-medium)', color: 'var(--text-primary)', backgroundColor: 'var(--bg-secondary)' }}
              >
                <Edit2 size={14} /> Edit Profile
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button  
                  type="button" 
                  onClick={handleCancel}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all border hover:bg-[var(--bg-tertiary)] cursor-pointer"
                  style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
                >
                  Cancel
                </button>
                <button 
                  type="button"
                  onClick={handleSave} 
                  disabled={isLoading}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-white text-xs font-bold uppercase tracking-wider shadow-sm transition-all hover:brightness-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                >
                  {isLoading ? (
                    <>Saving...</>
                  ) : (
                    <><Save size={14} /> Save Changes</>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 2-COLUMN HORIZONTAL GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          
          {/* ======================================================== */}
          {/* LEFT COLUMN: System Controls & "On and Off" Switches     */}
          {/* ======================================================== */}
          <div className="lg:col-span-5 flex flex-col gap-4">

            {/* SYSTEM TOGGLES PANEL */}
            <div 
              className="p-4 rounded-xl border shadow-sm flex flex-col gap-3"
              style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-light)' }}
            >
              <div className="flex items-center gap-2 pb-2.5 border-b border-[var(--border-light)]">
                <div className="p-1.5 rounded-lg bg-[var(--bg-tertiary)] text-[var(--color-accent)] border border-[var(--border-medium)]">
                  <SlidersHorizontal size={15} />
                </div>
                <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                  System Preferences
                </h2>
              </div>

              {/* TOGGLE 1: WAREHOUSE BYPASS */}
              <div 
                className={`p-3.5 rounded-lg border flex items-center justify-between gap-3 transition-all ${
                  disableWarehouse 
                    ? 'border-amber-500/40 bg-amber-500/5' 
                    : 'border-[var(--border-light)] bg-[var(--bg-tertiary)]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`p-2 rounded-lg shrink-0 ${disableWarehouse ? 'bg-amber-500/10 text-amber-500' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'} border border-[var(--border-light)]`}>
                    <Boxes size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                        Disable Warehouse
                      </span>
                      <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded border ${
                        disableWarehouse 
                          ? 'bg-amber-500/15 text-amber-500 border-amber-500/30' 
                          : 'bg-[var(--bg-secondary)] text-[var(--text-tertiary)] border-[var(--border-medium)]'
                      }`}>
                        {disableWarehouse ? 'Bypass Active' : 'Off'}
                      </span>
                    </div>
                    <span className="text-[11px] text-[var(--text-tertiary)] block truncate mt-0.5">
                      Direct to Store Inventory
                    </span>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input 
                    type="checkbox" 
                    checked={disableWarehouse} 
                    onChange={(e) => handleToggleWarehouse(e.target.checked)} 
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-[var(--border-medium)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500 cursor-pointer" />
                </label>
              </div>

              {/* TOGGLE 2: POS AUDIO FEEDBACK */}
              <div 
                className={`p-3.5 rounded-lg border flex items-center justify-between gap-3 transition-all ${
                  soundEnabled 
                    ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5' 
                    : 'border-[var(--border-light)] bg-[var(--bg-tertiary)]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`p-2 rounded-lg shrink-0 ${soundEnabled ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'} border border-[var(--border-light)]`}>
                    {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                        POS Sound Effects
                      </span>
                      <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded border ${
                        soundEnabled 
                          ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border-[var(--color-accent)]/30' 
                          : 'bg-[var(--bg-secondary)] text-[var(--text-tertiary)] border-[var(--border-medium)]'
                      }`}>
                        {soundEnabled ? 'Audio On' : 'Muted'}
                      </span>
                    </div>
                    <span className="text-[11px] text-[var(--text-tertiary)] block truncate mt-0.5">
                      Scan & Checkout Audio Tones
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {soundEnabled && (
                    <button
                      type="button"
                      onClick={() => playScanSuccessSound()}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded border border-[var(--border-medium)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] text-[var(--color-accent)] transition-all active:scale-95 cursor-pointer"
                      title="Test scan sound"
                    >
                      <Volume2 size={12} />
                      <span>Test</span>
                    </button>
                  )}
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input 
                      type="checkbox" 
                      checked={soundEnabled} 
                      onChange={(e) => handleToggleSound(e.target.checked)} 
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-[var(--border-medium)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--color-accent)] cursor-pointer" />
                  </label>
                </div>
              </div>
            </div>

            {/* BRANDING & LOGO CARD */}
            <div 
              className="p-4 rounded-xl border shadow-sm flex flex-col gap-3"
              style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-light)' }}
            >
              <div className="flex items-center gap-2 pb-2.5 border-b border-[var(--border-light)]">
                <div className="p-1.5 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-medium)]">
                  <Store size={15} />
                </div>
                <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                  Store Identity
                </h2>
              </div>

              <div className="flex items-center gap-3.5">
                <div 
                  className={`w-14 h-14 rounded-xl flex items-center justify-center border-2 overflow-hidden relative group transition-all shrink-0 ${
                    isEditing ? 'border-dashed cursor-pointer hover:border-[var(--color-accent)]' : 'border-solid'
                  }`}
                  style={{ borderColor: 'var(--border-medium)', backgroundColor: 'var(--bg-tertiary)' }}
                  onClick={() => isEditing && fileInputRef.current?.click()}
                >
                  {logoPreview ? (
                    <>
                      <img src={logoPreview} alt="Shop Logo" className="w-full h-full object-cover" />
                      {isEditing && (
                        <div className="absolute inset-0 bg-black/50 hidden group-hover:flex items-center justify-center transition-all">
                          <Upload className="w-5 h-5 text-white" />
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col items-center opacity-60">
                      <Upload className="w-5 h-5 mb-0.5" />
                      <span className="text-[9px] uppercase font-bold">Logo</span>
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                    {formData.shop_name || 'Your Shop'}
                  </h3>
                  <p className="text-xs truncate text-[var(--text-secondary)] mt-0.5">
                    Owner: {formData.owner_name || 'Administrator'}
                  </p>
                  
                  {isEditing ? (
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs text-[var(--color-accent)] hover:underline font-semibold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Upload size={12} />
                        <span>Upload Logo</span>
                      </button>
                      {logoPreview && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLogoFile(null);
                            setLogoPreview(null);
                          }}
                          className="text-xs text-red-500 hover:text-red-400 font-semibold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 size={12} />
                          <span>Remove</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-[var(--text-secondary)] truncate max-w-full font-normal">
                      {formData.admin_email}
                    </p>
                  )}

                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="image/*" 
                    onChange={handleLogoChange}
                  />
                </div>
              </div>
            </div>

          </div>

          {/* ======================================================== */}
          {/* RIGHT COLUMN: Profile Editing & Shop Information         */}
          {/* ======================================================== */}
          <div className="lg:col-span-7 flex flex-col">
            <form onSubmit={handleSave} className="p-4 md:p-5 rounded-xl border shadow-sm flex flex-col gap-3.5" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-light)' }}>
              
              <div className="flex items-center justify-between pb-2.5 border-b border-[var(--border-light)] shrink-0">
                <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                  Shop Profile & Billing Details
                </h2>
                <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded border ${
                  isEditing 
                    ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] border-[var(--color-accent)]/20 animate-pulse' 
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] border-[var(--border-medium)]'
                }`}>
                  {isEditing ? 'Editing Mode' : 'View Mode'}
                </span>
              </div>

              {/* FORM FIELDS */}
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Shop Name <span className="text-red-500">*</span>
                    </label>
                    <input 
                      type="text" 
                      name="shop_name"
                      value={formData.shop_name}
                      onChange={handleInputChange}
                      disabled={!isEditing}
                      placeholder="e.g. Acme Hardware & Tools"
                      className={`w-full py-2 px-3 rounded-lg border outline-none text-sm transition-colors ${isEditing ? 'focus:ring-2 focus:ring-opacity-20' : 'opacity-70 cursor-default'}`}
                      style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-light)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--color-accent)' }}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Owner / Admin Name <span className="text-red-500">*</span>
                    </label>
                    <input 
                      type="text" 
                      name="owner_name"
                      value={formData.owner_name}
                      onChange={handleInputChange}
                      disabled={!isEditing}
                      placeholder="e.g. John Doe"
                      className={`w-full py-2 px-3 rounded-lg border outline-none text-sm transition-colors ${isEditing ? 'focus:ring-2 focus:ring-opacity-20' : 'opacity-70 cursor-default'}`}
                      style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-light)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--color-accent)' }}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Registered Admin Email (Login ID)
                  </label>
                  <input 
                    type="email" 
                    value={formData.admin_email}
                    disabled
                    className="w-full py-2 px-3 rounded-lg border outline-none text-sm transition-colors opacity-60 cursor-not-allowed font-sans"
                    style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-light)', color: 'var(--text-primary)' }}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Phone Number
                    </label>
                    <input 
                      type="text" 
                      name="phone"
                      value={formData.phone}
                      onChange={handleInputChange}
                      disabled={!isEditing}
                      placeholder="e.g. +91 9876543210"
                      className={`w-full py-2 px-3 rounded-lg border outline-none text-sm transition-colors ${isEditing ? 'focus:ring-2 focus:ring-opacity-20' : 'opacity-70 cursor-default'}`}
                      style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-light)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--color-accent)' }}
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                        UPI ID (Digital Payment)
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Show on Bill</span>
                        <input 
                          type="checkbox" 
                          checked={showUpi} 
                          onChange={(e) => setShowUpi(e.target.checked)} 
                          disabled={!isEditing} 
                          className="accent-[var(--color-accent)] w-3.5 h-3.5 cursor-pointer" 
                        />
                      </label>
                    </div>
                    <input 
                      type="text" 
                      name="upi_id"
                      value={formData.upi_id}
                      onChange={handleInputChange}
                      disabled={!isEditing}
                      placeholder="e.g. storename@upi"
                      className={`w-full py-2 px-3 rounded-lg border outline-none text-sm transition-colors ${isEditing ? 'focus:ring-2 focus:ring-opacity-20' : 'opacity-70 cursor-default'}`}
                      style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-light)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--color-accent)' }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                      Shop Address
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Show on Bill</span>
                      <input 
                        type="checkbox" 
                        checked={showAddress} 
                        onChange={(e) => setShowAddress(e.target.checked)} 
                        disabled={!isEditing} 
                        className="accent-[var(--color-accent)] w-3.5 h-3.5 cursor-pointer" 
                      />
                    </label>
                  </div>
                  <textarea 
                    name="shop_address"
                    value={formData.shop_address}
                    onChange={handleInputChange}
                    disabled={!isEditing}
                    rows={2}
                    placeholder="Enter street address, city, state, postal code"
                    className={`w-full py-2 px-3 rounded-lg border outline-none text-sm transition-colors ${isEditing ? 'focus:ring-2 focus:ring-opacity-20 resize-none' : 'opacity-70 cursor-default resize-none'}`}
                    style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-light)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--color-accent)' }}
                  />
                </div>

                {/* PASSWORD SECTION (EDITING ONLY) */}
                {isEditing && (
                  <div className="pt-2 border-t border-[var(--border-light)]">
                    <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5 text-[var(--text-tertiary)]">
                      Change Password (Optional)
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="relative">
                        <input 
                          type={showPassword ? "text" : "password"} 
                          placeholder="New password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full py-2 px-3 pr-8 rounded-lg border outline-none focus:ring-2 focus:ring-opacity-20 text-sm transition-colors"
                          style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-light)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--color-accent)' }}
                        />
                        <button 
                          type="button" 
                          onClick={() => setShowPassword(!showPassword)} 
                          className="absolute right-2.5 top-2.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                        >
                          {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>

                      <div className="relative">
                        <input 
                          type={showConfirmPassword ? "text" : "password"} 
                          placeholder="Confirm password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full py-2 px-3 pr-8 rounded-lg border outline-none focus:ring-2 focus:ring-opacity-20 text-sm transition-colors"
                          style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-light)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--color-accent)' }}
                        />
                        <button 
                          type="button" 
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)} 
                          className="absolute right-2.5 top-2.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                        >
                          {showConfirmPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

            </form>
          </div>

        </div>
      </div>
    </div>
  );
}
