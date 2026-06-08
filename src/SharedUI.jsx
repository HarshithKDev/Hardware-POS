import React, { useState, useRef, useEffect } from 'react';

// Shared UI primitives — import from here, never redefine elsewhere.

export const Spinner = ({ className = "w-5 h-5 text-current" }) => (
  <svg
    className={`animate-spin ${className}`}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

export const PageLoader = ({ text = "Loading..." }) => (
  <div className="flex flex-col items-center justify-center p-8">
    <div className="premium-wave-loader mb-6">
      <span></span>
      <span></span>
      <span></span>
      <span></span>
      <span></span>
    </div>
    {text && (
      <p className="text-xs font-semibold uppercase tracking-widest animate-pulse" style={{ color: 'var(--text-tertiary)' }}>
        {text}
      </p>
    )}
  </div>
);

export const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

export const EyeSlashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
  </svg>
);

export function CreatableDropdown({ value, onChange, options, placeholder, onCreate, disabled, required }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef(null);

  useEffect(() => {
    setSearch(value || '');
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  const filteredOptions = options.filter(opt => opt.toLowerCase().includes(search.toLowerCase()));
  const exactMatch = options.find(opt => opt.toLowerCase() === search.trim().toLowerCase());

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        type="text"
        value={search}
        onChange={(e) => {
           setSearch(e.target.value);
           setIsOpen(true);
           if (!e.target.value) onChange('');
        }}
        onFocus={() => setIsOpen(true)}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        className="w-full h-10 px-3 text-sm focus:outline-none disabled:opacity-50"
        style={{ border: '2px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}
      />
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3" style={{ color: 'var(--text-tertiary)' }}>
         <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>
      </div>

      {isOpen && !disabled && (
        <div className="absolute z-50 w-full mt-1 max-h-60 overflow-y-auto shadow-lg" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
          {filteredOptions.map(opt => (
            <div
              key={opt}
              className="px-3 py-2 text-sm cursor-pointer transition-colors"
              style={{ color: 'var(--text-primary)', backgroundColor: 'var(--bg-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-accent)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
              onClick={() => {
                onChange(opt);
                setSearch(opt);
                setIsOpen(false);
              }}
            >
              {opt}
            </div>
          ))}
          {search.trim() && !exactMatch && (
            <div
              className="px-3 py-2 text-sm cursor-pointer font-bold transition-colors"
              style={{ color: 'var(--color-accent)', backgroundColor: 'var(--bg-tertiary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-accent)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; e.currentTarget.style.color = 'var(--color-accent)'; }}
              onClick={() => {
                onCreate(search.trim());
                setIsOpen(false);
              }}
            >
              + Create "{search.trim()}"
            </div>
          )}
          {filteredOptions.length === 0 && !search.trim() && (
            <div className="px-3 py-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>Type to search...</div>
          )}
        </div>
      )}
    </div>
  );
}