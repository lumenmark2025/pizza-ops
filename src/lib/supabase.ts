import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const syncFlag = String(import.meta.env.VITE_ENABLE_SUPABASE_SYNC ?? '').toLowerCase()

export const supabaseEnabled = ['true', '1', 'yes', 'on'].includes(syncFlag)

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null
