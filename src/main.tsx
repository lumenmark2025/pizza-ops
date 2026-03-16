import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { SAFE_MODE } from './lib/runtime-flags'

const SW_KILL_SWITCH_KEY = 'pizza_ops_sw_reset_v1'

async function runTemporaryServiceWorkerKillSwitch() {
  if (!('serviceWorker' in navigator) || localStorage.getItem(SW_KILL_SWITCH_KEY) === 'done') {
    return
  }

  console.info('[pizza-ops] running temporary service worker recovery')

  const registrations = await navigator.serviceWorker.getRegistrations()
  await Promise.all(registrations.map((registration) => registration.unregister()))

  if ('caches' in window) {
    const cacheKeys = await caches.keys()
    await Promise.all(
      cacheKeys
        .filter((key) => key.startsWith('pizza-ops-shell'))
        .map((key) => caches.delete(key)),
    )
  }

  localStorage.setItem(SW_KILL_SWITCH_KEY, 'done')
}

async function boot() {
  await runTemporaryServiceWorkerKillSwitch()

  if (!SAFE_MODE && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js')
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
}

void boot()
