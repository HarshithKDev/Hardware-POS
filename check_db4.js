import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.from('stock_instances').select('*').limit(1);
  console.log("stock_instances columns:", data && data.length > 0 ? Object.keys(data[0]) : "no data");
  
  if (data && data.length === 0) {
    // try to insert an empty row to get error detailing columns
    const res = await supabase.from('stock_instances').insert([{}]);
    console.log("Insert error:", res.error?.message, res.error?.details, res.error?.hint);
  }
}
check();
