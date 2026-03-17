import { useMemo, useState } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import {
  getDiscountCodeUsesRemaining,
  normalizeDiscountCodeInput,
} from '../lib/discounts'
import { MENU_CATEGORY_OPTIONS } from '../lib/menu'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { DiscountCode } from '../types/domain'

function toDateTimeLocal(value?: string | null) {
  if (!value) {
    return ''
  }

  return value.slice(0, 16)
}

function fromDateTimeLocal(value: string) {
  return value ? new Date(value).toISOString() : null
}

function emptyDiscountCode(): DiscountCode {
  const now = new Date().toISOString()
  return {
    id: '',
    code: '',
    isActive: true,
    discountType: 'percentage',
    discountValue: 10,
    scope: 'order',
    usageMode: 'single_use',
    maxUses: 1,
    usedCount: 0,
    validFrom: null,
    validUntil: null,
    minimumOrderValue: null,
    appliesToMenuItemId: null,
    appliesToCategorySlug: null,
    notes: '',
    createdAt: now,
    updatedAt: now,
  }
}

export function DiscountCodesAdminPage() {
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const discountCodes = usePizzaOpsStore((state) => state.discountCodes)
  const upsertDiscountCode = usePizzaOpsStore((state) => state.upsertDiscountCode)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<DiscountCode>(emptyDiscountCode())

  const filteredCodes = useMemo(() => {
    const normalizedQuery = normalizeDiscountCodeInput(query)
    return [...discountCodes]
      .sort((left, right) => left.code.localeCompare(right.code))
      .filter((entry) => {
        if (!normalizedQuery) {
          return true
        }

        return normalizeDiscountCodeInput(entry.code).includes(normalizedQuery)
      })
  }, [discountCodes, query])

  function loadCode(code: DiscountCode) {
    setDraft(code)
  }

  function saveCode() {
    const now = new Date().toISOString()
    const normalizedCode = draft.code.trim()
    if (!normalizedCode) {
      return
    }

    const next: DiscountCode = {
      ...draft,
      id: draft.id || `disc_${normalizeDiscountCodeInput(normalizedCode).toLowerCase()}`,
      code: normalizedCode,
      maxUses:
        draft.usageMode === 'unlimited'
          ? null
          : draft.usageMode === 'single_use'
            ? 1
            : Math.max(1, Number(draft.maxUses ?? 1)),
      validFrom: draft.validFrom ?? null,
      validUntil: draft.validUntil ?? null,
      minimumOrderValue:
        draft.minimumOrderValue === null || draft.minimumOrderValue === undefined || Number.isNaN(draft.minimumOrderValue)
          ? null
          : Math.max(0, Number(draft.minimumOrderValue)),
      discountValue: Math.max(0, Number(draft.discountValue)),
      notes: draft.notes?.trim() || null,
      updatedAt: now,
      createdAt: draft.createdAt || now,
    }

    upsertDiscountCode(next, 'manager')
    setDraft(next)
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="grid gap-4">
        <Card className="p-5 sm:p-6">
          <h2 className="font-display text-3xl font-bold">Discount codes and gift vouchers</h2>
          <p className="mt-2 text-sm text-slate-500">
            Manage reusable promo codes, charity vouchers, and one-off redemption codes from one list.
          </p>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-2xl font-bold">Existing codes</h3>
            <Button variant="secondary" onClick={() => setDraft(emptyDiscountCode())}>New code</Button>
          </div>
          <div className="mt-4">
            <Input placeholder="Search code" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="mt-4 space-y-3">
            {filteredCodes.map((code) => (
              <button
                key={code.id}
                className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:bg-slate-50"
                onClick={() => loadCode(code)}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{code.code}</p>
                      <Badge variant={code.isActive ? 'green' : 'slate'}>{code.isActive ? 'Active' : 'Inactive'}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {code.discountType === 'percentage' ? `${code.discountValue}% off` : `£${code.discountValue.toFixed(2)} off`} • {code.scope}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Uses: {code.usedCount} • {getDiscountCodeUsesRemaining(code)}
                    </p>
                  </div>
                  <div className="text-right text-sm text-slate-500">
                    <p>{code.validFrom ? `From ${new Date(code.validFrom).toLocaleString()}` : 'No start date'}</p>
                    <p>{code.validUntil ? `Until ${new Date(code.validUntil).toLocaleString()}` : 'No end date'}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Discount Editor</p>
            <h3 className="mt-2 font-display text-2xl font-bold">
              {draft.id ? `Editing ${draft.code || draft.id}` : 'Create discount code'}
            </h3>
          </div>
          {draft.id ? <Badge variant="blue">{draft.id}</Badge> : null}
        </div>
        <div className="mt-5 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Code</span>
              <Input value={draft.code} onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Active</span>
              <div className="flex h-11 items-center gap-3 rounded-xl border border-slate-300 bg-white px-3">
                <input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} />
                <span>{draft.isActive ? 'Redeemable' : 'Disabled'}</span>
              </div>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Discount type</span>
              <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={draft.discountType} onChange={(event) => setDraft((current) => ({ ...current, discountType: event.target.value as DiscountCode['discountType'] }))}>
                <option value="percentage">Percentage</option>
                <option value="fixed_amount">Fixed amount</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Value</span>
              <Input type="number" min="0" step={draft.discountType === 'percentage' ? '1' : '0.01'} value={draft.discountValue} onChange={(event) => setDraft((current) => ({ ...current, discountValue: Number(event.target.value) }))} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Scope</span>
              <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={draft.scope} onChange={(event) => setDraft((current) => ({ ...current, scope: event.target.value as DiscountCode['scope'] }))}>
                <option value="order">Order</option>
                <option value="item">Item</option>
                <option value="both">Both</option>
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Usage mode</span>
              <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={draft.usageMode} onChange={(event) => setDraft((current) => ({ ...current, usageMode: event.target.value as DiscountCode['usageMode'] }))}>
                <option value="single_use">Single use</option>
                <option value="limited_use">Limited use</option>
                <option value="unlimited">Unlimited</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Max uses</span>
              <Input type="number" min="1" disabled={draft.usageMode === 'unlimited'} value={draft.usageMode === 'single_use' ? 1 : draft.maxUses ?? ''} onChange={(event) => setDraft((current) => ({ ...current, maxUses: Number(event.target.value) || 1 }))} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Minimum order value</span>
              <Input type="number" min="0" step="0.01" value={draft.minimumOrderValue ?? ''} onChange={(event) => setDraft((current) => ({ ...current, minimumOrderValue: event.target.value ? Number(event.target.value) : null }))} />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Valid from</span>
              <Input type="datetime-local" value={toDateTimeLocal(draft.validFrom)} onChange={(event) => setDraft((current) => ({ ...current, validFrom: fromDateTimeLocal(event.target.value) }))} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Valid until</span>
              <Input type="datetime-local" value={toDateTimeLocal(draft.validUntil)} onChange={(event) => setDraft((current) => ({ ...current, validUntil: fromDateTimeLocal(event.target.value) }))} />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Applies to menu item</span>
              <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={draft.appliesToMenuItemId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, appliesToMenuItemId: event.target.value || null }))}>
                <option value="">Any item</option>
                {menuItems.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-semibold text-slate-600">Applies to category</span>
              <select className="h-11 rounded-xl border border-slate-300 bg-white px-3" value={draft.appliesToCategorySlug ?? ''} onChange={(event) => setDraft((current) => ({ ...current, appliesToCategorySlug: event.target.value || null }))}>
                <option value="">Any category</option>
                {MENU_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.slug} value={option.slug}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="grid gap-2 text-sm">
            <span className="font-semibold text-slate-600">Notes</span>
            <Textarea value={draft.notes ?? ''} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
          </label>

          <div className="flex gap-2">
            <Button onClick={saveCode}>Save code</Button>
            <Button variant="outline" onClick={() => setDraft(emptyDiscountCode())}>Clear form</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
