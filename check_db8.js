import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.from('stock_instances').insert([{ 
    instance_barcode: 'TEST1234', 
    parent_barcode: '1008', // existing steel pipe barcode
    original_length: 10,
    current_length: 10,
    original_width: 5,
    current_width: 5
  }]).select();
  console.log("Insert result with width:", data, error);
}
check();
