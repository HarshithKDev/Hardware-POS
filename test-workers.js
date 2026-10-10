require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
async function run() {
  const { data: shops } = await supabase.from('shop_settings').select('id');
  if (shops && shops.length > 0) {
    const shopId = shops[0].id;
    const { data: workers, error } = await supabase.from('workers').select('*').eq('shop_id', shopId);
    console.log('Workers for shop:', workers?.length, error);
  } else {
    console.log('No shops found');
  }
}
run();
