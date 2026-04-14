import { createClient } from '@supabase/supabase-js'

// Pulls variables from the hidden .env file
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase environment variables. Please check your .env file.");
}

// This creates the active connection tunnel to your live database
export const supabase = createClient(supabaseUrl, supabaseKey)