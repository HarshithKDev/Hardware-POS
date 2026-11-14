/**
 * Window event that carries each "something changed" signal from the database
 * ({ kind: 'product' | 'batch' | 'bill', op, ref }) from the one live subscription
 * (services/sync.js) to the screens that refresh on it (services/liveRefresh.js).
 */
export const POS_EVENT = 'pos_db_event';
