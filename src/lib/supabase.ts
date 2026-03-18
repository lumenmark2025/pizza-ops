import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const syncFlag = String(import.meta.env.VITE_ENABLE_SUPABASE_SYNC ?? '').toLowerCase()

export const supabaseEnabled = ['true', '1', 'yes', 'on'].includes(syncFlag)

const missingBrowserEnvVars = [
  !supabaseUrl ? 'VITE_SUPABASE_URL' : null,
  !supabaseAnonKey ? 'VITE_SUPABASE_ANON_KEY' : null,
].filter(Boolean) as string[]

export const supabaseConfigError =
  missingBrowserEnvVars.length > 0
    ? `Missing browser Supabase config: ${missingBrowserEnvVars.join(', ')}.`
    : null

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null

export function getSupabaseClientError(operation: string) {
  if (supabaseConfigError) {
    return `${operation} unavailable. ${supabaseConfigError}`
  }

  return `${operation} unavailable. Supabase client disabled by config gate.`
}
