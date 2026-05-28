import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...val] = line.split('=');
  if (key) acc[key] = val.join('=');
  return acc;
}, {});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
async function run() {
  const { data: cats } = await supabase.from('categories').select('*').limit(1);
  const { data: subs } = await supabase.from('subcategories').select('*').limit(1);
  console.log('Categories:', cats);
  console.log('Subcategories:', subs);
}
run();
