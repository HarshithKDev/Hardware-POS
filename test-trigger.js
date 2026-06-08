const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTriggers() {
  const { data, error } = await supabase.rpc('get_triggers'); // won't work if no rpc
  console.log(data, error);
}

checkTriggers();
