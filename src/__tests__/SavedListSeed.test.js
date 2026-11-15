// Lists kept on the device (categories, sub-categories): the saved copy shows at once, but the
// server is always asked, and an empty saved copy never stands in for the real list.
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { savedListSeed } from '../services/db';

const watch = (client, read, serverList) => {
  const queryFn = vi.fn(async () => serverList);
  const observer = new QueryObserver(client, {
    queryKey: ['categories', 'shop-1'], queryFn, staleTime: 5 * 60 * 1000, ...savedListSeed(read),
  });
  const seen = [];
  const stop = observer.subscribe(r => seen.push(r.data));
  return { queryFn, observer, seen, stop };
};

describe('savedListSeed', () => {
  it('an empty saved copy is not used: the page waits for the server list', async () => {
    const client = new QueryClient();
    const { queryFn, observer, stop } = watch(client, () => [], [{ name: 'Locks' }]);
    expect(observer.getCurrentResult().isPending).toBe(true);
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual([{ name: 'Locks' }]));
    expect(queryFn).toHaveBeenCalledTimes(1);
    stop();
  });

  it('a saved copy shows straight away and is still refreshed from the server', async () => {
    const client = new QueryClient();
    const { queryFn, observer, seen, stop } = watch(client, () => [{ name: 'Old' }], [{ name: 'Locks' }, { name: 'Pipes' }]);
    expect(seen[0] ?? observer.getCurrentResult().data).toEqual([{ name: 'Old' }]);
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toHaveLength(2));
    expect(queryFn).toHaveBeenCalledTimes(1);
    stop();
  });
});
