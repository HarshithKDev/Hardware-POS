import { createClient } from '@supabase/supabase-js'

// Replace these with the actual values from your Supabase API settings
const supabaseUrl = 'https://nxwevtgekjsakjqbbkcr.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54d2V2dGdla2pzYWtqcWJia2NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMjU2NDksImV4cCI6MjA4ODkwMTY0OX0.FtCOQIv4F4_PRk6o0ypSLEVtdKGG1fBi64aaDT6nRog'

// This creates the active connection tunnel to your live database
export const supabase = createClient(supabaseUrl, supabaseKey)