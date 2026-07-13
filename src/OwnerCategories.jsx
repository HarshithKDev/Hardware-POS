import { useState, Fragment } from 'react';
import { supabase } from './supabaseClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from './AppContext';
import { STALE_TIME_5MIN } from './constants';

export default function OwnerCategories() {
  const { showAlert, showConfirm } = useApp();
  const queryClient = useQueryClient();

  const [newCategory, setNewCategory] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [newSubcategory, setNewSubcategory] = useState('');
  const [expandedCategoryId, setExpandedCategoryId] = useState(null);

  // Fetch Categories
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    staleTime: STALE_TIME_5MIN
  });

  // Fetch Subcategories
  const { data: subcategories = [] } = useQuery({
    queryKey: ['subcategories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subcategories').select('*').order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    staleTime: STALE_TIME_5MIN
  });

  const addCategoryMutation = useMutation({
    mutationFn: async (name) => {
      const { error } = await supabase.from('categories').insert([{ name }]);
      if (error) throw error;

      await supabase.from('audit_logs').insert([{
        action_type: 'CREATE',
        barcode: 'CATEGORY',
        item_name: name,
        changes: `Added Category: ${name}`,
        performed_by: 'Owner'
      }]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
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
      const { error } = await supabase.from('subcategories').insert([{ name, category_name }]);
      if (error) throw error;

      await supabase.from('audit_logs').insert([{
        action_type: 'CREATE',
        barcode: 'SUB-CATEGORY',
        item_name: name,
        changes: `Added Sub-category: ${name} (under ${category_name})`,
        performed_by: 'Owner'
      }]);

      return category_name;
    },
    onSuccess: (category_name) => {
      queryClient.invalidateQueries({ queryKey: ['subcategories'] });
      setNewSubcategory('');
      const parentCat = categories.find(c => c.name === category_name);
      if (parentCat) setExpandedCategoryId(parentCat.id);
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
    mutationFn: async ({ id, name }) => {
      // Cascade check (fixes #8)
      const { count } = await supabase.from('inventory').select('*', { count: 'exact', head: true }).eq('category', name).eq('is_active', true);
      if (count && count > 0) throw new Error(`Cannot delete category "${name}" because it is assigned to ${count} active item(s) in the inventory.`);

      const { error } = await supabase.from('categories').delete().eq('name', name);
      if (error) throw error;

      await supabase.from('audit_logs').insert([{
        action_type: 'DELETE',
        barcode: 'CATEGORY',
        item_name: name,
        changes: `Deleted Category: ${name}`,
        performed_by: 'Owner'
      }]);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['categories'] }),
    onError: (e) => showAlert(e.message, 'Cascade Delete Blocked')
  });

  const handleDeleteCategory = (id, name) => {
    showConfirm(`Delete category "${name}"?`, () => deleteCategoryMutation.mutate({ id, name }));
  };

  const deleteSubcategoryMutation = useMutation({
    mutationFn: async ({ id, name, category_name }) => {
      // Cascade check (fixes #8)
      const { count } = await supabase.from('inventory').select('*', { count: 'exact', head: true }).eq('sub_category', name).eq('is_active', true);
      if (count && count > 0) throw new Error(`Cannot delete sub-category "${name}" because it is assigned to ${count} active item(s) in the inventory.`);

      const query = supabase.from('subcategories').delete().eq('name', name);
      if (category_name) query.eq('category_name', category_name);

      const { error } = await query;
      if (error) throw error;

      await supabase.from('audit_logs').insert([{
        action_type: 'DELETE',
        barcode: 'SUB-CATEGORY',
        item_name: name,
        changes: `Deleted Sub-category: ${name} (from ${category_name || 'unknown'})`,
        performed_by: 'Owner'
      }]);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subcategories'] }),
    onError: (e) => showAlert(e.message, 'Cascade Delete Blocked')
  });

  const handleDeleteSubcategory = (id, name, category_name) => {
    showConfirm(`Delete sub-category "${name}"?`, () => deleteSubcategoryMutation.mutate({ id, name, category_name }));
  };

  const toggleCategory = (id) => {
    setExpandedCategoryId(expandedCategoryId === id ? null : id);
  };

  return (
    <div className="flex flex-col h-full gap-6 animate-fade-in w-full">
      <h1 className="text-2xl font-medium" style={{ color: 'var(--text-primary)' }}>Manage Categories & Sub-categories</h1>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="p-6 flex-1 shadow-sm rounded-lg border border-[var(--border-light)]" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>Add Category</h2>
          <form onSubmit={handleAddCategory} className="flex gap-2">
            <label htmlFor="new-cat" className="sr-only">Category Name</label>
            <input id="new-cat" type="text" placeholder="Category Name" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="flex-1 h-10 px-3 text-sm focus:outline-none rounded-md" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
            <button type="submit" disabled={addCategoryMutation.isPending} className="h-10 px-6 text-white text-sm font-semibold focus:outline-none" style={{ backgroundColor: 'var(--color-accent)' }}>Save</button>
          </form>
        </div>

        <div className="p-6 flex-1 shadow-sm rounded-lg border border-[var(--border-light)]" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>Add Sub-category</h2>
          <form onSubmit={handleAddSubcategory} className="flex flex-col gap-2">
            <label htmlFor="parent-cat" className="sr-only">Parent Category</label>
            <div className="relative">
              <select id="parent-cat" value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="w-full h-10 pl-3 pr-8 text-sm focus:outline-none appearance-none cursor-pointer rounded-md" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }}>
                <option value="">-- Select Parent Category --</option>
                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3" style={{ color: 'var(--text-tertiary)' }}><svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg></div>
            </div>
            <div className="flex gap-2">
              <label htmlFor="new-subcat" className="sr-only">Sub-category Name</label>
              <input id="new-subcat" type="text" placeholder="Sub-category Name" value={newSubcategory} onChange={(e) => setNewSubcategory(e.target.value)} className="flex-1 h-10 px-3 text-sm focus:outline-none rounded-md" style={{ border: '1px solid var(--border-input)', backgroundColor: 'var(--bg-input)', color: 'var(--text-input)' }} />
              <button type="submit" disabled={addSubcategoryMutation.isPending} className="h-10 px-6 text-white text-sm font-semibold focus:outline-none" style={{ backgroundColor: 'var(--color-accent)' }}>Save</button>
            </div>
          </form>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-hidden shadow-sm rounded-lg border border-[var(--border-light)]" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <div className="overflow-x-auto w-full">
          <table className={`w-full text-left border-collapse ${categories.length === 0 ? 'h-full' : ''}`}>
            <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-medium)' }}>
              <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                <th className="p-4" style={{ borderRight: '1px solid var(--border-light)' }}>Category Name</th>
                <th className="p-4 w-32 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Actions</th>
                <th className="p-4 text-center w-16">Details</th>
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 ? (
                <tr><td colSpan="3" className="h-[50vh] align-middle text-center text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>No categories found.</td></tr>
              ) : categories.map(cat => {
                const isExpanded = expandedCategoryId === cat.id;
                const catSubcategories = subcategories.filter(sub => sub.category_name === cat.name);

                return (
                  <Fragment key={cat.id}>
                    <tr
                      onClick={() => toggleCategory(cat.id)}
                      className="cursor-pointer group transition-colors"
                      style={{ backgroundColor: isExpanded ? 'var(--color-accent-bg)' : 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)' }}
                    >
                      <td className="p-4 text-sm" style={{ borderRight: '1px solid var(--border-light)' }}>
                        <div className="flex items-center justify-start w-full text-left">
                          <span className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>{cat.name}</span>
                          <span className="ml-2 text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>({catSubcategories.length} sub-categories)</span>
                        </div>
                      </td>
                      <td className="p-2 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat.id, cat.name); }}
                          className="h-8 px-4 text-xs font-semibold uppercase tracking-wider focus:outline-none transition-colors"
                          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--color-error)', border: '1px solid var(--color-error)' }}
                          onMouseEnter={(e) => {
                            e.target.style.backgroundColor = 'var(--color-error)';
                            e.target.style.color = '#ffffff';
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.backgroundColor = 'var(--bg-secondary)';
                            e.target.style.color = 'var(--color-error)';
                          }}
                          aria-label={`Delete category ${cat.name}`}
                        >
                          Remove
                        </button>
                      </td>
                      <td className="p-4 text-center flex justify-center items-center h-full">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : 'rotate-0'}`} style={{ color: isExpanded ? 'var(--color-accent)' : 'var(--text-secondary)' }}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                        <td colSpan="3" className="p-0" style={{ borderBottom: '2px solid var(--color-accent)' }}>
                          <div className="p-6 px-8 text-left w-full shadow-inner">
                            <p className="text-xs font-bold uppercase tracking-widest mb-3 pb-2 text-left" style={{ color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-light)' }}>
                              Sub-categories for {cat.name}
                            </p>
                            {catSubcategories.length === 0 ? (
                              <p className="text-sm italic text-left" style={{ color: 'var(--text-tertiary)' }}>No sub-categories added yet.</p>
                            ) : (
                              <div className="flex flex-col gap-2 mt-4 max-w-md w-full">
                                {catSubcategories.map(sub => (
                                  <div key={sub.id} className="group flex items-center justify-between px-4 py-3 rounded-sm transition-colors" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-medium)' }}>
                                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                      {sub.name}
                                    </span>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleDeleteSubcategory(sub.id, sub.name, sub.category_name); }}
                                      className="p-1.5 rounded-sm transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                                      style={{ color: 'var(--text-tertiary)' }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                                        e.currentTarget.style.color = 'var(--color-error)';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                        e.currentTarget.style.color = 'var(--text-tertiary)';
                                      }}
                                      aria-label={`Delete subcategory ${sub.name}`}
                                      title={`Delete ${sub.name}`}
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                      </svg>
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}