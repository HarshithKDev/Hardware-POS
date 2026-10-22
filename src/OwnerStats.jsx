import { useCallback, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from './supabaseClient';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { Spinner, PageLoader } from './SharedUI';
import OwnerFailedSyncsModal from './OwnerFailedSyncsModal';
import { getFailedTransactions } from './services/db';
import {
  STORE_LOW_STOCK_THRESHOLD,
  WAREHOUSE_LOW_STOCK_THRESHOLD,
  DEAD_STOCK_ALARM_VALUE,
  STALE_TIME_5MIN,
} from './constants';
import { AlertTriangle, Calendar } from 'lucide-react';

function formatDateLabel(dStr, includeYear = false) {
  if (!dStr) return '';
  const parts = dStr.split('-');
  if (parts.length !== 3) return dStr;
  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  const d = new Date(year, month, day);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: 'numeric' } : {}),
  });
}

// ---------------------------------------------------------------
// Extracted sub-components (Phase 5 decomposition)
// ---------------------------------------------------------------

/** Animates a number counting up from previous value */
function AnimatedNumber({ valueStr, duration = 250 }) {
  const [displayValue, setDisplayValue] = useState(valueStr);
  const [prevValueStr, setPrevValueStr] = useState(valueStr);

  useEffect(() => {
    let prefix = '';
    let numStr = String(valueStr);
    
    if (numStr.startsWith('₹')) {
      prefix = '₹';
      numStr = numStr.substring(1);
    }
    
    const target = parseFloat(numStr);
    if (isNaN(target)) {
      setDisplayValue(prev => (prev === valueStr ? prev : valueStr));
      return;
    }

    let prevNum = target;
    if (prevValueStr && prevValueStr !== valueStr) {
      let pStr = String(prevValueStr);
      if (pStr.startsWith('₹')) pStr = pStr.substring(1);
      const parsed = parseFloat(pStr);
      if (!isNaN(parsed)) prevNum = parsed;
    }
    
    const hasDecimals = numStr.includes('.');
    const decimals = hasDecimals ? numStr.split('.')[1].length : 0;
    
    let startTimestamp = null;
    let animationFrameId;

    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const currentVal = prevNum + (target - prevNum) * easeProgress;
      
      setDisplayValue(`${prefix}${currentVal.toFixed(decimals)}`);
      
      if (progress < 1) {
        animationFrameId = window.requestAnimationFrame(step);
      } else {
        setDisplayValue(valueStr);
        setPrevValueStr(valueStr);
      }
    };
    
    animationFrameId = window.requestAnimationFrame(step);

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [valueStr, duration, prevValueStr]);

  return <>{displayValue || valueStr}</>;
}

/** Reusable stat card */
function StatCard({ title, value, accentColor, borderColor, onClick, clickLabel, children }) {
  const Tag = onClick ? 'button' : 'div';
  const strVal = String(value ?? '');
  const valLen = strVal.length;

  // Responsive scalable font sizing based on character length so numbers scale cleanly without dots
  const fontSizeClass = valLen > 12
    ? 'text-base sm:text-lg xl:text-xl'
    : valLen > 9
      ? 'text-lg sm:text-xl xl:text-2xl'
      : valLen > 6
        ? 'text-xl sm:text-2xl 2xl:text-3xl'
        : 'text-2xl sm:text-3xl 2xl:text-4xl';

  return (
    <Tag
      onClick={onClick}
      className={`relative p-3.5 sm:p-4 rounded-lg border border-[var(--border-light)] text-left w-full flex flex-col justify-between h-full transition-all ${onClick ? 'cursor-pointer group hover:border-[var(--color-accent)]' : ''}`}
      style={{
        backgroundColor: 'var(--bg-secondary)',
      }}
      aria-label={onClick ? clickLabel : undefined}
    >
      {/* Title Header with View action in top right */}
      <div className="w-full mb-1.5 flex items-start justify-between gap-1 min-h-[1.75rem]">
        <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider leading-snug break-words" style={{ color: 'var(--text-secondary)' }}>
          {title}
        </p>
        {onClick && (
          <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider shrink-0 text-[var(--color-accent)] opacity-80 group-hover:opacity-100 transition-opacity inline-flex items-center gap-0.5 mt-0.5">
            View ↗
          </span>
        )}
      </div>

      {/* Value Row - Scalable, responsive, never truncated with dots */}
      <div className="w-full mt-auto min-w-0">
        <p 
          className={`${fontSizeClass} font-bold tracking-tight whitespace-nowrap overflow-visible tabular-nums leading-tight`} 
          style={{ color: accentColor || 'var(--text-primary)' }} 
          title={strVal}
        >
          <AnimatedNumber valueStr={value} duration={250} />
        </p>
      </div>
      {children}
    </Tag>
  );
}

/** Sales trend bar chart */
function SalesTrendChart({ trend, isLoading }) {
  const [isAnimated, setIsAnimated] = useState(false);

  useEffect(() => {
    if (trend && trend.length > 0) {
      queueMicrotask(() => setIsAnimated(false));
      const timer = setTimeout(() => setIsAnimated(true), 50);
      return () => clearTimeout(timer);
    }
  }, [trend]);

  return (
    <div className="p-4 sm:p-5 rounded-lg border border-[var(--border-light)] flex flex-col h-full xl:col-span-2 min-w-0" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      <div className="flex justify-between items-center mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Sales Trend</p>
      </div>

      <div className="flex flex-1 items-end min-h-[8rem] gap-1 md:gap-3 w-full px-2 mb-4" role="img" aria-label="sales trend chart">
        {isLoading ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="premium-wave-loader scale-75">
              <span></span><span></span><span></span><span></span><span></span>
            </div>
          </div>
        ) : (trend || []).map((point, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group cursor-crosshair relative">
            <div
              className={`w-full relative rounded-t-sm transition-all duration-300 opacity-80 group-hover:opacity-100 ${!isAnimated ? 'ease-in' : 'ease-out'}`}
              style={{
                height: isAnimated ? `${point.heightPct}%` : '0%',
                minHeight: (isAnimated && point.rev > 0) ? '4px' : '0px',
                backgroundColor: 'var(--color-accent)',
              }}
            >
              <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-sm flex items-center gap-1 pointer-events-none" style={{ color: 'var(--text-primary)', backgroundColor: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-light)' }}>
                ₹{point.rev.toFixed(0)} <span className="font-medium text-[9px]" style={{ color: 'var(--text-tertiary)' }}>({point.label})</span>
              </span>
            </div>
            <span className={`absolute -bottom-4 left-1/2 -translate-x-1/2 text-[6px] sm:text-[7px] md:text-[8px] font-bold uppercase whitespace-nowrap text-center`} style={{ color: 'var(--text-tertiary)' }}>
              {point.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}


/** Top products list */
function TopProductsList({ products }) {
  return (
    <div className="p-4 sm:p-5 rounded-lg border border-[var(--border-light)] flex flex-col h-full min-w-0" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      <p className="text-xs font-semibold uppercase tracking-wider mb-3 pb-2 shrink-0 flex items-center justify-between" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-light)' }}>
        <span>Top 10 Profit Makers</span>
        {products.length > 0 && (
          <span className="text-[10px] font-bold text-[var(--color-success)]">{products.length} Items</span>
        )}
      </p>
      <ul className="flex-1 overflow-y-auto modal-scroll pr-1 divide-y divide-[var(--border-light)]">
        {products.length === 0 ? (
          <li className="text-sm py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>Not enough data.</li>
        ) : products.map((p, idx) => (
          <li key={p.name} className="py-1.5 sm:py-2 flex justify-between items-center hover:bg-white/[0.02] px-1 rounded transition-colors">
            <div className="flex items-center gap-2.5 overflow-hidden pr-2 min-w-0">
              <span className="text-xs font-bold w-5 shrink-0 text-right" style={{ color: 'var(--text-tertiary)' }}>{idx + 1}.</span>
              <span className="text-xs sm:text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }} title={p.name}>{p.name}</span>
            </div>
            <span className="text-xs sm:text-sm font-bold shrink-0 tabular-nums ml-2" style={{ color: 'var(--color-success)' }}>
              <AnimatedNumber valueStr={`₹${p.profit.toFixed(0)}`} duration={250} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------
// Unified Dashboard Date Filter Component with Interactive Calendar
// ---------------------------------------------------------------
function DashboardDateFilter({
  timeframe,
  setTimeframe,
  customDate,
  setCustomDate,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(timeframe); // 'today' | 'date' | 'range'
  const popoverRef = useRef(null);

  // Calendar view navigation (month and year)
  const [viewDate, setViewDate] = useState(() => {
    const dStr = timeframe === 'date' ? customDate : (timeframe === 'range' ? endDate : new Date().toLocaleDateString('en-CA'));
    const [y, m] = (dStr || '').split('-');
    return y && m ? new Date(Number(y), Number(m) - 1, 1) : new Date();
  });

  // Local range selection state while picker is open
  const [rangeStart, setRangeStart] = useState(startDate);
  const [rangeEnd, setRangeEnd] = useState(endDate);
  const [rangeSelecting, setRangeSelecting] = useState(false);

  // Sync internal state when opened
  useEffect(() => {
    if (isOpen) {
      setActiveTab(prev => (prev === timeframe ? prev : timeframe));
      setRangeStart(prev => (prev === startDate ? prev : startDate));
      setRangeEnd(prev => (prev === endDate ? prev : endDate));
      setRangeSelecting(false);
      const dStr = timeframe === 'date' ? customDate : (timeframe === 'range' ? endDate : new Date().toLocaleDateString('en-CA'));
      const [y, m] = (dStr || '').split('-');
      if (y && m) setViewDate(new Date(Number(y), Number(m) - 1, 1));
    }
  }, [isOpen, timeframe, customDate, startDate, endDate]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const todayIso = new Date().toLocaleDateString('en-CA');

  const getTriggerLabel = () => {
    if (timeframe === 'today') return 'Today';
    if (timeframe === 'date') return formatDateLabel(customDate, true) || 'Choose Date';
    if (timeframe === 'range') {
      const s = formatDateLabel(startDate, false);
      const e = formatDateLabel(endDate, true);
      if (s && e) return s === e ? e : `${s} – ${e}`;
      return 'Date Range';
    }
    return 'Today';
  };

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();

  const isCurrentOrFutureMonth = 
    viewDate.getFullYear() > currentYear || 
    (viewDate.getFullYear() === currentYear && viewDate.getMonth() >= currentMonth);

  const prevMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  };
  const nextMonth = () => {
    if (isCurrentOrFutureMonth) return;
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  };

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthName = viewDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  const firstDay = new Date(year, month, 1).getDay();
  const startOffset = (firstDay + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const calendarDays = [];
  for (let i = startOffset - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const prevMonthDate = new Date(year, month - 1, day);
    calendarDays.push({
      day,
      dateIso: prevMonthDate.toLocaleDateString('en-CA'),
      isCurrentMonth: false,
    });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const curDate = new Date(year, month, d);
    calendarDays.push({
      day: d,
      dateIso: curDate.toLocaleDateString('en-CA'),
      isCurrentMonth: true,
    });
  }
  const remaining = (7 - (calendarDays.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const nextMonthDate = new Date(year, month + 1, d);
    calendarDays.push({
      day: d,
      dateIso: nextMonthDate.toLocaleDateString('en-CA'),
      isCurrentMonth: false,
    });
  }

  const handleSelectToday = () => {
    setTimeframe('today');
    setIsOpen(false);
  };

  const handleDayClick = (dateIso) => {
    if (dateIso > todayIso) return;
    if (activeTab === 'date') {
      setCustomDate(dateIso);
      setTimeframe('date');
      setIsOpen(false);
    } else if (activeTab === 'range') {
      if (!rangeSelecting || !rangeStart) {
        setRangeStart(dateIso);
        setRangeEnd(dateIso);
        setRangeSelecting(true);
      } else {
        if (dateIso < rangeStart) {
          setRangeStart(dateIso);
          setRangeEnd(rangeStart);
        } else {
          setRangeEnd(dateIso);
        }
        setRangeSelecting(false);
      }
    }
  };

  const handleApplyRange = () => {
    let s = rangeStart || todayIso;
    let e = rangeEnd || todayIso;
    if (s > todayIso) s = todayIso;
    if (e > todayIso) e = todayIso;
    if (s > e) [s, e] = [e, s];
    setStartDate(s);
    setEndDate(e);
    setTimeframe('range');
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block self-start sm:self-auto" ref={popoverRef}>
      {/* Trigger Button: ALWAYS ONE SINGLE BOX */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3.5 py-2 text-xs font-bold uppercase rounded-md transition-all cursor-pointer shadow-sm hover:border-[var(--text-secondary)] focus:outline-none"
        style={{
          border: '1px solid var(--border-medium)',
          backgroundColor: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
        }}
        aria-expanded={isOpen}
      >
        <Calendar className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
        <span className="tracking-wide">{getTriggerLabel()}</span>
        <svg
          className={`w-3.5 h-3.5 text-[var(--text-tertiary)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* Calendar Popover Modal */}
      {isOpen && (
        <div
          className="absolute right-0 top-full mt-2 w-80 sm:w-84 rounded-xl shadow-2xl p-3.5 z-50 flex flex-col gap-3 animate-scale-in"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
          }}
        >
          {/* Top 3 Options */}
          <div
            className="grid grid-cols-3 p-1 rounded-lg gap-1 text-[11px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: 'var(--bg-tertiary)' }}
          >
            <button
              type="button"
              onClick={handleSelectToday}
              className={`py-1.5 px-2 rounded-md transition-all cursor-pointer text-center ${activeTab === 'today' ? 'shadow-sm text-white' : 'hover:text-[var(--text-primary)]'}`}
              style={{
                backgroundColor: activeTab === 'today' ? 'var(--color-accent)' : 'transparent',
                color: activeTab === 'today' ? '#ffffff' : 'var(--text-secondary)',
              }}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('date')}
              className={`py-1.5 px-2 rounded-md transition-all cursor-pointer text-center ${activeTab === 'date' ? 'shadow-sm text-white' : 'hover:text-[var(--text-primary)]'}`}
              style={{
                backgroundColor: activeTab === 'date' ? 'var(--color-accent)' : 'transparent',
                color: activeTab === 'date' ? '#ffffff' : 'var(--text-secondary)',
              }}
            >
              Choose Date
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('range')}
              className={`py-1.5 px-2 rounded-md transition-all cursor-pointer text-center ${activeTab === 'range' ? 'shadow-sm text-white' : 'hover:text-[var(--text-primary)]'}`}
              style={{
                backgroundColor: activeTab === 'range' ? 'var(--color-accent)' : 'transparent',
                color: activeTab === 'range' ? '#ffffff' : 'var(--text-secondary)',
              }}
            >
              Date Range
            </button>
          </div>

          {/* Interactive Calendar for Choose Date & Date Range */}
          {activeTab !== 'today' && (
            <div className="flex flex-col gap-2.5">
              {/* Calendar Month Header & Nav */}
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                  {monthName}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={prevMonth}
                    className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                    title="Previous month"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={nextMonth}
                    disabled={isCurrentOrFutureMonth}
                    className={`p-1 rounded transition-colors ${
                      isCurrentOrFutureMonth
                        ? 'opacity-20 cursor-not-allowed text-[var(--text-tertiary)]'
                        : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer'
                    }`}
                    title={isCurrentOrFutureMonth ? 'Future months unavailable' : 'Next month'}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Day of Week Header */}
              <div className="grid grid-cols-7 text-center">
                {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
                  <span key={d} className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-tertiary)' }}>
                    {d}
                  </span>
                ))}
              </div>

              {/* Calendar Days Grid */}
              <div className="grid grid-cols-7 gap-y-1">
                {calendarDays.map((item, idx) => {
                  const { day, dateIso, isCurrentMonth } = item;
                  const isToday = dateIso === todayIso;
                  const isFuture = dateIso > todayIso;

                  let isSelected = false;
                  let isInRange = false;
                  let isRangeStart = false;
                  let isRangeEnd = false;

                  if (activeTab === 'date') {
                    isSelected = dateIso === customDate;
                  } else if (activeTab === 'range') {
                    const s = rangeStart;
                    const e = rangeEnd;
                    if (s && e) {
                      const minD = s < e ? s : e;
                      const maxD = s < e ? e : s;
                      isInRange = dateIso >= minD && dateIso <= maxD;
                      isRangeStart = dateIso === minD;
                      isRangeEnd = dateIso === maxD;
                      isSelected = isRangeStart || isRangeEnd;
                    } else if (s) {
                      isSelected = dateIso === s;
                    }
                  }

                  let cellBg = 'transparent';
                  let cellColor = isCurrentMonth ? 'var(--text-primary)' : 'var(--text-tertiary)';
                  let borderRadius = 'rounded-md';

                  if (isSelected) {
                    cellBg = 'var(--color-accent)';
                    cellColor = '#ffffff';
                  } else if (isInRange) {
                    cellBg = 'rgba(59, 130, 246, 0.2)';
                    cellColor = 'var(--text-primary)';
                    borderRadius = isRangeStart ? 'rounded-l-md' : isRangeEnd ? 'rounded-r-md' : 'rounded-none';
                  }

                  return (
                    <button
                      key={idx}
                      type="button"
                      disabled={isFuture}
                      onClick={() => !isFuture && handleDayClick(dateIso)}
                      className={`h-7 sm:h-8 text-xs font-semibold flex items-center justify-center transition-colors relative ${borderRadius} ${
                        isFuture
                          ? 'cursor-not-allowed opacity-20 select-none'
                          : `cursor-pointer ${!isSelected && !isInRange ? 'hover:bg-[var(--bg-tertiary)]' : ''}`
                      }`}
                      style={{
                        backgroundColor: cellBg,
                        color: isFuture ? 'var(--text-tertiary)' : cellColor,
                        opacity: isFuture ? 0.25 : (isCurrentMonth ? 1 : 0.4),
                      }}
                      title={isFuture ? 'Future dates are unselectable' : undefined}
                    >
                      {day}
                      {isToday && !isSelected && (
                        <span
                          className="absolute bottom-1 w-1 h-1 rounded-full"
                          style={{ backgroundColor: 'var(--color-accent)' }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Range Information & Apply button */}
              {activeTab === 'range' && (
                <div
                  className="flex items-center justify-between pt-2 border-t mt-1"
                  style={{ borderColor: 'var(--border-light)' }}
                >
                  <div className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    {rangeStart && rangeEnd ? (
                      rangeStart === rangeEnd ? (
                        formatDateLabel(rangeStart, false)
                      ) : (
                        `${formatDateLabel(rangeStart < rangeEnd ? rangeStart : rangeEnd, false)} – ${formatDateLabel(rangeStart < rangeEnd ? rangeEnd : rangeStart, false)}`
                      )
                    ) : (
                      'Click start & end date'
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleApplyRange}
                      className="px-3 py-1 text-[11px] font-bold uppercase rounded text-white shadow-sm hover:opacity-90 cursor-pointer transition-opacity"
                      style={{ backgroundColor: 'var(--color-accent)' }}
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Main OwnerStats component
// ---------------------------------------------------------------
export default function OwnerStats({ isActive }) {
  const { showAlert, shopSettings, isWarehouseDisabled } = useApp();
  const shopId = shopSettings?.id || localStorage.getItem('shop_id');
  const [globalTimeframe, setGlobalTimeframe] = useState('today');
  const [customDate, setCustomDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toLocaleDateString('en-CA');
  });
  const [endDate, setEndDate] = useState(() => new Date().toLocaleDateString('en-CA'));

  // 1. FAST Sales & Trend Query (~40ms) — only queries bills for the chosen date/range
  const fetchSalesStats = useCallback(async () => {
    const now = new Date();
    let queryStart;
    let queryEnd;
    let tfStart;
    let tfEnd;
    let trendData = {};

    if (globalTimeframe === 'today') {
      const todayStr = now.toLocaleDateString('en-CA');
      tfStart = `${todayStr}T00:00:00`;
      tfEnd = `${todayStr}T23:59:59.999`;

      const dayOfWeek = now.getDay();
      const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(now);
      monday.setDate(monday.getDate() - diffToMonday);
      queryStart = `${monday.toLocaleDateString('en-CA')}T00:00:00`;
      queryEnd = `${todayStr}T23:59:59.999`;

      for (let i = 0; i < 7; i++) {
        const dt = new Date(monday);
        dt.setDate(dt.getDate() + i);
        const key = dt.toLocaleDateString('en-CA');
        trendData[key] = { label: dt.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(), rev: 0 };
      }
    } else if (globalTimeframe === 'date') {
      const d = customDate || now.toLocaleDateString('en-CA');
      queryStart = `${d}T00:00:00`;
      queryEnd = `${d}T23:59:59.999`;
      tfStart = queryStart;
      tfEnd = queryEnd;

      const buckets = [
        { key: '08-10', label: '8-10 AM' },
        { key: '10-12', label: '10-12 PM' },
        { key: '12-14', label: '12-2 PM' },
        { key: '14-16', label: '2-4 PM' },
        { key: '16-18', label: '4-6 PM' },
        { key: '18-20', label: '6-8 PM' },
        { key: '20-22', label: '8-10 PM' }
      ];
      buckets.forEach(b => {
        trendData[b.key] = { label: b.label, rev: 0 };
      });
    } else if (globalTimeframe === 'range') {
      let s = startDate || now.toLocaleDateString('en-CA');
      let e = endDate || now.toLocaleDateString('en-CA');
      if (s > e) [s, e] = [e, s];
      queryStart = `${s}T00:00:00`;
      queryEnd = `${e}T23:59:59.999`;
      tfStart = queryStart;
      tfEnd = queryEnd;

      const sDate = new Date(`${s}T00:00:00`);
      const eDate = new Date(`${e}T00:00:00`);
      const diffDays = Math.max(1, Math.round((eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);

      if (diffDays <= 1) {
        const buckets = [
          { key: '08-10', label: '8-10 AM' },
          { key: '10-12', label: '10-12 PM' },
          { key: '12-14', label: '12-2 PM' },
          { key: '14-16', label: '2-4 PM' },
          { key: '16-18', label: '4-6 PM' },
          { key: '18-20', label: '6-8 PM' },
          { key: '20-22', label: '8-10 PM' }
        ];
        buckets.forEach(b => {
          trendData[b.key] = { label: b.label, rev: 0 };
        });
      } else if (diffDays <= 14) {
        for (let i = 0; i < diffDays; i++) {
          const dt = new Date(sDate);
          dt.setDate(dt.getDate() + i);
          const key = dt.toLocaleDateString('en-CA');
          const label = diffDays <= 7 
            ? dt.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
            : `${dt.getDate()} ${dt.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}`;
          trendData[key] = { label, rev: 0 };
        }
      } else if (diffDays <= 31) {
        for (let i = 0; i < diffDays; i++) {
          const dt = new Date(sDate);
          dt.setDate(dt.getDate() + i);
          const key = dt.toLocaleDateString('en-CA');
          trendData[key] = { label: dt.getDate().toString(), rev: 0 };
        }
      } else {
        const numBuckets = Math.min(12, Math.ceil(diffDays / 7));
        const daysPerBucket = Math.ceil(diffDays / numBuckets);
        for (let b = 0; b < numBuckets; b++) {
          const dt = new Date(sDate);
          dt.setDate(dt.getDate() + b * daysPerBucket);
          const key = `B_${b}`;
          trendData[key] = { 
            label: `${dt.getDate()} ${dt.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}`, 
            rev: 0,
            startMs: dt.getTime(),
            endMs: dt.getTime() + daysPerBucket * 24 * 60 * 60 * 1000
          };
        }
      }
    }

    const shopId = localStorage.getItem('shop_id');
    let billsQuery = supabase
      .from('bills')
      .select('id, total_amount, created_at')
      .gte('created_at', queryStart)
      .lte('created_at', queryEnd)
      .eq('location', 'Store')
      .neq('status', 'voided')
      .neq('status', 'showroom_pending');
    if (shopId) {
      billsQuery = billsQuery.eq('shop_id', shopId);
    }
    const { data: allBills } = await billsQuery;

    const billsData = allBills || [];

    // Calculate trend bars
    let maxRev = 0;
    const sDate = startDate ? new Date(`${startDate}T00:00:00`) : new Date();
    const eDate = endDate ? new Date(`${endDate}T00:00:00`) : new Date();
    const diffDays = Math.max(1, Math.round((eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    billsData.forEach(bill => {
      let key;
      if (globalTimeframe === 'date' || (globalTimeframe === 'range' && diffDays <= 1)) {
        const billDate = new Date(bill.created_at);
        const hour = billDate.getHours();
        if (hour < 10) key = '08-10';
        else if (hour < 12) key = '10-12';
        else if (hour < 14) key = '12-14';
        else if (hour < 16) key = '14-16';
        else if (hour < 18) key = '16-18';
        else if (hour < 20) key = '18-20';
        else key = '20-22';
      } else if (globalTimeframe === 'range' && diffDays > 31) {
        const bTime = new Date(bill.created_at).getTime();
        const foundBucket = Object.keys(trendData).find(k => {
          const b = trendData[k];
          return bTime >= b.startMs && bTime < b.endMs;
        });
        key = foundBucket;
      } else {
        key = new Date(bill.created_at).toLocaleDateString('en-CA');
      }

      if (key && trendData[key]) {
        trendData[key].rev += Number(bill.total_amount || 0);
        if (trendData[key].rev > maxRev) maxRev = trendData[key].rev;
      }
    });

    const trend = Object.values(trendData).map(item => ({
      ...item,
      heightPct: maxRev === 0 ? 0 : (item.rev / maxRev) * 85
    }));

    // Filter bills for the timeframe metrics
    const tfBills = billsData.filter(b => b.created_at >= tfStart && b.created_at <= tfEnd);
    const tfBillIds = new Set(tfBills.map(b => b.id));

    let tfTrueRevenue = 0, tfGrossProfit = 0, tfTotalCost = 0, tfTotalDiscount = 0;
    let tfSalesDetails = [];
    let topProducts = [];

    const tfBillIdArray = Array.from(tfBillIds);
    if (tfBillIdArray.length > 0) {
      const chunkSize = 100;
      const chunks = [];
      for (let i = 0; i < tfBillIdArray.length; i += chunkSize) {
        chunks.push(tfBillIdArray.slice(i, i + chunkSize));
      }
      const batchResults = await Promise.all(
        chunks.map(batch => {
          let q = supabase.from('bill_items')
            .select('name, quantity, price_at_sale, cost_at_sale, unit, bill_id, profit, cost_allocated, billable_quantity, system_price')
            .in('bill_id', batch);
          if (shopId) {
            q = q.eq('shop_id', shopId);
          }
          return q;
        })
      );
      const itemsData = batchResults.flatMap(r => r.data || []);

      let tProfitCents = 0, tCostCents = 0, tSystemRevCents = 0, tFinalRevCents = 0;
      const salesMap = {};
      const productStats = {};

      itemsData.forEach(item => {
        const cleanName = item.name.split(' (Cut from ')[0];
        const qty = Number(item.billable_quantity || item.quantity || 0);
        const price = Number(item.price_at_sale || 0);
        const lineCost = item.cost_allocated !== undefined && item.cost_allocated !== null ? Number(item.cost_allocated) : (Number(item.cost_at_sale || 0) * Number(item.quantity || 0));
        const lineRev = price * qty;
        const lineSystemRev = Number(item.selling_price || item.system_price || price) * qty;
        const lineProfit = item.profit !== undefined && item.profit !== null ? Number(item.profit) : (lineRev - lineCost);

        if (productStats[cleanName]) {
          productStats[cleanName].profit += lineProfit;
          productStats[cleanName].qty += qty;
        } else {
          productStats[cleanName] = { name: cleanName, profit: lineProfit, qty, unit: item.unit };
        }

        tProfitCents += Math.round(lineProfit * 100);
        tCostCents += Math.round(lineCost * 100);
        tSystemRevCents += Math.round(lineSystemRev * 100);
        tFinalRevCents += Math.round(lineRev * 100);

        if (salesMap[cleanName]) {
          salesMap[cleanName].qty += qty;
          salesMap[cleanName].lineCost += lineCost;
          salesMap[cleanName].lineRev += lineRev;
          salesMap[cleanName].lineProfit += lineProfit;
        } else {
          salesMap[cleanName] = { name: cleanName, unit: item.unit, qty, lineCost, lineRev, lineProfit };
        }
      });

      const tfTotalRevCents = tfBills.reduce((sum, bill) => sum + Math.round(Number(bill.total_amount || 0) * 100), 0);
      tfTrueRevenue = tfTotalRevCents / 100;
      tfTotalDiscount = (tSystemRevCents - tFinalRevCents) / 100;
      tfGrossProfit = tProfitCents / 100;
      tfTotalCost = tCostCents / 100;
      tfSalesDetails = Object.values(salesMap).sort((a, b) => b.lineProfit - a.lineProfit);
      topProducts = Object.values(productStats).sort((a, b) => b.profit - a.profit).slice(0, 10);
    }

    return {
      tfTrueRevenue,
      tfGrossProfit,
      tfTotalCost,
      tfTotalDiscount,
      tfSalesDetails,
      topProducts,
      trend,
    };
  }, [shopId, globalTimeframe, customDate, startDate, endDate]);

  // 2. Separate Inventory Query — runs ONCE on load, never re-runs on date change
  const fetchInventoryStats = useCallback(async () => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const deadStockStartIso = `${thirtyDaysAgo.toLocaleDateString('en-CA')}T00:00:00`;

    let dsBillsQuery = supabase
      .from('bills')
      .select('id')
      .gte('created_at', deadStockStartIso)
      .eq('location', 'Store')
      .neq('status', 'voided')
      .neq('status', 'showroom_pending');
    if (shopId) {
      dsBillsQuery = dsBillsQuery.eq('shop_id', shopId);
    }
    const dsBillsPromise = dsBillsQuery;

    let totalCountQuery = supabase
      .from('product_master')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);
    if (shopId) {
      totalCountQuery = totalCountQuery.eq('shop_id', shopId);
    }
    const { count: totalCount } = await totalCountQuery;

    const pageSize = 1000;
    const pageCount = Math.ceil((totalCount || 0) / pageSize);
    const invPromises = [];
    for (let i = 0; i < pageCount; i++) {
       let pageQuery = supabase.from('product_master')
         .select('barcode, name, price, cost_price, is_cuttable, stock_warehouse, stock_store, min_quantity_warehouse, min_quantity_store, inventory_batches(stock_warehouse, stock_store, purchase_cost, is_active)')
         .eq('is_active', true);
       if (shopId) {
         pageQuery = pageQuery.eq('shop_id', shopId);
       }
       invPromises.push(
         pageQuery.range(i * pageSize, (i + 1) * pageSize - 1)
       );
    }

    const [{ data: dsBillsData }, ...invPages] = await Promise.all([dsBillsPromise, ...invPromises]);

    let deadStockSoldNames = new Set();
    if (dsBillsData && dsBillsData.length > 0) {
      const dsBillIds = dsBillsData.map(b => b.id);
      const chunkSize = 100;
      const chunks = [];
      for (let i = 0; i < dsBillIds.length; i += chunkSize) {
        chunks.push(dsBillIds.slice(i, i + chunkSize));
      }
      const batchResults = await Promise.all(
        chunks.map(batch => {
          let q = supabase.from('bill_items')
            .select('name')
            .in('bill_id', batch);
          if (shopId) {
            q = q.eq('shop_id', shopId);
          }
          return q;
        })
      );
      const items = batchResults.flatMap(r => r.data || []);
      items.forEach(it => {
        const cleanName = it.name.split(' (Cut from ')[0].trim().toLowerCase();
        deadStockSoldNames.add(cleanName);
      });
    }

    const allStats = invPages.flatMap(r => r.data || []);
    let lowStoreItems = [], lowWarehouseItems = [], deadStockItems = [];
    let totalInventoryValue = 0, warehouseCapital = 0, storeCapital = 0, deadStockValue = 0;

    allStats.forEach(item => {
      if (item.is_deleted) return;
      let wQty = 0, sQty = 0, wCap = 0, sCap = 0;
      if (item.inventory_batches && item.inventory_batches.length > 0) {
        item.inventory_batches.forEach(b => {
          if (b.is_active) {
            const bWQty = Number(b.stock_warehouse || 0);
            const bSQty = Number(b.stock_store || 0);
            const bCost = Number(b.purchase_cost || item.cost_price || item.price * 0.7);
            wQty += bWQty;
            sQty += bSQty;
            wCap += bCost * bWQty;
            sCap += bCost * bSQty;
          }
        });
      } else {
        wQty = Number(item.stock_warehouse || 0);
        sQty = Number(item.stock_store || 0);
        const legacyCost = Number(item.cost_price || item.price * 0.7);
        wCap = legacyCost * wQty;
        sCap = legacyCost * sQty;
      }
      const totalQty = wQty + sQty;
      item.stock_store = sQty;
      item.stock_warehouse = wQty;

      if (sQty < (item.min_quantity_store ?? STORE_LOW_STOCK_THRESHOLD)) lowStoreItems.push(item);
      if (wQty < (item.min_quantity_warehouse ?? WAREHOUSE_LOW_STOCK_THRESHOLD)) lowWarehouseItems.push(item);

      totalInventoryValue += (wCap + sCap);
      warehouseCapital += wCap;
      storeCapital += sCap;

      const inventoryItemCleanName = item.name.trim().toLowerCase();
      if (totalQty > 0 && !deadStockSoldNames.has(inventoryItemCleanName)) {
        const itemDeadValue = wCap + sCap;
        deadStockValue += itemDeadValue;
        deadStockItems.push({ ...item, totalQty, deadValue: itemDeadValue });
      }
    });

    return {
      lowStoreItems: lowStoreItems.sort((a, b) => a.name.localeCompare(b.name)),
      lowWarehouseItems: lowWarehouseItems.sort((a, b) => a.name.localeCompare(b.name)),
      deadStockItems: deadStockItems.sort((a, b) => b.deadValue - a.deadValue),
      deadStockValue,
      totalInventoryValue,
      warehouseCapital,
      storeCapital,
      failedSyncs: await getFailedTransactions(shopId),
    };
  }, [shopId]);

  const { data: salesData, isLoading: isSalesLoading, error: salesError } = useQuery({
    queryKey: ['dashboard-sales-stats', shopId, isActive, globalTimeframe, customDate, startDate, endDate],
    queryFn: fetchSalesStats,
    placeholderData: keepPreviousData,
    staleTime: STALE_TIME_5MIN,
    enabled: isActive,
    refetchOnWindowFocus: true,
  });

  const { data: invData, isLoading: isInvLoading, error: invError } = useQuery({
    queryKey: ['dashboard-inventory-stats', shopId, isActive],
    queryFn: fetchInventoryStats,
    staleTime: STALE_TIME_5MIN,
    enabled: isActive,
    refetchOnWindowFocus: true,
  });

  // Modal state (local — only used here)
  const [activeModal, setActiveModal] = useState(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setActiveModal(null);
    };
    if (activeModal) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [activeModal]);

  if ((!salesData && isSalesLoading) || (!invData && isInvLoading)) {
    return (
      <div className="h-full flex flex-col items-center justify-center min-h-[300px]">
        <PageLoader text="Loading dashboard..." />
      </div>
    );
  }

  if (salesError || invError) {
    return (
      <div className="h-full flex items-center justify-center min-h-[300px]">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-error)' }}>Failed to load dashboard stats. Please try again.</p>
      </div>
    );
  }

  const tfTrueRevenue = salesData?.tfTrueRevenue ?? 0;
  const tfGrossProfit = salesData?.tfGrossProfit ?? 0;
  const tfTotalCost = salesData?.tfTotalCost ?? 0;
  const tfTotalDiscount = salesData?.tfTotalDiscount ?? 0;
  const tfSalesDetails = salesData?.tfSalesDetails ?? [];
  const topProducts = salesData?.topProducts ?? [];
  const tfTrend = salesData?.trend ?? [];

  const lowStoreItems = invData?.lowStoreItems ?? [];
  const lowWarehouseItems = invData?.lowWarehouseItems ?? [];
  const deadStockItems = invData?.deadStockItems ?? [];
  const deadStockValue = invData?.deadStockValue ?? 0;
  const totalInventoryValue = invData?.totalInventoryValue ?? 0;
  const warehouseCapital = invData?.warehouseCapital ?? 0;
  const storeCapital = invData?.storeCapital ?? 0;
  const failedSyncs = invData?.failedSyncs ?? [];

  const getTimeframeLabel = () => {
    if (globalTimeframe === 'today') {
      return 'Today';
    }
    if (globalTimeframe === 'date') {
      return formatDateLabel(customDate, false) || 'Selected Date';
    }
    if (globalTimeframe === 'range') {
      const s = formatDateLabel(startDate, false);
      const e = formatDateLabel(endDate, false);
      if (s && e) {
        return s === e ? s : `${s} - ${e}`;
      }
      return 'Date Range';
    }
    return 'Today';
  };

  const timeframeLabel = getTimeframeLabel();

  return (
    <div className="flex flex-col h-auto lg:h-full relative">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 shrink-0 gap-4">
        <h1 className="text-2xl font-medium" style={{ color: 'var(--text-primary)' }}>Business Overview</h1>
        <div className="flex items-center gap-2.5 flex-wrap">
          <DashboardDateFilter
            timeframe={globalTimeframe}
            setTimeframe={setGlobalTimeframe}
            customDate={customDate}
            setCustomDate={setCustomDate}
            startDate={startDate}
            setStartDate={setStartDate}
            endDate={endDate}
            setEndDate={setEndDate}
          />
        </div>
      </div>

      {failedSyncs && failedSyncs.length > 0 && (
        <div className="mb-6 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.05)', border: '1px solid var(--color-error)' }}>
          <div className="flex items-center gap-4">
            <AlertTriangle className="w-8 h-8 text-[var(--color-error)] shrink-0" />
            <div>
              <p className="text-sm font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--color-error)' }}>{failedSyncs.length} Offline Transaction(s) Failed to Sync</p>
              <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>These transactions encountered errors when uploading to the cloud and require manual review to resolve.</p>
            </div>
          </div>
          <button onClick={() => setActiveModal('failed-syncs')} className="px-5 py-2.5 text-xs font-bold text-white uppercase tracking-wider shrink-0 shadow-sm hover:opacity-90 transition-opacity" style={{ backgroundColor: 'var(--color-error)' }}>
            Review Issues
          </button>
        </div>
      )}

      {/* ROW 1: TODAY'S VITALS */}
      <div className={`grid grid-cols-2 md:grid-cols-3 ${isWarehouseDisabled ? '2xl:grid-cols-5' : '2xl:grid-cols-6'} gap-3 lg:gap-4 mb-4 shrink-0`}>
        <StatCard title="Revenue" value={`₹${tfTrueRevenue.toFixed(2)}`} borderColor="var(--color-success)" />
        <StatCard
          title="Profit"
          value={`₹${tfGrossProfit.toFixed(2)}`}
          accentColor="var(--color-success)"
          borderColor="var(--color-success)"
          onClick={() => setActiveModal('profit')}
          clickLabel="View profit details"
        />
        <StatCard
          title="Discount Given"
          value={`₹${(tfTotalDiscount || 0).toFixed(2)}`}
          borderColor="var(--color-warning)"
        />
        <StatCard
          title={isWarehouseDisabled ? "Low Stock" : "Shop Low Stock"}
          value={lowStoreItems.length}
          accentColor={lowStoreItems.length > 0 ? 'var(--color-error)' : undefined}
          borderColor={lowStoreItems.length > 0 ? 'var(--color-error)' : 'var(--color-accent)'}
          onClick={() => setActiveModal('low-store')}
          clickLabel="View low stock items"
        />
        {!isWarehouseDisabled && (
          <StatCard
            title="Warehouse Low Stock"
            value={lowWarehouseItems.length}
            accentColor={lowWarehouseItems.length > 0 ? 'var(--color-error)' : undefined}
            borderColor={lowWarehouseItems.length > 0 ? 'var(--color-error)' : 'var(--color-accent)'}
            onClick={() => setActiveModal('low-warehouse')}
            clickLabel="View warehouse low stock"
          />
        )}
        <StatCard
          title="Dead Stock Value"
          value={`₹${deadStockValue.toFixed(0)}`}
          accentColor={deadStockValue > DEAD_STOCK_ALARM_VALUE ? 'var(--color-error)' : 'var(--color-warning)'}
          borderColor={deadStockValue > DEAD_STOCK_ALARM_VALUE ? 'var(--color-error)' : 'var(--color-warning)'}
          onClick={() => setActiveModal('dead-stock')}
          clickLabel="View dead stock items"
        />
      </div>

      {/* ROW 2: TRENDS & LEADERBOARD */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 lg:gap-4 mb-4 flex-1 min-h-[420px] xl:min-h-0 min-w-0">
        <SalesTrendChart 
          trend={tfTrend}
          isLoading={isSalesLoading}
        />
        <TopProductsList products={topProducts} />
      </div>

      {/* ROW 3: CAPITAL */}
      <div className={`grid ${isWarehouseDisabled ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3'} gap-3 lg:gap-4 shrink-0`}>
        <StatCard title="Total Asset Value" value={`₹${totalInventoryValue.toFixed(2)}`} borderColor="var(--text-tertiary)" />
        {!isWarehouseDisabled && (
          <StatCard title="Warehouse Capital" value={`₹${warehouseCapital.toFixed(2)}`} borderColor="var(--color-accent)" />
        )}
        <div className={isWarehouseDisabled ? '' : 'col-span-2 md:col-span-1'}>
          <StatCard title={isWarehouseDisabled ? "Stock Capital" : "Store Capital"} value={`₹${storeCapital.toFixed(2)}`} borderColor="var(--color-accent)" />
        </div>
      </div>

      {/* MODALS */}
      {activeModal && createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center z-[10001] p-4 sm:p-6 md:p-8 bg-black/75 backdrop-blur-sm animate-fade-in"
          onClick={() => setActiveModal(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="stats-modal-title"
        >
          <div
            className="w-full max-w-4xl flex flex-col h-[70vh] max-h-[620px] rounded-2xl overflow-hidden shadow-2xl border border-[var(--border-light)] animate-scale-in my-auto"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex justify-between items-center px-5 py-3.5 shrink-0 border-b border-[var(--border-light)] gap-3 flex-wrap"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            >
              <div className="flex items-center gap-3 flex-wrap">
                <span id="stats-modal-title" className="text-xs sm:text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                  {activeModal === 'profit' && 'Profit & Sales Breakdown'}
                  {activeModal === 'low-store' && (isWarehouseDisabled ? 'Items Running Low in Stock' : 'Items Running Low in Store Front')}
                  {activeModal === 'low-warehouse' && `Items Running Low in Warehouse`}
                  {activeModal === 'dead-stock' && `Dead Stock`}
                  {activeModal === 'failed-syncs' && 'Failed Offline Transactions'}
                </span>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="px-3.5 py-1.5 text-white rounded-lg text-xs font-bold focus:outline-none transition-all hover:opacity-90 active:scale-95 cursor-pointer shadow-sm"
                style={{ backgroundColor: 'var(--color-error)' }}
              >
                Close
              </button>
            </div>

            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {activeModal === 'profit' && (
                <>
                  <div className="grid grid-cols-3 p-4 shrink-0" style={{ backgroundColor: 'var(--color-success-bg)', borderBottom: '1px solid var(--border-medium)' }}>
                    <div className="text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
                      <p className="text-xs font-bold uppercase mb-1" style={{ color: 'var(--text-secondary)' }}>Total Cost of Goods</p>
                      <p className="text-xl font-medium" style={{ color: 'var(--text-primary)' }}>₹{tfTotalCost.toFixed(2)}</p>
                    </div>
                    <div className="text-center" style={{ borderRight: '1px solid var(--border-medium)' }}>
                      <p className="text-xs font-bold uppercase mb-1" style={{ color: 'var(--text-secondary)' }}>Total Sold For</p>
                      <p className="text-xl font-medium" style={{ color: 'var(--text-primary)' }}>₹{tfTrueRevenue.toFixed(2)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-bold uppercase mb-1" style={{ color: 'var(--color-success)' }}>Net Profit Generated</p>
                      <p className="text-xl font-bold" style={{ color: 'var(--color-success)' }}>₹{tfGrossProfit.toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto w-full modal-scroll">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 z-20 shadow-sm" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
                        <tr className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                          <th className="p-3" style={{ borderRight: '1px solid var(--border-medium)' }}>Item Sold</th>
                          <th className="p-3 text-left" style={{ borderRight: '1px solid var(--border-medium)' }}>Total Qty</th>
                          <th className="p-3 text-left" style={{ borderRight: '1px solid var(--border-medium)' }}>Total Cost</th>
                          <th className="p-3 text-left" style={{ borderRight: '1px solid var(--border-medium)' }}>Total Sold For</th>
                          <th className="p-3 text-left">Profit Generated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tfSalesDetails.length === 0 ? (
                          <tr><td colSpan="5" className="h-48 align-middle text-center text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>No sales recorded.</td></tr>
                        ) : tfSalesDetails.map((item, idx) => (
                          <tr key={idx} className="hover:bg-[var(--bg-hover)] transition-colors" style={{ borderBottom: '1px solid var(--border-medium)' }}>
                            <td className="p-3 text-sm font-medium" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-medium)' }}>{item.name}</td>
                            <td className="p-3 text-sm text-left" style={{ borderRight: '1px solid var(--border-medium)' }}>{item.qty} {item.unit}</td>
                            <td className="p-3 text-sm text-left" style={{ borderRight: '1px solid var(--border-medium)' }}>₹{item.lineCost.toFixed(2)}</td>
                            <td className="p-3 text-sm text-left" style={{ borderRight: '1px solid var(--border-medium)' }}>₹{item.lineRev.toFixed(2)}</td>
                            <td className="p-3 text-sm text-left font-bold" style={{ color: 'var(--color-success)' }}>₹{item.lineProfit.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {(activeModal === 'low-store' || activeModal === 'low-warehouse' || activeModal === 'dead-stock') && (
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto w-full modal-scroll">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-20 shadow-sm" style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-medium)' }}>
                      <tr className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                        <th className="p-3 w-32" style={{ borderRight: '1px solid var(--border-medium)' }}>Barcode</th>
                        <th className="p-3" style={{ borderRight: '1px solid var(--border-medium)' }}>Item Name</th>
                        {activeModal === 'dead-stock' ? (
                          <>
                            <th className="p-3 text-left w-32" style={{ borderRight: '1px solid var(--border-medium)' }}>Locked Qty</th>
                            <th className="p-3 text-left whitespace-nowrap">Capital Tied Up</th>
                          </>
                        ) : (
                          <>
                            <th className="p-3 text-left w-32" style={{ borderRight: '1px solid var(--border-medium)' }}>Min Qty</th>
                            <th className="p-3 text-left w-32">Current Qty</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-medium)]">
                      {activeModal === 'low-store' && lowStoreItems.length === 0 && (
                        <tr><td colSpan="4" className="h-48 align-middle text-center text-sm font-semibold" style={{ color: 'var(--color-success)' }}>Nothing in low stock.</td></tr>
                      )}
                      {activeModal === 'low-store' && lowStoreItems.map(item => (
                        <tr key={item.barcode} className="hover:bg-[var(--bg-hover)] transition-colors" style={{ borderBottom: '1px solid var(--border-medium)' }}>
                          <td className="p-3 text-sm font-semibold" style={{ color: 'var(--color-accent)', borderRight: '1px solid var(--border-medium)' }}>{item.barcode}</td>
                          <td className="p-3 text-sm font-medium" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-medium)' }}>{item.name}</td>
                          <td className="p-3 text-sm text-left font-bold" style={{ color: 'var(--text-tertiary)', borderRight: '1px solid var(--border-medium)' }}>{item.min_quantity_store ?? 10}</td>
                          <td className="p-3 text-sm text-left font-bold" style={{ color: 'var(--color-error)' }}>{item.stock_store}</td>
                        </tr>
                      ))}
                      {activeModal === 'low-warehouse' && lowWarehouseItems.length === 0 && (
                        <tr><td colSpan="4" className="h-48 align-middle text-center text-sm font-semibold" style={{ color: 'var(--color-success)' }}>Nothing in low stock.</td></tr>
                      )}
                      {activeModal === 'low-warehouse' && lowWarehouseItems.map(item => (
                        <tr key={item.barcode} className="hover:bg-[var(--bg-hover)] transition-colors" style={{ borderBottom: '1px solid var(--border-medium)' }}>
                          <td className="p-3 text-sm font-semibold" style={{ color: 'var(--color-accent)', borderRight: '1px solid var(--border-medium)' }}>{item.barcode}</td>
                          <td className="p-3 text-sm font-medium" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-medium)' }}>{item.name}</td>
                          <td className="p-3 text-sm text-left font-bold" style={{ color: 'var(--text-tertiary)', borderRight: '1px solid var(--border-medium)' }}>{item.min_quantity_warehouse ?? 50}</td>
                          <td className="p-3 text-sm text-left font-bold" style={{ color: 'var(--color-error)' }}>{item.stock_warehouse}</td>
                        </tr>
                      ))}
                      {activeModal === 'dead-stock' && deadStockItems.length === 0 && (
                        <tr><td colSpan="4" className="h-48 align-middle text-center text-sm font-semibold" style={{ color: 'var(--color-success)' }}>Great job! All your stock is active and moving.</td></tr>
                      )}
                      {activeModal === 'dead-stock' && deadStockItems.map(item => (
                        <tr key={item.barcode} className="hover:bg-[var(--bg-hover)] transition-colors" style={{ borderBottom: '1px solid var(--border-medium)' }}>
                          <td className="p-3 text-sm font-semibold" style={{ color: 'var(--color-accent)', borderRight: '1px solid var(--border-medium)' }}>{item.barcode}</td>
                          <td className="p-3 text-sm font-medium" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-medium)' }}>{item.name}</td>
                          <td className="p-3 text-sm text-left font-bold" style={{ color: 'var(--color-warning)', borderRight: '1px solid var(--border-medium)' }}>{item.totalQty}</td>
                          <td className="p-3 text-sm text-left font-bold" style={{ color: 'var(--color-error)' }}>₹{item.deadValue.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeModal === 'failed-syncs' && (
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto w-full modal-scroll">
                  <OwnerFailedSyncsModal failedSyncs={failedSyncs} onClose={() => setActiveModal(null)} />
                </div>
              )}
            </div>

          </div>
        </div>,
        document.body
      )}
    </div>
  );
}