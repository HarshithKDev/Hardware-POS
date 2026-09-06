import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data: bills, error: e1 } = await supabase.from('bills').select('*').limit(1);
  console.log("bills:", bills, e1);
  
  const { data: batches, error: e2 } = await supabase.from('inventory_batches').select('*').limit(1);
  console.log("batches:", batches, e2);

  const { data: bitems, error: e3 } = await supabase.from('bill_items').select('*').limit(1);
  console.log("bill_items:", bitems, e3);
  
  const { data: si, error: e4 } = await supabase.from('stock_instances').select('*').limit(1);
  console.log("stock_instances:", si, e4);
}
check();
