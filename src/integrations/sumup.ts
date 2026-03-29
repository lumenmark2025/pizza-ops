export type HostedCheckoutResponse = {
  checkoutId: string
  hostedCheckoutUrl: string
  status: string
}

export type TerminalCheckoutResponse = {
  clientTransactionId: string
  paymentStatus: 'pending'
}

export type TerminalCheckoutStatusResponse = {
  clientTransactionId: string
  providerStatus: string | null
  paymentStatus: 'pending' | 'paid' | 'failed'
  finalized: boolean
  transactionId: string | null
}

export async function createHostedSumUpCheckout(input: {
  orderId: string
  amount: number
  description: string
}) {
  const response = await fetch('/api/create-sumup-checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  const data = (await response.json()) as
    | HostedCheckoutResponse
    | { error?: string; details?: unknown }

  if (!response.ok) {
    const message =
      'error' in data && typeof data.error === 'string'
        ? data.error
        : 'Unable to start SumUp checkout.'
    throw new Error(message)
  }

  if (
    !('checkoutId' in data) ||
    !data.checkoutId ||
    !('hostedCheckoutUrl' in data) ||
    !data.hostedCheckoutUrl
  ) {
    throw new Error('SumUp checkout response was missing hosted checkout details.')
  }

  return data
}

export async function createTerminalSumUpCheckout(input: {
  orderId: string
}) {
  const response = await fetch('/api/create-sumup-terminal-checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  const data = (await response.json()) as
    | TerminalCheckoutResponse
    | { error?: string; details?: unknown }

  if (!response.ok) {
    const message =
      'error' in data && typeof data.error === 'string'
        ? data.error
        : 'Unable to start terminal payment.'
    throw new Error(message)
  }

  if (!('clientTransactionId' in data) || !data.clientTransactionId) {
    throw new Error('Terminal payment response was missing transaction details.')
  }

  return data
}

export async function getTerminalSumUpCheckoutStatus(input: {
  orderId: string
  clientTransactionId: string
}) {
  const response = await fetch('/api/payments/sumup-terminal-status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  const data = (await response.json()) as
    | TerminalCheckoutStatusResponse
    | { error?: string; details?: unknown }

  if (!response.ok) {
    const message =
      'error' in data && typeof data.error === 'string'
        ? data.error
        : 'Unable to check terminal payment status.'
    throw new Error(message)
  }

  if (!('clientTransactionId' in data) || !data.clientTransactionId) {
    throw new Error('Terminal payment status response was missing transaction details.')
  }

  return data
}

export async function pollTerminalSumUpCheckoutStatus(input: {
  orderId: string
  clientTransactionId: string
  intervalMs?: number
  maxAttempts?: number
  onUpdate?: (status: TerminalCheckoutStatusResponse) => void
}) {
  const intervalMs = input.intervalMs ?? 2500
  const maxAttempts = input.maxAttempts ?? 240

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs))
    const status = await getTerminalSumUpCheckoutStatus({
      orderId: input.orderId,
      clientTransactionId: input.clientTransactionId,
    })
    input.onUpdate?.(status)
    if (status.finalized) {
      return status
    }
  }

  return {
    clientTransactionId: input.clientTransactionId,
    providerStatus: null,
    paymentStatus: 'pending' as const,
    finalized: false,
    transactionId: null,
  }
}
