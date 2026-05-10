import { useNavigate, useLocation } from 'react-router-dom';

export default function AppNavbar({ displayUserName, userRole, setIsMobileScannerOpen, setShowLogoutConfirm }) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav className="w-full bg-white border-b border-gray-300 shadow-sm h-[60px] flex items-center justify-between px-4 flex-shrink-0 relative z-[9999]">
      <div className="h-full flex items-center border-r border-gray-300 pr-4 w-[200px] flex-shrink-0">
        <span className="text-sm font-bold text-black uppercase tracking-wider truncate w-full block">
          {displayUserName}
        </span>
      </div>
      <div className="flex-1 flex items-center justify-end gap-3 h-full pl-4 overflow-x-auto">
        <button onClick={() => setIsMobileScannerOpen(true)} className="md:hidden px-4 py-2 bg-white border border-gray-400 hover:bg-gray-200 text-xs font-bold uppercase text-black focus:outline-none rounded-none">
          Scan
        </button>
        {userRole === 'owner' ? (
          <>
            <button onClick={() => navigate('/owner/dashboard')} className={`px-6 py-2.5 text-xs font-bold uppercase tracking-wider focus:outline-none rounded-none transition-colors border ${location.pathname.startsWith('/owner') ? 'bg-[#0078D7] text-white border-[#0078D7]' : 'bg-white border-gray-400 hover:bg-gray-200 text-black'}`}>Management</button>
            <button onClick={() => navigate('/printer')} className={`px-6 py-2.5 text-xs font-bold uppercase tracking-wider focus:outline-none rounded-none transition-colors border ${location.pathname.startsWith('/printer') ? 'bg-[#0078D7] text-white border-[#0078D7]' : 'bg-white border-gray-400 hover:bg-gray-200 text-black'}`}>Barcodes</button>
          </>
        ) : (
          <button onClick={() => navigate('/terminal/dashboard')} className={`px-6 py-2.5 text-xs font-bold uppercase tracking-wider focus:outline-none rounded-none transition-colors border ${location.pathname.startsWith('/terminal') ? 'bg-[#0078D7] text-white border-[#0078D7]' : 'bg-white border-gray-400 hover:bg-gray-200 text-black'}`}>Terminal</button>
        )}
        <div className="h-8 w-px bg-gray-300 mx-1"></div>
        <button onClick={() => setShowLogoutConfirm(true)} className="px-6 py-2.5 bg-white hover:bg-[#e81123] hover:text-white hover:border-[#e81123] text-xs font-bold uppercase tracking-wider text-black border border-gray-400 transition-colors rounded-none">Sign Out</button>
      </div>
    </nav>
  );
}