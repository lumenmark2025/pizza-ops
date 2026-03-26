export type HostedCheckoutResponse = {
  checkoutId: string
  hostedCheckoutUrl: string
  status: string
}

export type TerminalCheckoutResponse = {
  checkoutId: string
  paymentStatus: 'pending'
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

  if (!('checkoutId' in data) || !data.checkoutId) {
    throw new Error('Terminal payment response was missing checkout details.')
  }

  return data
}
