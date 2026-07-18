import { useNavigate, useLocation } from 'react-router-dom';
import { Camera, LogOut } from 'lucide-react';

export default function AppNavbar({ displayUserName, userRole, setIsMobileScannerOpen, setShowLogoutConfirm }) {
  const navigate = useNavigate();
  const location = useLocation();

  const NavButton = ({ path, label, onClick }) => {
    const isActive = onClick ? false : location.pathname.startsWith(path);
    return (
      <button
        onClick={onClick || (() => navigate(path))}
        className="h-9 px-4 text-sm font-medium transition-colors"
        style={{
          backgroundColor: isActive ? 'var(--bg-tertiary)' : 'transparent',
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <nav
      className="w-full flex items-center justify-between px-4 md:px-6 flex-shrink-0 relative z-50 print:hidden"
      style={{
        height: '64px',
        backgroundColor: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border-light)',
      }}
    >
      <div className="h-full flex items-center gap-3 pr-4 flex-shrink-0">
        {/* Minimal Avatar */}
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center text-sm font-semibold"
          style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-fg)' }}
        >
          {displayUserName?.charAt(0)?.toUpperCase() || 'H'}
        </div>
        <span className="text-sm font-medium tracking-wide truncate hidden md:block" style={{ color: 'var(--text-primary)' }}>
          {displayUserName}
        </span>
      </div>
      <div className="flex-1 flex items-center justify-end gap-2 h-full overflow-x-auto hide-scrollbar">
        <button
          onClick={() => setIsMobileScannerOpen(true)}
          className="md:hidden h-9 px-3 text-sm font-medium flex items-center gap-2"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
        >
          <Camera size={16} /> Scan
        </button>
        {userRole === 'owner' ? (
          <>
            <NavButton path="/owner" label="Management" />
            <NavButton path="/printer" label="Barcodes" />
          </>
        ) : (
          <NavButton path="/terminal" label="Terminal" />
        )}
        <div className="h-5 w-px mx-2" style={{ backgroundColor: 'var(--border-medium)' }}></div>
        <button
          onClick={() => setShowLogoutConfirm(true)}
          className="h-9 px-3 text-sm font-medium flex items-center gap-2 transition-colors hover:opacity-80"
          style={{ backgroundColor: 'transparent', color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-error)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
        >
          <LogOut size={16} /> <span className="hidden md:inline">Sign Out</span>
        </button>
      </div>
    </nav>
  );
}