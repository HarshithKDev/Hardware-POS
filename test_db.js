import { supabase } from './src/supabaseClient.js';
const check = async () => {
  const { data, error } = await supabase.from('inventory').select('*').limit(1);
  console.log(Object.keys(data[0] || {}));
};
check();
