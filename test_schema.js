import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

async function fetchSchema() {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/?apikey=${supabaseKey}`);
    const spec = await res.json();
    console.log(Object.keys(spec));
    if (spec.components && spec.components.schemas) {
        for (const [key, value] of Object.entries(spec.components.schemas)) {
            console.log(`\nTable: ${key}`);
            if (value.properties) {
                console.log(Object.keys(value.properties).join(', '));
            }
        }
    }
  } catch (err) {
    console.error(err);
  }
}
fetchSchema();
