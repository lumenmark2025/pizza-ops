import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { cn } from '../lib/utils'
import { usePizzaOpsStore } from '../store/usePizzaOpsStore'
import type { Modifier } from '../types/domain'

export function ModifiersAdminPage() {
  const menuItems = usePizzaOpsStore((state) => state.menuItems)
  const modifiers = usePizzaOpsStore((state) => state.modifiers)
  const upsertModifier = usePizzaOpsStore((state) => state.upsertModifier)
  const deleteModifier = usePizzaOpsStore((state) => state.deleteModifier)
  const [modifierDraft, setModifierDraft] = useState<Modifier>({
    id: '',
    name: '',
    priceDelta: 1,
    menuItemIds: [],
    appliesToAllPizzas: true,
  })

  return (
    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <Card className="p-5 sm:p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-600">Modifiers</p>
        <h2 className="mt-2 font-display text-3xl font-bold">Global modifier admin</h2>
        <p className="mt-2 text-sm text-slate-500">Manage add/remove options globally so all services use the same modifier setup.</p>
        <div className="mt-6 grid gap-3">
          <Input placeholder="Modifier name" value={modifierDraft.name} onChange={(event) => setModifierDraft((current) => ({ ...current, id: current.id || `mod_${event.target.value.toLowerCase().replace(/\s+/g, '_')}`, name: event.target.value }))} />
          <Input type="number" placeholder="Price delta" value={modifierDraft.priceDelta} onChange={(event) => setModifierDraft((current) => ({ ...current, priceDelta: Number(event.target.value) }))} />
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
            <input type="checkbox" checked={modifierDraft.appliesToAllPizzas ?? false} onChange={(event) => setModifierDraft((current) => ({ ...current, appliesToAllPizzas: event.target.checked, menuItemIds: event.target.checked ? [] : current.menuItemIds }))} />
            Available on all pizzas
          </label>
          <div className="flex flex-wrap gap-2">
            {menuItems.map((item) => {
              const active = modifierDraft.menuItemIds.includes(item.id)
              return (
                <button key={item.id} className={cn('rounded-full border px-3 py-1 text-xs font-semibold', active ? 'border-orange-400 bg-orange-100 text-orange-700' : 'border-slate-300 bg-white text-slate-600')} onClick={() => setModifierDraft((current) => ({
                  ...current,
                  menuItemIds: active ? current.menuItemIds.filter((id) => id !== item.id) : [...current.menuItemIds, item.id],
                }))} disabled={modifierDraft.appliesToAllPizzas}>
                  {item.name}
                </button>
              )
            })}
          </div>
          <Button onClick={() => {
            upsertModifier(modifierDraft, 'manager')
            setModifierDraft({ id: '', name: '', priceDelta: 1, menuItemIds: [], appliesToAllPizzas: true })
          }}>
            Save modifier
          </Button>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <h3 className="font-display text-2xl font-bold">Current modifiers</h3>
        <div className="mt-4 space-y-2">
          {modifiers.map((modifier) => (
            <div key={modifier.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-3">
              <div>
                <p className="font-semibold">{modifier.name}</p>
                <p className="text-sm text-slate-500">{modifier.appliesToAllPizzas ? 'All pizzas' : `${modifier.menuItemIds.length} menu items`}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setModifierDraft(modifier)}>
                  Edit
                </Button>
                <Button size="sm" variant="danger" onClick={() => deleteModifier(modifier.id, 'manager')}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
