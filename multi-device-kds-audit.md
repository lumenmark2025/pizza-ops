1. True inconsistency cause

The divergence was coming from unscoped operational routes and persisted local operational state.

Before this fix:
- `KDS`, `KDS-2`, `Customer Board`, and `Order Entry` all read `service` and `orders` directly from the Zustand store, with no route-level service id.
- Zustand `persist` was storing `service`, `orders`, `customers`, `payments`, `history`, `loyverseQueue`, `activityLog`, and `inventory` in browser storage.
- On startup, [`src/App.tsx`](/c:/Users/ops/pizza-ops/src/App.tsx) called `hydrateRemote()`, and [`src/store/usePizzaOpsStore.ts`](/c:/Users/ops/pizza-ops/src/store/usePizzaOpsStore.ts) loaded `service_runtime_state` for `current.service.id`, where that `current.service.id` came from the device’s own persisted Zustand state.
- Realtime subscription was also filtered by that same local `service.id` via [`src/lib/realtime-state.ts`](/c:/Users/ops/pizza-ops/src/lib/realtime-state.ts).

So different tablets could legitimately subscribe to different services without the UI making that explicit, and they also booted from different locally persisted order snapshots before any remote sync. That is why one device could show test orders, another real orders, and another only part of a list.

2. Is current operational state held on device, server, or both

Before this fix: both.
- Device: persisted Zustand held operational truth locally.
- Server: `service_runtime_state` held a central snapshot in Supabase, and `orders` had only a partial mirror.

After this fix:
- Authoritative operational truth is server-backed in Supabase.
- Device state is now only an in-memory cache of the currently selected service snapshot plus harmless persisted reference data.

3. What changed

I changed the ops flow so KDS, KDS-2, Customer Board, and Order Entry are explicitly service-scoped and no longer infer service from browser-local state.

Key corrections:
- Moved operational screens to explicit routes under `/ops/:serviceId/...`.
- Turned bare `/kds`, `/kds-2`, `/board`, `/expeditor`, and `/` into explicit service-pick entry points instead of silently reusing local service context.
- Removed persisted local operational state from Zustand persistence.
- Changed remote hydration so service loads start from a blank operational state for the selected service, then hydrate from Supabase.
- Kept realtime subscribed to the explicitly selected service and exposed connection state in the UI.
- Extended Supabase mirroring so `orders` now includes `service_id` and full order fields, and `order_items` / `order_item_modifiers` are also written centrally.

4. Files changed

- [`src/App.tsx`](/c:/Users/ops/pizza-ops/src/App.tsx)
  Added explicit `/ops/:serviceId` routing, service-pick pages for legacy ops routes, and the service-scoped load gate.
- [`src/store/usePizzaOpsStore.ts`](/c:/Users/ops/pizza-ops/src/store/usePizzaOpsStore.ts)
  Removed persisted operational state, added realtime status tracking, changed hydration to blank-then-remote for the selected service, and expanded Supabase order/item mirroring.
- [`src/lib/realtime-state.ts`](/c:/Users/ops/pizza-ops/src/lib/realtime-state.ts)
  Added realtime subscription status callback support.
- [`src/features/operator-shell.tsx`](/c:/Users/ops/pizza-ops/src/features/operator-shell.tsx)
  Updated ops navigation to explicit service-scoped URLs and surfaced current service/realtime status.
- [`src/features/ops-views.tsx`](/c:/Users/ops/pizza-ops/src/features/ops-views.tsx)
  Added visible service/sync indicators on KDS and Customer Board.

5. Migration files created

None.

6. Local schema snapshots updated

No.

7. Corrected multi-device sync model

Now the model is:
- Ops route explicitly selects one `serviceId`.
- The app switches to that service context, clears device-local operational data, hydrates from Supabase, and subscribes to realtime for that exact service.
- KDS, KDS-2, Customer Board, and Order Entry all read from the same service-scoped server-backed snapshot.
- Local browser persistence no longer stores operational order state that can diverge across devices.

8. How service selection is now consistent and explicit

Service selection is now explicit in the route:
- Order Entry: `/ops/:serviceId`
- KDS: `/ops/:serviceId/kds`
- KDS-2: `/ops/:serviceId/kds-2`
- Expeditor: `/ops/:serviceId/expeditor`
- Customer Board: `/ops/:serviceId/board`

If a user opens an old bare route like `/kds` or `/board`, they are forced through a service picker instead of silently inheriting stale local service context. The current service id/name is also visible in the ops UI.

9. Manual verification performed

Performed:
- Audited actual service selection, hydration, persistence, and realtime code paths in `App`, store, ops views, and shell.
- Verified that unscoped ops routes were reading persisted local `service`/`orders`.
- Verified that realtime filter was based on local `service.id`.
- Verified production build success with `npm run build`.

Not performed:
- Live multi-device browser testing against a running shared Supabase instance was not possible in this environment, so I did not claim it.

```sh
git add .
git commit -m "fix multi-device KDS consistency and server-backed order state"
git push
```
