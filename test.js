import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nxwevtgekjsakjqbbkcr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54d2V2dGdla2pzYWtqcWJia2NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMjU2NDksImV4cCI6MjA4ODkwMTY0OX0.FtCOQIv4F4_PRk6o0ypSLEVtdKGG1fBi64aaDT6nRog';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.from('inventory').select('*').eq('barcode', '1012').single();
  console.log(data);
}

check();
