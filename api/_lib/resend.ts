import { Resend } from 'resend'

export const DEFAULT_SENDER = 'North West Pizza <orders@pizza.northwestpizza.co.uk>'

export function getResendClient() {
  const resendApiKey = process.env.RESEND_API_KEY
  if (!resendApiKey) {
    throw new Error('Missing RESEND_API_KEY')
  }

  return new Resend(resendApiKey)
}

export function getSenderAddress() {
  return process.env.RESEND_FROM_EMAIL || DEFAULT_SENDER
}
