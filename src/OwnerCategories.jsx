import { useState, useEffect, Fragment } from 'react';
import { supabase } from './supabaseClient';

export default function OwnerCategories({ showAlert, showConfirm }) {
  const [categories, setCategories] = useState([]);
  const [subcategories, setSubcategories] = useState([]);
  
  const [newCategory, setNewCategory] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [newSubcategory, setNewSubcategory] = useState('');
  
  // State to track which category row is expanded
  const [expandedCategoryId, setExpandedCategoryId] = useState(null);

  const loadData = async () => {
    const { data: catData } = await supabase.from('categories').select('*').order('name', { ascending: true });
    const { data: subData } = await supabase.from('subcategories').select('*').order('name', { ascending: true });
    
    if (catData) setCategories(catData);
    if (subData) setSubcategories(subData);
  };

  useEffect(() => { loadData(); }, []);

  const handleAddCategory = async (e) => {
    e.preventDefault();
    if (!newCategory.trim()) return showAlert('Category name cannot be empty.', 'Warning');
    try {
      const { error } = await supabase.from('categories').insert([{ name: newCategory.trim() }]);
      if (error) throw error;
      setNewCategory('');
      
      // Wait for the fresh data to load before showing success
      await loadData(); 
      showAlert('Category added successfully.', 'Success');
    } catch (e) {
      if (e.code === '23505') showAlert('This category already exists.', 'Error');
      else showAlert(e.message, 'System Error');
    }
  };

  const handleAddSubcategory = async (e) => {
    e.preventDefault();
    if (!selectedCategory) return showAlert('Please select a parent category first.', 'Warning');
    if (!newSubcategory.trim()) return showAlert('Sub-category name cannot be empty.', 'Warning');
    
    try {
      const { error } = await supabase.from('subcategories').insert([{ 
        name: newSubcategory.trim(), 
        category_name: selectedCategory 
      }]);
      if (error) throw error;
      
      // Auto-expand the category where the new subcategory was added
      const parentCat = categories.find(c => c.name === selectedCategory);
      if (parentCat) setExpandedCategoryId(parentCat.id);

      setNewSubcategory('');
      
      // Wait for the fresh data to load before showing success
      await loadData(); 
      showAlert('Sub-category added successfully.', 'Success');
    } catch (e) {
      showAlert(e.message, 'System Error');
    }
  };

  const handleDeleteCategory = (id, name) => {
    showConfirm(`Delete category "${name}"?`, async () => {
      const { error } = await supabase.from('categories').delete().eq('id', id);
      if (error) showAlert('Failed to delete category.', 'Error');
      else loadData();
    });
  };

  const handleDeleteSubcategory = (id, name) => {
    showConfirm(`Delete sub-category "${name}"?`, async () => {
      const { error } = await supabase.from('subcategories').delete().eq('id', id);
      if (error) showAlert('Failed to delete sub-category.', 'Error');
      else loadData();
    });
  };

  const toggleCategory = (id) => {
    if (expandedCategoryId === id) {
      setExpandedCategoryId(null);
    } else {
      setExpandedCategoryId(id);
    }
  };

  return (
    <div className="flex flex-col h-full gap-6">
      <h1 className="text-2xl font-light text-black">Manage Categories & Sub-categories</h1>
      
      <div className="flex flex-col md:flex-row gap-6">
        <div className="bg-[#f3f3f3] border border-gray-400 p-4 rounded-none shadow-sm flex-1">
          <h2 className="text-sm font-semibold uppercase text-gray-700 tracking-wider mb-4">Add Category</h2>
          <form onSubmit={handleAddCategory} className="flex gap-2">
            <input type="text" placeholder="Category Name" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="flex-1 h-9 border-2 border-gray-300 px-3 text-sm focus:outline-none focus:border-[#0078D7]" />
            <button type="submit" className="h-9 px-6 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm font-semibold border border-transparent focus:outline-none rounded-none">Save</button>
          </form>
        </div>

        <div className="bg-[#f3f3f3] border border-gray-400 p-4 rounded-none shadow-sm flex-1">
          <h2 className="text-sm font-semibold uppercase text-gray-700 tracking-wider mb-4">Add Sub-category</h2>
          <form onSubmit={handleAddSubcategory} className="flex flex-col gap-2">
            <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="h-9 border-2 border-gray-300 bg-white px-3 text-sm focus:outline-none focus:border-[#0078D7]">
              <option value="">-- Select Parent Category --</option>
              {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <div className="flex gap-2">
              <input type="text" placeholder="Sub-category Name" value={newSubcategory} onChange={(e) => setNewSubcategory(e.target.value)} className="flex-1 h-9 border-2 border-gray-300 px-3 text-sm focus:outline-none focus:border-[#0078D7]" />
              <button type="submit" className="h-9 px-6 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm font-semibold border border-transparent focus:outline-none rounded-none">Save</button>
            </div>
          </form>
        </div>
      </div>

      <div className="border border-gray-400 bg-white flex-1 overflow-y-auto rounded-none shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead className="bg-[#f9f9f9] sticky top-0 border-b border-gray-400">
            <tr className="text-xs font-semibold uppercase tracking-wider text-gray-600">
              <th className="p-3 border-r border-gray-200">Category Name</th>
              <th className="p-3 border-r border-gray-200 w-32 text-center">Actions</th>
              <th className="p-3 text-center w-16">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 border-b border-gray-200">
            {categories.length === 0 ? (
              <tr><td colSpan="3" className="p-8 text-center text-gray-500 text-sm font-semibold">No categories found.</td></tr>
            ) : categories.map(cat => {
              const isExpanded = expandedCategoryId === cat.id;
              const catSubcategories = subcategories.filter(sub => sub.category_name === cat.name);

              return (
                <Fragment key={cat.id}>
                  <tr 
                    onClick={() => toggleCategory(cat.id)} 
                    className={`cursor-pointer transition-none group ${isExpanded ? 'bg-[#cce8ff]' : 'hover:bg-[#e6e6e6] bg-white'}`}
                  >
                    <td className="p-3 border-r border-gray-200 text-sm text-black">
                      <span className="font-bold text-base">{cat.name}</span>
                      <span className="ml-2 text-gray-500 text-xs">({catSubcategories.length} sub-categories)</span>
                    </td>
                    <td className="p-2 border-r border-gray-200 text-center align-middle">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat.id, cat.name); }} 
                        className="h-8 bg-white border border-[#e81123] text-[#e81123] hover:bg-[#e81123] hover:text-white px-3 text-xs font-semibold rounded-none focus:outline-none"
                      >
                        Remove
                      </button>
                    </td>
                    <td className="p-3 text-center flex justify-center items-center h-full">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={`w-5 h-5 text-gray-600 group-hover:text-[#0078D7] transition-transform duration-200 ${isExpanded ? 'rotate-180 text-[#0078D7]' : 'rotate-0'}`}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </td>
                  </tr>
                  
                  {isExpanded && (
                    <tr className="bg-[#f3f3f3] shadow-[inset_0_4px_6px_-4px_rgba(0,0,0,0.1)]">
                      <td colSpan="3" className="p-0 border-b-2 border-[#0078D7]">
                        <div className="p-6 px-8">
                          <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 border-b border-gray-300 pb-2">Sub-categories for {cat.name}</p>
                          {catSubcategories.length === 0 ? (
                            <p className="text-sm text-gray-500 italic">No sub-categories added yet.</p>
                          ) : (
                            <div className="flex flex-wrap gap-3 mt-2">
                              {catSubcategories.map(sub => (
                                <span key={sub.id} className="bg-white text-sm px-3 py-1.5 flex items-center gap-2 border border-gray-300 text-gray-700 shadow-sm font-medium">
                                  {sub.name}
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleDeleteSubcategory(sub.id, sub.name); }} 
                                    className="text-[#e81123] hover:bg-[#e81123] hover:text-white px-1.5 py-0.5 rounded-sm font-bold transition-colors"
                                  >
                                    ✕
                                  </button>
                                </span>
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
  );
}