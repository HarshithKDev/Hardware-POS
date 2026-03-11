import React, { useState } from 'react';

export default function EntryFlow() {
  // useState (useState - a React Hook that lets you add a state variable to your component)
  const [step, setStep] = useState(1);
  const [location, setLocation] = useState(null); 
  const [role, setRole] = useState(null);         
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLocationSelect = (selectedLocation) => {
    setLocation(selectedLocation);
    setStep(2);
  };

  const handleRoleSelect = (selectedRole) => {
    setRole(selectedRole);
    setStep(3);
  };

  const handleLogin = (e) => {
    e.preventDefault(); // (preventDefault - a method that stops the default action of an element from happening, like a form submitting and refreshing the page)
    
    if (role === 'owner' && password === 'owner') {
      alert(`Logged in as Owner at ${location}`);
    } else if (role === 'worker' && password === 'worker') {
      alert(`Logged in as Worker at ${location}`);
    } else {
      setError('Incorrect password. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-md p-8 border border-gray-100">
        
        {step === 1 && (
          <div className="animate-fade-in">
            <h2 className="text-2xl font-semibold text-gray-800 mb-6 text-center">Select Location</h2>
            <div className="space-y-4">
              <button 
                onClick={() => handleLocationSelect('Warehouse')}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-lg font-medium transition-colors"
              >
                Warehouse
              </button>
              <button 
                onClick={() => handleLocationSelect('Store')}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-lg font-medium transition-colors"
              >
                Store
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="animate-fade-in">
            <button 
              onClick={() => setStep(1)} 
              className="text-sm text-gray-500 hover:text-gray-800 mb-4 flex items-center"
            >
              ← Back
            </button>
            <h2 className="text-2xl font-semibold text-gray-800 mb-2 text-center">Select Role</h2>
            <p className="text-center text-gray-500 mb-6">Location: {location}</p>
            <div className="space-y-4">
              <button 
                onClick={() => handleRoleSelect('owner')}
                className="w-full py-4 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-lg font-medium transition-colors"
              >
                Owner
              </button>
              <button 
                onClick={() => handleRoleSelect('worker')}
                className="w-full py-4 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-lg font-medium transition-colors border border-slate-300"
              >
                Worker
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="animate-fade-in">
            <button 
              onClick={() => { setStep(2); setError(''); setPassword(''); }} 
              className="text-sm text-gray-500 hover:text-gray-800 mb-4 flex items-center"
            >
              ← Back
            </button>
            <h2 className="text-2xl font-semibold text-gray-800 mb-2 text-center">Enter Password</h2>
            <p className="text-center text-gray-500 mb-6 capitalize">{location} • {role}</p>
            
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg"
                  autoFocus // (autoFocus - an HTML attribute that automatically focuses the input field when the page loads)
                />
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <button 
                type="submit"
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Login
              </button>
            </form>
          </div>
        )}

      </div>
    </div>
  );
}