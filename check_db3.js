import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const res1 = await supabase.from('bills').insert([{ id: 'test' }]);
  console.log("Insert bills.id='test':", res1.error?.message);
  
  const res2 = await supabase.from('inventory_batches').insert([{ batch_id: 'test', barcode: 'test' }]);
  console.log("Insert batches.batch_id='test':", res2.error?.message);

  const res3 = await supabase.from('bill_items').insert([{ id: 'test' }]);
  console.log("Insert bill_items.id='test':", res3.error?.message);

  const res4 = await supabase.from('stock_instances').insert([{ id: 'test' }]);
  console.log("Insert stock_instances.id='test':", res4.error?.message);
}
check();
