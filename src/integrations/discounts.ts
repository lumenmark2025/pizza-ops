import type { AppliedDiscountSummary, OrderItem, PricingSummary } from '../types/domain'

type ValidateDiscountCodeSuccess = {
  ok: true
  appliedOrderDiscount: AppliedDiscountSummary
  pricingSummary: PricingSummary
  message: string
}

type ValidateDiscountCodeFailure = {
  ok: false
  error: string
}

export type ValidateDiscountCodeResponse =
  | ValidateDiscountCodeSuccess
  | ValidateDiscountCodeFailure

export async function validatePublicDiscountCode(input: {
  code: string
  items: OrderItem[]
}): Promise<ValidateDiscountCodeResponse> {
  try {
    const response = await fetch('/api/validate-discount-code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })

    const contentType = response.headers.get('content-type') ?? ''
    const data = contentType.includes('application/json')
      ? ((await response.json()) as ValidateDiscountCodeResponse | { error?: string })
      : { error: 'Unable to validate this discount code right now.' }

    if (!response.ok) {
      return {
        ok: false,
        error:
          'error' in data && typeof data.error === 'string'
            ? data.error
            : 'Unable to validate this discount code right now.',
      }
    }

    if (!('ok' in data)) {
      return {
        ok: false,
        error: 'Unable to validate this discount code right now.',
      }
    }

    return data
  } catch {
    return {
      ok: false,
      error: 'Unable to validate this discount code right now. Please try again.',
    }
  }
}
