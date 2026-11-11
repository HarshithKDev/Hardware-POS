import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { getLocalScrewBoxes } from './services/db';
import { openScrewBox, storeBoxCount } from './services/screwBox';
import { PageLoader } from './SharedUI';
import { Button, PageHeader } from './components/ui';

/**
 * Billable staff: list of screw boxes with store stock. "Open 1 Box" removes one box from
 * store stock so its screws can be sold loose at the counter (not a sale).
 */
export default function ScrewBoxesView() {
  const { showAlert, showConfirm, isWarehouseDisabled, shopSettings } = useApp();
  const queryClient = useQueryClient();
  const shopId = shopSettings?.id || localStorage.getItem('shop_id');
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [openingBarcode, setOpeningBarcode] = useState(null);

  const load = useCallback(async () => {
    try {
      setItems(await getLocalScrewBoxes(shopId));
    } catch (e) {
      console.error('Could not load screw boxes:', e);
    } finally {
      setIsLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    load();
    const onSync = () => load();
    window.addEventListener('inventory_sync_complete', onSync);
    return () => window.removeEventListener('inventory_sync_complete', onSync);
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i => String(i.name || '').toLowerCase().includes(q) || String(i.barcode || '').includes(q));
  }, [items, search]);

  const handleOpen = (item) => {
    if (storeBoxCount(item, isWarehouseDisabled) < 1) {
      showAlert(`No boxes of ${item.name} left in store stock.`, 'No Boxes in Store');
      return;
    }
    showConfirm(
      `Open 1 box of ${item.name} for loose sale?\n\nIt is removed from store stock. This is not a sale.`,
      async () => {
        setOpeningBarcode(item.barcode);
        try {
          await openScrewBox({ item, shopId, isWarehouseDisabled });
          queryClient.invalidateQueries({ queryKey: ['inventory'] });
          queryClient.invalidateQueries({ queryKey: ['inventory_item'] });
          await load();
          showAlert(`1 box of ${item.name} opened for loose sale.`, 'Box Opened');
        } catch (err) {
          showAlert(err.message || 'Could not open the box.', 'Error');
        } finally {
          setOpeningBarcode(null);
        }
      },
      'Open Screw Box',
      'Open 1 Box',
      'Cancel'
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full px-4 pb-6 pt-1 md:px-0 animate-fade-in">
      <div className="max-w-3xl w-full mx-auto flex flex-col gap-4">
        <PageHeader
          title="Screw Boxes"
          subtitle="Opening a box for loose sale removes 1 box from store stock. It is not a sale."
          className="mb-0"
        />

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search screw box name or barcode..."
          aria-label="Search screw boxes"
          className="w-full h-10 px-3 text-sm rounded-md bg-[var(--bg-input)] text-[var(--text-input)] border border-[var(--border-input)] focus:outline-none focus:border-[var(--color-accent)]"
        />

        {isLoading ? (
          <div className="py-16 flex justify-center"><PageLoader text="Loading screw boxes..." /></div>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-[var(--text-secondary)]">
            {items.length === 0 ? 'No Screw Box products yet. The owner can add them in Add Items (type: Screw Box).' : 'No screw boxes match your search.'}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map(item => {
              const count = storeBoxCount(item, isWarehouseDisabled);
              const isOpening = openingBarcode === item.barcode;
              return (
                <div key={item.barcode} className="flex items-center justify-between gap-3 p-3 rounded-[10px] border border-[var(--border-light)] bg-[var(--bg-secondary)]">
                  <div className="min-w-0">
                    <p title={String(item.name ?? '')} className="font-semibold text-sm text-[var(--text-primary)] truncate">{item.name}</p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      #{item.barcode} · <span className={count < 1 ? 'text-[var(--color-error)] font-semibold' : ''}>{count} {count === 1 ? 'box' : 'boxes'} in store</span>
                    </p>
                  </div>
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() => handleOpen(item)}
                    disabled={count < 1}
                    loading={isOpening}
                  >
                    Open 1 Box
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
