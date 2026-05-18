import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

export default function OwnerCategories({ showAlert, showConfirm }) {
  const [categories, setCategories] = useState([]);
  const [newCategory, setNewCategory] = useState('');

  const loadCategories = async () => {
    const { data, error } = await supabase.from('categories').select('*').order('name', { ascending: true });
    if (!error && data) setCategories(data);
  };

  useEffect(() => { loadCategories(); }, []);

  const handleAddCategory = async (e) => {
    e.preventDefault();
    if (!newCategory.trim()) return showAlert('Category name cannot be empty.', 'Warning');
    
    try {
      const { error } = await supabase.from('categories').insert([{ name: newCategory.trim() }]);
      if (error) throw error;
      setNewCategory('');
      loadCategories();
      showAlert('Category added successfully.', 'Success');
    } catch (e) {
      if (e.code === '23505') showAlert('This category already exists.', 'Error');
      else showAlert(e.message, 'System Error');
    }
  };

  const handleDelete = (id, name) => {
    showConfirm(`Are you sure you want to delete the category "${name}"?`, async () => {
      const { error } = await supabase.from('categories').delete().eq('id', id);
      if (error) showAlert('Failed to delete category.', 'Error');
      else loadCategories();
    });
  };

  return (
    <div className="flex flex-col h-full">
      <h1 className="text-2xl font-light text-black mb-6">Manage Categories</h1>
      
      <div className="bg-[#f3f3f3] border border-gray-400 p-4 mb-6 rounded-none shadow-sm w-full md:w-1/2">
        <h2 className="text-sm font-semibold uppercase text-gray-700 tracking-wider mb-4">Add New Category</h2>
        <form onSubmit={handleAddCategory} className="flex gap-2">
          <input 
            type="text" 
            placeholder="Category Name" 
            value={newCategory} 
            onChange={(e) => setNewCategory(e.target.value)} 
            className="flex-1 h-9 border-2 border-gray-300 bg-white px-3 text-sm rounded-none focus:outline-none focus:border-[#0078D7]" 
          />
          <button type="submit" className="h-9 px-6 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm font-semibold border border-transparent focus:outline-none focus:ring-1 focus:ring-black rounded-none">
            Save
          </button>
        </form>
      </div>

      <div className="border border-gray-400 bg-white flex-1 overflow-y-auto rounded-none shadow-sm w-full md:w-1/2">
        <table className="w-full text-left border-collapse">
          <thead className="bg-[#f9f9f9] sticky top-0 border-b border-gray-400">
            <tr className="text-xs font-semibold uppercase tracking-wider text-gray-600">
              <th className="p-3 border-r border-gray-200">Category Name</th>
              <th className="p-3 w-24 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {categories.length === 0 ? (
              <tr><td colSpan="2" className="p-8 text-center text-gray-500 text-sm font-semibold">No categories found.</td></tr>
            ) : categories.map(cat => (
              <tr key={cat.id} className="hover:bg-[#f3f3f3] transition-none">
                <td className="p-3 border-r border-gray-200 text-sm text-black font-medium">{cat.name}</td>
                <td className="p-2 text-center">
                  <button onClick={() => handleDelete(cat.id, cat.name)} className="h-8 bg-white border border-[#e81123] text-[#e81123] hover:bg-[#e81123] hover:text-white px-3 text-xs font-semibold rounded-none focus:outline-none">
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}