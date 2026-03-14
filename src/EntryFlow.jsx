import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; // We need the database connection here now!

export default function EntryFlow({ onLoginSuccess }) {
  const [step, setStep] = useState(1);
  const [location, setLocation] = useState(null); 
  const [role, setRole] = useState(null);         
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  
  // State to hold the dynamic list of workers from the database
  const [workers, setWorkers] = useState([]);

  // Fetch the workers from the database as soon as the login screen opens
  useEffect(() => {
    const fetchWorkers = async () => {
      const { data, error } = await supabase.from('workers').select('*');
      if (data && !error) {
        setWorkers(data);
      }
    };
    fetchWorkers();
  }, []);

  const handleLocationSelect = (selectedLocation) => {
    setLocation(selectedLocation);
    setStep(2);
  };

  const handleRoleSelect = (selectedRole) => {
    setRole(selectedRole); // This will either be 'owner' or a specific worker's name (like 'Suresh')
    setStep(3);
  };

  const handleLogin = (e) => {
    e.preventDefault(); 
    
    if (role === 'owner') {
      // The master owner password is still hardcoded for now
      if (password === 'owner') {
        onLoginSuccess('owner', location);
      } else {
        setError('Incorrect owner password.');
      }
    } else {
      // Find the specific worker they clicked on in our downloaded list
      const matchedWorker = workers.find(w => w.name === role);
      
      // Check if the password they typed matches the password in the database
      if (matchedWorker && password === matchedWorker.password) {
        // We pass the worker's exact name as their "role" so it shows up later if needed
        onLoginSuccess(matchedWorker.name, location);
      } else {
        setError('Incorrect password. Please try again.');
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#0078D7] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white p-8 border border-gray-400 shadow-[2px_2px_0px_rgba(0,0,0,0.2)] rounded-none">
        
        {step === 1 && (
          <div>
            <h2 className="text-2xl font-light text-black mb-6">Select Location</h2>
            <div className="space-y-3">
              <button onClick={() => handleLocationSelect('Warehouse')} className="w-full py-3 bg-[#cccccc] hover:bg-[#b3b3b3] text-black border border-gray-400 text-lg transition-colors rounded-none text-left px-4">Warehouse</button>
              <button onClick={() => handleLocationSelect('Store')} className="w-full py-3 bg-[#cccccc] hover:bg-[#b3b3b3] text-black border border-gray-400 text-lg transition-colors rounded-none text-left px-4">Store</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <button onClick={() => setStep(1)} className="text-sm text-[#0078D7] hover:underline mb-4 flex items-center">← Back</button>
            <h2 className="text-2xl font-light text-black mb-2">Select User</h2>
            <p className="text-gray-600 mb-6 text-sm">Location: {location}</p>
            <div className="space-y-3">
              {/* The constant Owner button */}
              <button onClick={() => handleRoleSelect('owner')} className="w-full py-3 bg-[#1e1e1e] hover:bg-[#333333] text-white border border-gray-600 text-lg transition-colors rounded-none text-left px-4">Admin (Owner)</button>
              
              {/* A dynamic list (Dynamic list - a list that automatically updates and renders based on the available data) of buttons for every worker in the database */}
              {workers.map((worker) => (
                <button 
                  key={worker.id} 
                  onClick={() => handleRoleSelect(worker.name)} 
                  className="w-full py-3 bg-[#cccccc] hover:bg-[#b3b3b3] text-black border border-gray-400 text-lg transition-colors rounded-none text-left px-4 capitalize"
                >
                  {worker.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <button onClick={() => { setStep(2); setError(''); setPassword(''); }} className="text-sm text-[#0078D7] hover:underline mb-4 flex items-center">← Back</button>
            <h2 className="text-2xl font-light text-black mb-2">Enter Password</h2>
            <p className="text-gray-600 mb-6 text-sm capitalize">{location} • User: {role}</p>
            
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full px-3 py-2 border border-gray-400 focus:outline-none focus:border-[#0078D7] focus:ring-1 focus:ring-[#0078D7] text-lg rounded-none" autoFocus />
              </div>
              {error && <p className="text-[#e81123] text-sm">{error}</p>}
              <button type="submit" className="w-full py-3 bg-[#0078D7] hover:bg-[#005a9e] text-white text-lg font-medium transition-colors rounded-none border border-[#005a9e]">Login</button>
            </form>
          </div>
        )}

      </div>
    </div>
  );
}