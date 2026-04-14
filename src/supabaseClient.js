import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase environment variables. Please check your .env file.");
}

// Primary connection tunnel
export const supabase = createClient(supabaseUrl, supabaseKey)

// Secondary client specifically for the owner to provision workers without logging out
export const provisioningClient = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});