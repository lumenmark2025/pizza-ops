export type HostType = 'customer_domain' | 'operator_domain' | 'local_dev' | 'preview_or_unknown'
export type AppMode = 'customer' | 'operator' | 'mixed' | 'unknown'

export type DomainContext = {
  hostname: string | null
  hostType: HostType
  appMode: AppMode
  vendorSlug: string | null
  isLocalDev: boolean
  isPreview: boolean
  isCustomerDomain: boolean
  isOperatorDomain: boolean
}

const CUSTOMER_BASE_DOMAIN = 'hotslice.app'
const OPERATOR_BASE_DOMAIN = 'pizzaops.app'

function extractVendorSlug(hostname: string, baseDomain: string) {
  if (hostname === baseDomain) {
    return null
  }

  const suffix = `.${baseDomain}`
  if (!hostname.endsWith(suffix)) {
    return null
  }

  const value = hostname.slice(0, -suffix.length).trim().toLowerCase()
  return value || null
}

function isLocalHostname(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  )
}

function isPreviewHostname(hostname: string) {
  return hostname.endsWith('.vercel.app')
}

export function getDomainContext(hostnameInput?: string | null): DomainContext {
  const hostname =
    hostnameInput?.trim().toLowerCase() ??
    (typeof window !== 'undefined' ? window.location.hostname.trim().toLowerCase() : null)

  if (!hostname) {
    return {
      hostname: null,
      hostType: 'preview_or_unknown',
      appMode: 'unknown',
      vendorSlug: null,
      isLocalDev: false,
      isPreview: false,
      isCustomerDomain: false,
      isOperatorDomain: false,
    }
  }

  const isLocalDev = isLocalHostname(hostname)
  if (isLocalDev) {
    return {
      hostname,
      hostType: 'local_dev',
      appMode: 'mixed',
      vendorSlug: null,
      isLocalDev: true,
      isPreview: false,
      isCustomerDomain: false,
      isOperatorDomain: false,
    }
  }

  const customerVendorSlug = extractVendorSlug(hostname, CUSTOMER_BASE_DOMAIN)
  if (hostname === CUSTOMER_BASE_DOMAIN || customerVendorSlug) {
    return {
      hostname,
      hostType: 'customer_domain',
      appMode: 'customer',
      vendorSlug: customerVendorSlug,
      isLocalDev: false,
      isPreview: false,
      isCustomerDomain: true,
      isOperatorDomain: false,
    }
  }

  const operatorVendorSlug = extractVendorSlug(hostname, OPERATOR_BASE_DOMAIN)
  if (hostname === OPERATOR_BASE_DOMAIN || operatorVendorSlug) {
    return {
      hostname,
      hostType: 'operator_domain',
      appMode: 'operator',
      vendorSlug: operatorVendorSlug,
      isLocalDev: false,
      isPreview: false,
      isCustomerDomain: false,
      isOperatorDomain: true,
    }
  }

  return {
    hostname,
    hostType: 'preview_or_unknown',
    appMode: 'mixed',
    vendorSlug: null,
    isLocalDev: false,
    isPreview: isPreviewHostname(hostname),
    isCustomerDomain: false,
    isOperatorDomain: false,
  }
}
