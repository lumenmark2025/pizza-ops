const sumupCheckoutUrl = import.meta.env.VITE_SUMUP_CHECKOUT_URL
const sumupMerchantCode = import.meta.env.VITE_SUMUP_MERCHANT_CODE

export function createSumUpCheckoutLink(paymentId: string, amount: number) {
  if (sumupCheckoutUrl && sumupMerchantCode) {
    const search = new URLSearchParams({
      checkout_reference: paymentId,
      amount: amount.toFixed(2),
      merchant_code: sumupMerchantCode,
    })

    return `${sumupCheckoutUrl}?${search.toString()}`
  }

  return `/payments/${paymentId}`
}
