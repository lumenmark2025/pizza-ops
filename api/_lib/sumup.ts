const SUMUP_API_URL = process.env.SUMUP_API_URL || 'https://api.sumup.com'

export function getSumUpConfig() {
  const apiKey = process.env.SUMUP_API_KEY
  const merchantCode = process.env.SUMUP_MERCHANT_CODE
  const affiliateKey = process.env.SUMUP_AFFILIATE_KEY
  const affiliateAppId = process.env.SUMUP_AFFILIATE_APP_ID || process.env.SUMUP_APP_ID
  const terminalId =
    process.env.SUMUP_SOLO_TERMINAL_ID ||
    process.env.SUMUP_SOLO_READER_ID ||
    process.env.SUMUP_TERMINAL_ID
  const webhookBaseUrl =
    process.env.APP_BASE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL

  return {
    apiKey,
    merchantCode,
    affiliateKey,
    affiliateAppId,
    terminalId,
    apiUrl: SUMUP_API_URL,
    webhookBaseUrl: webhookBaseUrl
      ? webhookBaseUrl.startsWith('http')
        ? webhookBaseUrl
        : `https://${webhookBaseUrl}`
      : null,
  }
}

export async function sumupRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { apiKey, apiUrl } = getSumUpConfig()

  if (!apiKey) {
    throw new Error('Missing SUMUP_API_KEY.')
  }

  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const data = (await response.json().catch(() => null)) as T | { detail?: string; message?: string } | null
  console.info('sumupRequest response', {
    path,
    method: init?.method ?? 'GET',
    status: response.status,
  })

  if (!response.ok) {
    console.error('sumupRequest error body', {
      path,
      method: init?.method ?? 'GET',
      status: response.status,
      body: data,
    })
    const detail =
      data && typeof data === 'object'
        ? ('detail' in data && typeof data.detail === 'string'
            ? data.detail
            : 'message' in data && typeof data.message === 'string'
              ? data.message
              : null)
        : null

    throw new Error(
      detail ??
        (data ? `SumUp request failed with status ${response.status}: ${JSON.stringify(data)}` : `SumUp request failed with status ${response.status}.`),
    )
  }

  return data as T
}
