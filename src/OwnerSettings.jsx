import React, { useState, useRef, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import { Save, Upload, Eye, EyeOff, Edit2 } from 'lucide-react';

export default function OwnerSettings() {
  const { shopSettings, setShopSettings, showAlert } = useApp();
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

  useEffect(() => {
    if (shopSettings) {
      setFormData({
        shop_name: shopSettings.shop_name || '',
        owner_name: shopSettings.owner_name || '',
        shop_address: shopSettings.shop_address || '',
        phone: shopSettings.phone || '',
        upi_id: shopSettings.upi_id || '',
        admin_email: shopSettings.admin_email || ''
      });
      setLogoPreview(shopSettings.logo_url);
    }
  }, [shopSettings]);

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

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.shop_name.trim() || !formData.owner_name.trim()) {
      return showAlert('Shop Name and Owner Name are required.', 'error');
    }

    if (password) {
      if (password.length < 6) return showAlert('Password must be at least 6 characters.', 'error');
      if (password !== confirmPassword) return showAlert('Passwords do not match.', 'error');
    }

    setIsLoading(true);
    try {
      let updatedLogoUrl = shopSettings.logo_url;

      // 1. Upload Logo if changed
      if (logoFile) {
        const fileExt = logoFile.name.split('.').pop();
        const fileName = `${shopSettings.admin_email.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('shop-logos')
          .upload(fileName, logoFile, { cacheControl: '3600', upsert: true });
        
        if (uploadError) throw new Error('Failed to upload logo: ' + uploadError.message);

        const { data: urlData } = supabase.storage.from('shop-logos').getPublicUrl(fileName);
        updatedLogoUrl = urlData.publicUrl;
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
        shop_address: formData.shop_address.trim() || null,
        phone: formData.phone.trim() || null,
        upi_id: formData.upi_id.trim() || null,
        logo_url: updatedLogoUrl
      };

      const { data, error } = await supabase
        .from('shop_settings')
        .update(updates)
        .eq('id', shopSettings.id)
        .select()
        .single();

      if (error) throw error;

      setShopSettings(data);
      setPassword('');
      setConfirmPassword('');
      setIsEditing(false);
      showAlert('Profile updated successfully!', 'success');

    } catch (error) {
      showAlert(error.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full animate-fade-in overflow-y-auto hide-x-scrollbar p-2 md:p-6" style={{ backgroundColor: 'transparent' }}>
      <div className="w-full max-w-3xl mx-auto md:p-6 p-4 md:rounded-2xl md:border md:shadow-sm" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-light)' }}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Shop Settings</h2>
          {!isEditing && (
            <button 
              type="button" 
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors border hover:bg-[var(--bg-hover)]"
              style={{ borderColor: 'var(--border-medium)', color: 'var(--text-primary)', backgroundColor: 'var(--bg-tertiary)' }}
            >
              <Edit2 size={16} /> Edit Profile
            </button>
          )}
        </div>
        
        <form onSubmit={handleSave} className="space-y-4">
          
          {/* LOGO SECTION */}
          <div className="flex items-center gap-6 pb-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
            <div 
              className={`w-20 h-20 rounded-xl flex items-center justify-center border-2 overflow-hidden relative group transition-colors ${isEditing ? 'border-dashed cursor-pointer' : 'border-solid'}`}
              style={{ borderColor: 'var(--border-medium)', backgroundColor: 'var(--bg-tertiary)' }}
              onClick={() => isEditing && fileInputRef.current?.click()}
            >
              {logoPreview ? (
                <>
                  <img src={logoPreview} alt="Shop Logo" className="w-full h-full object-cover" />
                  {isEditing && (
                    <div className="absolute inset-0 bg-black/50 hidden group-hover:flex items-center justify-center transition-all">
                      <Upload className="w-6 h-6 text-white" />
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center opacity-60">
                  <Upload className="w-6 h-6 mb-1" />
                  <span className="text-[10px] uppercase font-bold">Logo</span>
                </div>
              )}
            </div>
            <div>
              <h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Shop Logo</h3>
              {isEditing && (
                <p className="text-xs mt-1 max-w-xs" style={{ color: 'var(--text-secondary)' }}>Click the image to upload a new logo (Max 2MB). Re-login for favicon changes to take effect.</p>
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h3 className="font-bold text-xs uppercase tracking-wider mb-2 pb-2 border-b" style={{ color: 'var(--text-tertiary)', borderColor: 'var(--border-light)' }}>Basic Details</h3>
              
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>Email</label>
                <input 
                  type="email" 
                  value={formData.admin_email}
                  disabled
                  className="w-full p-2.5 rounded-lg border outline-none text-sm transition-colors opacity-50 cursor-not-allowed"
                  style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>Shop Name</label>
                <input 
                  type="text" 
                  name="shop_name"
                  value={formData.shop_name}
                  onChange={handleInputChange}
                  disabled={!isEditing}
                  className={`w-full p-2.5 rounded-lg border outline-none text-sm transition-colors ${isEditing ? 'focus:ring-2 focus:ring-opacity-20' : 'opacity-70 cursor-default'}`}
                  style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-light)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--color-accent)' }}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>Owner Name</label>
                <input 
                  type="text" 
                  name="owner_name"
                  value={formData.owner_name}
                  onChange={handleInputChange}
                  disabled={!isEditing}
                  className={`w-full p-2.5 rounded-lg border outline-none text-sm transition-colors ${isEditing ? 'focus:ring-2 focus:ring-opacity-20' : 'opacity-70 cursor-default'}`}
                  style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-light)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--color-accent)' }}
                  required
                />
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-bold text-xs uppercase tracking-wider mb-2 pb-2 border-b" style={{ color: 'var(--text-tertiary)', borderColor: 'var(--border-light)' }}>Contact & Billing</h3>
              
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>Phone Number</label>
                <input 
                  type="text" 
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  disabled={!isEditing}
                  className={`w-full p-2.5 rounded-lg border outline-none text-sm transition-colors ${isEditing ? 'focus:ring-2 focus:ring-opacity-20' : 'opacity-70 cursor-default'}`}
                  style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-light)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--color-accent)' }}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>UPI ID</label>
                <input 
                  type="text" 
                  name="upi_id"
                  value={formData.upi_id}
                  onChange={handleInputChange}
                  disabled={!isEditing}
                  className={`w-full p-2.5 rounded-lg border outline-none text-sm transition-colors ${isEditing ? 'focus:ring-2 focus:ring-opacity-20' : 'opacity-70 cursor-default'}`}
                  style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-light)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--color-accent)' }}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>Shop Address</label>
                <textarea 
                  name="shop_address"
                  value={formData.shop_address}
                  onChange={handleInputChange}
                  disabled={!isEditing}
                  rows={3}
                  className={`w-full p-2.5 rounded-lg border outline-none text-sm transition-colors ${isEditing ? 'focus:ring-2 focus:ring-opacity-20 resize-y' : 'opacity-70 cursor-default resize-none'}`}
                  style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-light)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--color-accent)' }}
                />
              </div>
            </div>
          </div>

          {isEditing && (
            <>
              <div className="pt-2 space-y-3">
                <h3 className="font-bold text-xs uppercase tracking-wider mb-2 pb-2 border-b" style={{ color: 'var(--text-tertiary)', borderColor: 'var(--border-light)' }}>Change Password (Optional)</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="relative">
                    <input 
                      type={showPassword ? "text" : "password"} 
                      placeholder="New Password (min 6 chars)"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full p-2.5 pr-10 rounded-lg border outline-none focus:ring-2 focus:ring-opacity-20 text-sm transition-colors"
                      style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-light)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--color-accent)' }}
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <div className="relative">
                    <input 
                      type={showConfirmPassword ? "text" : "password"} 
                      placeholder="Confirm New Password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full p-2.5 pr-10 rounded-lg border outline-none focus:ring-2 focus:ring-opacity-20 text-sm transition-colors"
                      style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-light)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--color-accent)' }}
                    />
                    <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-3 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t mt-4 flex justify-end gap-4" style={{ borderColor: 'var(--border-light)' }}>
                <button  
                  type="button" 
                  onClick={() => {
                    setIsEditing(false);
                    setPassword('');
                    setConfirmPassword('');
                    if (shopSettings) {
                      setFormData({
                        shop_name: shopSettings.shop_name || '',
                        owner_name: shopSettings.owner_name || '',
                        shop_address: shopSettings.shop_address || '',
                        phone: shopSettings.phone || '',
                        upi_id: shopSettings.upi_id || '',
                        admin_email: shopSettings.admin_email || ''
                      });
                      setLogoPreview(shopSettings.logo_url);
                      setLogoFile(null);
                    }
                  }}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold uppercase tracking-wider text-sm transition-colors border hover:bg-[var(--bg-tertiary)]"
                  style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={isLoading}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-white font-bold uppercase tracking-wider text-sm shadow-sm transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                >
                  {isLoading ? (
                    <>Saving...</>
                  ) : (
                    <><Save size={18} /> Save Changes</>
                  )}
                </button>
              </div>
            </>
          )}

        </form>
      </div>
    </div>
  );
}
