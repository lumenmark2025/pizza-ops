const safeModeFlag = String(import.meta.env.VITE_SAFE_MODE ?? '').toLowerCase()

export const SAFE_MODE = ['true', '1', 'yes', 'on'].includes(safeModeFlag)
