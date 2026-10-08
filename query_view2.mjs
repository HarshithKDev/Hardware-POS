import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabase.from('product_master_public').select('*').limit(1);
  if (error) console.error(error);
  else console.log(JSON.stringify(data[0], null, 2));
}
run();
