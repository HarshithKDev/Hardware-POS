import { useState, useMemo } from 'react';
import { getPerformedBy } from './utils';
import { supabase } from './supabaseClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { STALE_TIME_5MIN } from './constants';
import PageTitleReset from './components/PageTitleReset';
import { buttonClass } from './components/ui';
import { Search, ChevronRight, Trash2, Plus, ArrowLeft, Tags } from 'lucide-react';

export default function OwnerCategories() {
  const { showAlert, showConfirm } = useApp();
  const queryClient = useQueryClient();

  const [newCategory, setNewCategory] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [newSubcategory, setNewSubcategory] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  // Phones show either the list or one category's sub-categories
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const handleResetCategories = () => {
    setNewCategory('');
    setSelectedCategory('');
    setNewSubcategory('');
    setCategorySearch('');
    setMobileDetailOpen(false);
  };

  const shopId = localStorage.getItem('shop_id');

  // Fetch Categories
  const { data: categories = [] } = useQuery({
    queryKey: ['categories', shopId],
    queryFn: async () => {
      let query = supabase.from('categories').select('*').order('name', { ascending: true });
      if (shopId) {
        query = query.eq('shop_id', shopId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    staleTime: STALE_TIME_5MIN
  });

  // Fetch Subcategories
  const { data: subcategories = [] } = useQuery({
    queryKey: ['subcategories', shopId],
    queryFn: async () => {
      let query = supabase.from('subcategories').select('*').order('name', { ascending: true });
      if (shopId) {
        query = query.eq('shop_id', shopId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    staleTime: STALE_TIME_5MIN
  });

  const addCategoryMutation = useMutation({
    mutationFn: async (name) => {
      const shopId = localStorage.getItem('shop_id');
      const { error } = await supabase.from('categories').insert([{ name, shop_id: shopId }]);
      if (error) throw error;

      await supabase.from('audit_logs').insert([{
        shop_id: shopId,
        action_type: 'CREATE',
        barcode: 'CATEGORY',
        item_name: name,
        changes: `Added Category: ${name}`,
        performed_by: getPerformedBy()
      }]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      setSelectedCategory(newCategory.trim());
      setNewCategory('');
      showAlert('Category added successfully.', 'Success');
    },
    onError: (e) => {
      if (e.code === '23505') showAlert('This category already exists.', 'Error');
      else showAlert(e.message, 'System Error');
    }
  });

  const handleAddCategory = (e) => {
    e.preventDefault();
    if (!newCategory.trim()) return showAlert('Category name cannot be empty.', 'Warning');
    addCategoryMutation.mutate(newCategory.trim());
  };

  const addSubcategoryMutation = useMutation({
    mutationFn: async ({ name, category_name }) => {
      const shopId = localStorage.getItem('shop_id');
      const { error } = await supabase.from('subcategories').insert([{ name, category_name, shop_id: shopId }]);
      if (error) throw error;

      await supabase.from('audit_logs').insert([{
        shop_id: shopId,
        action_type: 'CREATE',
        barcode: 'SUB-CATEGORY',
        item_name: name,
        changes: `Added Sub-category: ${name} (under ${category_name})`,
        performed_by: getPerformedBy()
      }]);

      return category_name;
    },
    onSuccess: (category_name) => {
      queryClient.invalidateQueries({ queryKey: ['subcategories'] });
      setNewSubcategory('');
      setSelectedCategory(category_name);
      showAlert('Sub-category added successfully.', 'Success');
    },
    onError: (e) => showAlert(e.message, 'System Error')
  });

  const handleAddSubcategory = (e) => {
    e.preventDefault();
    if (!selectedCategory) return showAlert('Please select a parent category first.', 'Warning');
    if (!newSubcategory.trim()) return showAlert('Sub-category name cannot be empty.', 'Warning');
    addSubcategoryMutation.mutate({ name: newSubcategory.trim(), category_name: selectedCategory });
  };

  const deleteCategoryMutation = useMutation({
    mutationFn: async ({ name }) => {
      // Cascade check (fixes #8)
      const shopId = localStorage.getItem('shop_id');
      let countQuery = supabase.from('product_master').select('*', { count: 'exact', head: true }).eq('category', name).eq('is_active', true);
      if (shopId) countQuery = countQuery.eq('shop_id', shopId);
      const { count } = await countQuery;
      if (count && count > 0) throw new Error(`Cannot delete category "${name}" because it is assigned to ${count} active item(s) in the inventory.`);

      let delQuery = supabase.from('categories').delete().eq('name', name);
      if (shopId) delQuery = delQuery.eq('shop_id', shopId);
      const { error } = await delQuery;
      if (error) throw error;

      await supabase.from('audit_logs').insert([{
        shop_id: shopId,
        action_type: 'DELETE',
        barcode: 'CATEGORY',
        item_name: name,
        changes: `Deleted Category: ${name}`,
        performed_by: getPerformedBy()
      }]);
    },
    onSuccess: (_data, { name }) => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      if (selectedCategory === name) { setSelectedCategory(''); setMobileDetailOpen(false); }
    },
    onError: (e) => showAlert(e.message, 'Cascade Delete Blocked')
  });

  const handleDeleteCategory = (id, name) => {
    showConfirm(`Delete category "${name}"?`, () => deleteCategoryMutation.mutate({ id, name }), 'Delete Category', 'Delete Category', 'Cancel', true);
  };

  const deleteSubcategoryMutation = useMutation({
    mutationFn: async ({ name, category_name }) => {
      // Cascade check (fixes #8)
      const shopId = localStorage.getItem('shop_id');
      let countQuery = supabase.from('product_master').select('*', { count: 'exact', head: true }).eq('sub_category', name).eq('is_active', true);
      if (shopId) countQuery = countQuery.eq('shop_id', shopId);
      const { count } = await countQuery;
      if (count && count > 0) throw new Error(`Cannot delete sub-category "${name}" because it is assigned to ${count} active item(s) in the inventory.`);

      let query = supabase.from('subcategories').delete().eq('name', name);
      if (category_name) query = query.eq('category_name', category_name);
      if (shopId) query = query.eq('shop_id', shopId);

      const { error } = await query;
      if (error) throw error;

      await supabase.from('audit_logs').insert([{
        shop_id: shopId,
        action_type: 'DELETE',
        barcode: 'SUB-CATEGORY',
        item_name: name,
        changes: `Deleted Sub-category: ${name} (from ${category_name || 'unknown'})`,
        performed_by: getPerformedBy()
      }]);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subcategories'] }),
    onError: (e) => showAlert(e.message, 'Cascade Delete Blocked')
  });

  const handleDeleteSubcategory = (id, name, category_name) => {
    showConfirm(`Delete sub-category "${name}"?`, () => deleteSubcategoryMutation.mutate({ id, name, category_name }), 'Delete Sub-category', 'Delete Sub-category', 'Cancel', true);
  };

  const subCounts = useMemo(() => {
    const m = new Map();
    subcategories.forEach(sub => m.set(sub.category_name, (m.get(sub.category_name) || 0) + 1));
    return m;
  }, [subcategories]);

  const visibleCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    return q ? categories.filter(c => String(c.name || '').toLowerCase().includes(q)) : categories;
  }, [categories, categorySearch]);

  // The category shown on the right: the one picked, or the first one
  const activeName = categories.some(c => c.name === selectedCategory) ? selectedCategory : (categories[0]?.name || '');
  const activeSubs = subcategories.filter(sub => sub.category_name === activeName);

  const openCategory = (name) => {
    setSelectedCategory(name);
    setNewSubcategory('');
    setMobileDetailOpen(true);
  };

  const fieldStyle = { border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  return (
    <div className="flex flex-col h-full gap-4 animate-fade-in w-full min-h-0">
      <PageTitleReset
        title="Categories & Sub-categories"
        subtitle="Group your items. Pick a category to see and edit its sub-categories."
        onReset={handleResetCategories}
        tooltip="Click title to clear the search and the add fields"
      />

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(260px,340px)_1fr] gap-4">
        {/* LEFT: categories */}
        <section
          aria-label="Categories"
          className={`${mobileDetailOpen ? 'max-md:hidden' : ''} flex flex-col min-h-0 rounded-xl border border-[var(--border-light)] overflow-hidden`}
          style={{ backgroundColor: 'var(--bg-secondary)' }}
        >
          <div className="p-3 flex flex-col gap-2.5 border-b border-[var(--border-light)]" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Categories</h2>
              <span className="text-xs font-semibold tabular-nums text-[var(--text-tertiary)]">{categories.length}</span>
            </div>
            <form onSubmit={handleAddCategory} className="flex gap-2">
              <label htmlFor="new-cat" className="sr-only">New category name</label>
              <input id="new-cat" type="text" placeholder="New category name" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="flex-1 min-w-0 h-10 px-3 text-sm focus:outline-none rounded-md" style={fieldStyle} />
              <button type="submit" disabled={addCategoryMutation.isPending} className={buttonClass({ variant: 'primary', size: 'md' })}>
                <Plus className="w-4 h-4" aria-hidden="true" /> Add
              </button>
            </form>
            {categories.length > 6 && (
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] pointer-events-none" aria-hidden="true" />
                <label htmlFor="cat-search" className="sr-only">Search categories</label>
                <input id="cat-search" type="text" placeholder="Search categories" value={categorySearch} onChange={(e) => setCategorySearch(e.target.value)} className="w-full h-10 text-sm focus:outline-none rounded-md" style={{ ...fieldStyle, paddingLeft: '2.25rem', paddingRight: '0.75rem' }} />
              </div>
            )}
          </div>

          <ul className="flex-1 min-h-0 overflow-y-auto p-1.5" style={{ overscrollBehavior: 'contain' }}>
            {visibleCategories.length === 0 ? (
              <li className="p-6 text-center text-sm text-[var(--text-tertiary)]">
                {categories.length === 0 ? 'No categories yet. Add your first one above.' : 'No category matches your search.'}
              </li>
            ) : visibleCategories.map(cat => {
              const active = cat.name === activeName;
              const count = subCounts.get(cat.name) || 0;
              return (
                <li key={cat.name}>
                  <button
                    type="button"
                    onClick={() => openCategory(cat.name)}
                    aria-current={active ? 'true' : undefined}
                    className="w-full flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-lg text-left transition-colors hover:bg-[var(--bg-hover)]"
                    style={active ? { backgroundColor: 'var(--color-accent-bg)', boxShadow: 'inset 3px 0 0 var(--color-accent)' } : undefined}
                  >
                    <span className="flex-1 min-w-0 truncate text-sm font-semibold" style={{ color: active ? 'var(--color-accent)' : 'var(--text-primary)' }} title={cat.name}>{cat.name}</span>
                    <span className="shrink-0 text-xs tabular-nums px-2 py-0.5 rounded-full border border-[var(--border-light)] text-[var(--text-secondary)]" title={plural(count, 'sub-category', 'sub-categories')}>{count}</span>
                    <ChevronRight className="w-4 h-4 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* RIGHT: sub-categories of the selected category */}
        <section
          aria-label="Sub-categories"
          className={`${mobileDetailOpen ? '' : 'max-md:hidden'} flex flex-col min-h-0 rounded-xl border border-[var(--border-light)] overflow-hidden`}
          style={{ backgroundColor: 'var(--bg-secondary)' }}
        >
          {!activeName ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center text-[var(--text-tertiary)]">
              <Tags className="w-10 h-10 opacity-40" aria-hidden="true" />
              <p className="text-sm font-semibold text-[var(--text-secondary)]">No categories yet</p>
              <p className="text-xs">Add a category on the left, then add its sub-categories here.</p>
            </div>
          ) : (
            <>
              <div className="p-4 flex flex-col gap-3 border-b border-[var(--border-light)]" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <button type="button" onClick={() => setMobileDetailOpen(false)} className={buttonClass({ variant: 'ghost', size: 'sm', className: 'md:hidden self-start -ml-2' })}>
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" /> All categories
                </button>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-[var(--text-primary)] break-words">{activeName}</h2>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">{plural(activeSubs.length, 'sub-category', 'sub-categories')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteCategory(activeName, activeName)}
                    className={buttonClass({ variant: 'danger-outline', size: 'sm' })}
                    aria-label={`Delete category ${activeName}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Remove category
                  </button>
                </div>
                <form onSubmit={handleAddSubcategory} className="flex gap-2">
                  <label htmlFor="new-subcat" className="sr-only">New sub-category for {activeName}</label>
                  <input
                    id="new-subcat"
                    type="text"
                    placeholder={`New sub-category in ${activeName}`}
                    value={newSubcategory}
                    onFocus={() => setSelectedCategory(activeName)}
                    onChange={(e) => { setSelectedCategory(activeName); setNewSubcategory(e.target.value); }}
                    className="flex-1 min-w-0 h-10 px-3 text-sm focus:outline-none rounded-md"
                    style={fieldStyle}
                  />
                  <button type="submit" disabled={addSubcategoryMutation.isPending} className={buttonClass({ variant: 'primary', size: 'md' })}>
                    <Plus className="w-4 h-4" aria-hidden="true" /> Add
                  </button>
                </form>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-4" style={{ overscrollBehavior: 'contain' }}>
                {activeSubs.length === 0 ? (
                  <p className="text-sm text-[var(--text-tertiary)]">No sub-categories in {activeName} yet. Add one above.</p>
                ) : (
                  <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                    {activeSubs.map(sub => (
                      <li key={sub.name} className="flex items-center justify-between gap-2 pl-3 pr-1 min-h-[44px] rounded-lg border border-[var(--border-light)]" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                        <span className="text-sm font-medium text-[var(--text-primary)] break-words min-w-0">{sub.name}</span>
                        <button
                          type="button"
                          onClick={() => handleDeleteSubcategory(sub.name, sub.name, sub.category_name)}
                          className="tap-area relative shrink-0 p-2 rounded-md text-[var(--text-tertiary)] hover:text-[var(--color-error)] hover:bg-[var(--color-error-bg)] transition-colors"
                          aria-label={`Delete subcategory ${sub.name}`}
                          title={`Delete ${sub.name}`}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
