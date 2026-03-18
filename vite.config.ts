import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function readEnvLocalFile() {
  const envLocalPath = resolve(process.cwd(), 'env.local')
  if (!existsSync(envLocalPath)) {
    return {}
  }

  const parsed: Record<string, string> = {}
  const contents = readFileSync(envLocalPath, 'utf8')

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    parsed[key] = value
  }

  return parsed
}

export default defineConfig(({ mode }) => {
  const viteEnv = loadEnv(mode, process.cwd(), '')
  const envLocal = readEnvLocalFile()

  const resolvedSupabaseUrl =
    viteEnv.VITE_SUPABASE_URL ||
    viteEnv.SUPABASE_URL ||
    envLocal.VITE_SUPABASE_URL ||
    envLocal.SUPABASE_URL ||
    ''

  const resolvedSupabaseAnonKey =
    viteEnv.VITE_SUPABASE_ANON_KEY ||
    viteEnv.SUPABASE_ANON_KEY ||
    envLocal.VITE_SUPABASE_ANON_KEY ||
    envLocal.SUPABASE_ANON_KEY ||
    ''

  const resolvedSyncFlag =
    viteEnv.VITE_ENABLE_SUPABASE_SYNC ||
    envLocal.VITE_ENABLE_SUPABASE_SYNC ||
    ''

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(resolvedSupabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(resolvedSupabaseAnonKey),
      'import.meta.env.VITE_ENABLE_SUPABASE_SYNC': JSON.stringify(resolvedSyncFlag),
    },
  }
})
