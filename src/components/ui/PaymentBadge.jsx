import { Banknote, Smartphone, Store } from 'lucide-react';
import Badge from './Badge';

// How a bill was paid: an icon plus a short word, so it reads at a glance and stays small
// enough to sit on the same line as the amount on phones. Plain icons only (no payment
// brand logos).
const KINDS = {
  CASH: { tone: 'success', label: 'Cash', icons: [Banknote] },
  UPI: { tone: 'accent', label: 'UPI', icons: [Smartphone] },
  SPLIT: { tone: 'warning', label: 'Split', icons: [Banknote, Smartphone] },
  SHOWROOM: { tone: 'neutral', label: 'Showroom', icons: [Store] },
};

export default function PaymentBadge({ method, className = '' }) {
  if (!method) return null;
  const kind = KINDS[method] || { tone: 'neutral', label: method, icons: [] };
  return (
    <Badge tone={kind.tone} className={`normal-case tracking-normal ${className}`} title={kind.label}>
      {kind.icons.map((Icon, i) => <Icon key={i} className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />)}
      <span>{kind.label}</span>
    </Badge>
  );
}
