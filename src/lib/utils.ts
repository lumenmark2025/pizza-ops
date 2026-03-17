import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function currency(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(value)
}

export function titleCase(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

export function isValidEmail(value: string) {
  if (!value.trim()) {
    return false
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}
