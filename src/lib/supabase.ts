import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseEnabled =
  Boolean(supabaseUrl) &&
  Boolean(supabaseAnonKey) &&
  import.meta.env.VITE_ENABLE_SUPABASE_SYNC === 'true'

export const supabase =
  supabaseEnabled && supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null
