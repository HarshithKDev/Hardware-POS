import OwnerLedger from './OwnerLedger';

/**
 * OwnerReturns is now merged into OwnerLedger (Sales History & Returns).
 * Re-exporting OwnerLedger ensures backward compatibility with any remaining references.
 */
export default function OwnerReturns(props) {
  return <OwnerLedger isActive={true} {...props} />;
}
