import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
async function run() {
  await supabase.from('audit_logs').delete().eq('barcode', '1012').eq('action_type', 'CREATE');
}
run();
