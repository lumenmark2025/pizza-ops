import type {
  DiscountCode,
  Ingredient,
  MenuItem,
  MenuItemRecipe,
  Modifier,
  Order,
  ServiceInventory,
  ServiceSnapshot,
} from '../types/domain'
import { normalizeMenuItem, resolveMenuCategorySlug } from './menu'
import { getSupabaseClientError, supabase, supabaseConfigError, supabaseUrl } from './supabase'

type IngredientRow = {
  id: string
  name: string
  unit: string
  low_stock_threshold?: number | null
  default_stock_amount?: number | null
  track_stock?: boolean | null
  active?: boolean | null
}

type MenuItemRow = {
  id: string
  name: string
  category?: string | null
  category_slug?: string | null
  description?: string | null
  base_price_pence?: number | null
  sort_order?: number | null
  chilli_rating?: number | null
  image_url?: string | null
  active?: boolean | null
  loyverse_item_id?: string | null
}

type RecipeRow = {
  id: string
  menu_item_id: string
  ingredient_id: string
  quantity: number
  affects_availability?: boolean | null
}

type ModifierRow = {
  id: string
  name: string
  price_delta?: number | null
  stock_ingredient_id?: string | null
  stock_quantity?: number | null
  max_per_pizza?: number | null
  applies_to_all_pizzas?: boolean | null
}

type MenuItemModifierRow = {
  menu_item_id: string
  modifier_id: string
}

type MasterDataPatch = Pick<
  ServiceSnapshot,
  'ingredients' | 'menuItems' | 'recipes' | 'inventory' | 'inventoryDefaults' | 'modifiers' | 'orders' | 'discountCodes'
>

export type MasterDataLoadResult = {
  patch: MasterDataPatch | null
  error: string | null
  warnings: string[]
}

function isUuidValue(value?: string | null) {
  return typeof value === 'string'
    ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    : false
}

function isMissingIngredientThresholdColumn(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === 'PGRST204' ||
    error?.code === '42703' ||
    error?.message?.includes('low_stock_threshold') === true
  )
}

function isMissingIngredientDefaultStockColumn(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === 'PGRST204' ||
    error?.code === '42703' ||
    error?.message?.includes('default_stock_amount') === true
  )
}

function isMissingModifierColumn(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === 'PGRST204' || error?.code === '42703'
}

function isMissingRelation(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === 'PGRST205' || error?.code === '42P01'
}

function formatPersistError(
  step: string,
  error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null | undefined,
) {
  const segments = [
    `Menu persistence failed at ${step}.`,
    error?.message ?? 'Unknown Supabase error.',
  ]

  if (error?.code) {
    segments.push(`code=${error.code}`)
  }

  if (error?.details) {
    segments.push(`details=${error.details}`)
  }

  if (error?.hint) {
    segments.push(`hint=${error.hint}`)
  }

  if (supabaseUrl) {
    segments.push(`target=${supabaseUrl}`)
  }

  return segments.join(' ')
}

async function selectIngredientRows() {
  if (!supabase) {
    return { data: null as IngredientRow[] | null, error: null }
  }

  const withDefaultStock = await supabase
    .from('ingredients')
    .select('id, name, unit, low_stock_threshold, default_stock_amount, track_stock, active')

  if (!isMissingIngredientDefaultStockColumn(withDefaultStock.error) && !isMissingIngredientThresholdColumn(withDefaultStock.error)) {
    return withDefaultStock as { data: IngredientRow[] | null; error: typeof withDefaultStock.error }
  }

  const withThreshold = await supabase
    .from('ingredients')
    .select('id, name, unit, low_stock_threshold, track_stock, active')

  if (!isMissingIngredientThresholdColumn(withThreshold.error)) {
    return {
      data: ((withThreshold.data ?? []) as IngredientRow[]).map((row) => ({ ...row, default_stock_amount: 0 })),
      error: withThreshold.error,
    }
  }

  const fallback = await supabase
    .from('ingredients')
    .select('id, name, unit, track_stock, active')

  return {
    data: ((fallback.data ?? []) as IngredientRow[]).map((row) => ({ ...row, low_stock_threshold: 0, default_stock_amount: 0 })),
    error: fallback.error,
  }
}

async function selectModifierRows() {
  if (!supabase) {
    return { data: null as ModifierRow[] | null, error: null, warning: null as string | null }
  }

  const withExtendedColumns = await supabase
    .from('modifiers')
    .select('id, name, price_delta, stock_ingredient_id, stock_quantity, max_per_pizza, applies_to_all_pizzas')

  if (!isMissingModifierColumn(withExtendedColumns.error)) {
    if (isMissingRelation(withExtendedColumns.error)) {
      return {
        data: [],
        error: null,
        warning: `modifiers load skipped: ${withExtendedColumns.error?.message ?? 'table missing'}`,
      }
    }

    return {
      ...(withExtendedColumns as { data: ModifierRow[] | null; error: typeof withExtendedColumns.error }),
      warning: null,
    }
  }

  const fallback = await supabase.from('modifiers').select('id, name')
  if (fallback.error) {
    return { data: null, error: fallback.error, warning: null }
  }

  return {
    data: (fallback.data ?? []).map((row) => ({ ...row, price_delta: 0 })) as ModifierRow[],
    error: null,
    warning: `modifiers load degraded: ${withExtendedColumns.error?.message ?? 'extended columns missing'}`,
  }
}

async function selectMenuItemModifierRows() {
  if (!supabase) {
    return { data: null as MenuItemModifierRow[] | null, error: null, warning: null as string | null }
  }

  const result = await supabase.from('menu_item_modifiers').select('menu_item_id, modifier_id')
  if (isMissingRelation(result.error)) {
    return {
      data: [],
      error: null,
      warning: `menu_item_modifiers load skipped: ${result.error?.message ?? 'table missing'}`,
    }
  }

  return {
    ...(result as { data: MenuItemModifierRow[] | null; error: typeof result.error }),
    warning: null,
  }
}

function formatLoadError(
  step: string,
  error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null | undefined,
) {
  const segments = [`${step} load failed.`, error?.message ?? 'Unknown Supabase error.']

  if (error?.code) {
    segments.push(`code=${error.code}`)
  }

  if (error?.details) {
    segments.push(`details=${error.details}`)
  }

  if (error?.hint) {
    segments.push(`hint=${error.hint}`)
  }

  return segments.join(' ')
}

function isUuid(value?: string | null) {
  return typeof value === 'string'
    ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    : false
}

function normalizeNameKey(value?: string | null) {
  return value?.trim().toLowerCase() ?? ''
}

function mapIngredientRow(row: IngredientRow, existing: Ingredient | undefined): Ingredient {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    lowStockThreshold: Number(row.low_stock_threshold ?? existing?.lowStockThreshold ?? 0),
    defaultStockAmount: Number(row.default_stock_amount ?? existing?.defaultStockAmount ?? 0),
    active: row.active ?? true,
  }
}

function mapModifierRow(
  row: ModifierRow,
  menuItemIds: string[],
  existing: Modifier | undefined,
): Modifier {
  return {
    id: row.id,
    name: row.name,
    priceDelta: Number(row.price_delta ?? 0),
    stockIngredientId: row.stock_ingredient_id ?? existing?.stockIngredientId ?? null,
    stockQuantity: Number(row.stock_quantity ?? existing?.stockQuantity ?? 0),
    maxPerPizza: Number(row.max_per_pizza ?? existing?.maxPerPizza ?? 1),
    menuItemIds,
    appliesToAllPizzas: row.applies_to_all_pizzas ?? existing?.appliesToAllPizzas ?? (menuItemIds.length === 0),
  }
}

export async function persistIngredientToSupabase(ingredient: Ingredient): Promise<Ingredient | null> {
  if (!supabase) {
    throw new Error(getSupabaseClientError('Ingredient write'))
  }

  const payload = {
    id: ingredient.id,
    name: ingredient.name.trim(),
    unit: ingredient.unit.trim() || 'each',
    low_stock_threshold: Number(ingredient.lowStockThreshold ?? 0),
    default_stock_amount: Number(ingredient.defaultStockAmount ?? 0),
    track_stock: true,
    active: ingredient.active ?? true,
  }

  const primary = await supabase
    .from('ingredients')
    .upsert(payload)
    .select('id, name, unit, low_stock_threshold, default_stock_amount, track_stock, active')
    .single()

  if (isMissingIngredientDefaultStockColumn(primary.error) || isMissingIngredientThresholdColumn(primary.error)) {
    const fallback = await supabase
      .from('ingredients')
      .upsert({
        id: ingredient.id,
        name: ingredient.name.trim(),
        unit: ingredient.unit.trim() || 'each',
        low_stock_threshold: Number(ingredient.lowStockThreshold ?? 0),
        track_stock: true,
        active: ingredient.active ?? true,
      })
      .select('id, name, unit, low_stock_threshold, track_stock, active')
      .single()

    if (fallback.error || !fallback.data) {
      throw new Error(fallback.error.message)
    }

    return mapIngredientRow({ ...(fallback.data as IngredientRow), default_stock_amount: ingredient.defaultStockAmount ?? 0 }, ingredient)
  }

  if (primary.error || !primary.data) {
    throw new Error(primary.error.message)
  }

  return mapIngredientRow(primary.data as IngredientRow, ingredient)
}

export async function deleteIngredientFromSupabase(ingredientId: string): Promise<void> {
  if (!supabase) {
    throw new Error(getSupabaseClientError('Ingredient delete'))
  }

  const { error } = await supabase
    .from('ingredients')
    .update({ active: false })
    .eq('id', ingredientId)

  if (error) {
    throw new Error(`Ingredient delete failed. ${error.message}`)
  }
}

export async function persistMenuItemToSupabase(menuItem: MenuItem): Promise<MenuItem | null> {
  if (!supabase) {
    throw new Error(getSupabaseClientError('Menu item write'))
  }

  const normalized = normalizeMenuItem(menuItem)
  const payload = {
    id: normalized.id,
    name: normalized.name.trim(),
    category: normalized.category,
    category_slug: normalized.categorySlug,
    description: normalized.description,
    base_price_pence: Math.round(Number(normalized.price ?? 0) * 100),
    sort_order: Number(normalized.sortOrder ?? 0),
    chilli_rating: Number(normalized.chilliRating ?? 0),
    image_url: normalized.imageUrl ?? null,
    active: normalized.active ?? true,
    loyverse_item_id: normalized.loyverseItemId || null,
    is_pizza: !['dips', 'drinks'].includes(resolveMenuCategorySlug(normalized.categorySlug, normalized.category)),
  }

  console.info('[menu-save] menu_items upsert start', {
    target: supabaseUrl,
    id: normalized.id,
    name: normalized.name,
  })

  const { data, error } = await supabase
    .from('menu_items')
    .upsert(payload)
    .select(
      'id, name, category, category_slug, description, base_price_pence, sort_order, chilli_rating, image_url, active, loyverse_item_id',
    )
    .single()

  if (error || !data) {
    console.error('[menu-save] menu_items upsert failed', {
      target: supabaseUrl,
      payload,
      error,
    })
    throw new Error(formatPersistError('menu_items upsert', error))
  }

  console.info('[menu-save] menu_items upsert success', {
    target: supabaseUrl,
    id: data.id,
    name: data.name,
  })

  return mapMenuItemRow(data as MenuItemRow)
}

export async function deleteMenuItemFromSupabase(menuItemId: string): Promise<void> {
  if (!supabase) {
    throw new Error(getSupabaseClientError('Menu item delete'))
  }

  const { error } = await supabase
    .from('menu_items')
    .update({ active: false })
    .eq('id', menuItemId)

  if (error) {
    throw new Error(`Menu item delete failed. ${error.message}`)
  }
}

export async function persistMenuItemRecipesToSupabase(
  menuItemId: string,
  recipeRows: MenuItemRecipe[],
): Promise<MenuItemRecipe[] | null> {
  if (!supabase) {
    throw new Error(getSupabaseClientError('Recipe write'))
  }

  console.info('[menu-save] menu_item_recipes replace start', {
    target: supabaseUrl,
    menuItemId,
    recipeCount: recipeRows.length,
  })

  const { error: deleteError } = await supabase
    .from('menu_item_recipes')
    .delete()
    .eq('menu_item_id', menuItemId)

  if (deleteError) {
    console.error('[menu-save] menu_item_recipes delete failed', {
      target: supabaseUrl,
      menuItemId,
      error: deleteError,
    })
    throw new Error(formatPersistError('menu_item_recipes delete', deleteError))
  }

  const payload = recipeRows
    .filter((entry) => entry.ingredientId && Number(entry.quantity) > 0)
    .map((entry) => ({
      menu_item_id: menuItemId,
      ingredient_id: entry.ingredientId,
      quantity: Number(entry.quantity),
      affects_availability: entry.affectsAvailability !== false,
    }))

  if (payload.length) {
    const { error: insertError } = await supabase.from('menu_item_recipes').insert(payload)
    if (insertError) {
      console.error('[menu-save] menu_item_recipes insert failed', {
        target: supabaseUrl,
        menuItemId,
        payload,
        error: insertError,
      })
      throw new Error(formatPersistError('menu_item_recipes insert', insertError))
    }
  }

  const { data, error } = await supabase
    .from('menu_item_recipes')
    .select('id, menu_item_id, ingredient_id, quantity, affects_availability')
    .eq('menu_item_id', menuItemId)

  if (error) {
    console.error('[menu-save] menu_item_recipes reload failed', {
      target: supabaseUrl,
      menuItemId,
      error,
    })
    throw new Error(formatPersistError('menu_item_recipes reload', error))
  }

  console.info('[menu-save] menu_item_recipes replace success', {
    target: supabaseUrl,
    menuItemId,
    recipeCount: (data ?? []).length,
  })

  return ((data ?? []) as RecipeRow[]).map((row) => ({
    id: row.id,
    menuItemId: row.menu_item_id,
    ingredientId: row.ingredient_id,
    quantity: Number(row.quantity),
    affectsAvailability: row.affects_availability !== false,
  }))
}

export async function persistModifierToSupabase(modifier: Modifier): Promise<Modifier | null> {
  if (!supabase) {
    throw new Error(getSupabaseClientError('Modifier write'))
  }

  const payload = {
    ...(isUuidValue(modifier.id) ? { id: modifier.id } : {}),
    name: modifier.name.trim(),
    price_delta: Number(modifier.priceDelta ?? 0),
    stock_ingredient_id: modifier.stockIngredientId ?? null,
    stock_quantity: Number(modifier.stockQuantity ?? 0),
    max_per_pizza: Number(modifier.maxPerPizza ?? 1),
    applies_to_all_pizzas: modifier.appliesToAllPizzas !== false,
  }

  const primary = await supabase
    .from('modifiers')
    .upsert(payload)
    .select('id, name, price_delta, stock_ingredient_id, stock_quantity, max_per_pizza, applies_to_all_pizzas')
    .single()

  const persistedModifier =
    primary.error && isMissingModifierColumn(primary.error)
      ? await supabase.from('modifiers').upsert({
          ...(isUuidValue(modifier.id) ? { id: modifier.id } : {}),
          name: modifier.name.trim(),
          price_delta: Number(modifier.priceDelta ?? 0),
        }).select('id, name, price_delta').single()
      : primary

  if (persistedModifier.error || !persistedModifier.data) {
    throw new Error(formatPersistError('modifiers upsert', persistedModifier.error))
  }

  const persistedModifierId = (persistedModifier.data as ModifierRow).id

  const { error: deleteLinksError } = await supabase
    .from('menu_item_modifiers')
    .delete()
    .eq('modifier_id', persistedModifierId)

  if (deleteLinksError) {
    throw new Error(formatPersistError('menu_item_modifiers delete', deleteLinksError))
  }

  const menuItemIds =
    modifier.appliesToAllPizzas === false
      ? Array.from(new Set(modifier.menuItemIds.filter(Boolean)))
      : []

  if (menuItemIds.length) {
    const { error: insertLinksError } = await supabase.from('menu_item_modifiers').insert(
      menuItemIds.map((menuItemId) => ({
        menu_item_id: menuItemId,
        modifier_id: persistedModifierId,
      })),
    )

    if (insertLinksError) {
      throw new Error(formatPersistError('menu_item_modifiers insert', insertLinksError))
    }
  }

  return mapModifierRow(persistedModifier.data as ModifierRow, menuItemIds, modifier)
}

export async function deleteModifierFromSupabase(modifierId: string): Promise<void> {
  if (!supabase) {
    throw new Error(getSupabaseClientError('Modifier delete'))
  }

  const { error: deleteLinksError } = await supabase
    .from('menu_item_modifiers')
    .delete()
    .eq('modifier_id', modifierId)

  if (deleteLinksError) {
    throw new Error(formatPersistError('menu_item_modifiers delete', deleteLinksError))
  }

  const { error: deleteModifierError } = await supabase
    .from('modifiers')
    .delete()
    .eq('id', modifierId)

  if (deleteModifierError) {
    throw new Error(formatPersistError('modifiers delete', deleteModifierError))
  }
}

export async function loadMasterDataFromSupabase(
  existingSnapshot: Pick<ServiceSnapshot, 'ingredients' | 'inventory' | 'inventoryDefaults' | 'modifiers' | 'orders' | 'discountCodes'>,
): Promise<MasterDataLoadResult> {
  if (!supabase) {
    if (supabaseConfigError) {
      console.error('loadMasterDataFromSupabase unavailable', supabaseConfigError)
    }
    return {
      patch: null,
      error: supabaseConfigError ?? 'Supabase client unavailable.',
      warnings: [],
    }
  }

  const [
    ingredientResult,
    { data: menuItemRows, error: menuItemError },
    { data: recipeRows, error: recipeError },
    modifierResult,
    menuItemModifierResult,
  ] = await Promise.all([
    selectIngredientRows(),
    supabase.from('menu_items').select(
      'id, name, category, category_slug, description, base_price_pence, sort_order, chilli_rating, image_url, active, loyverse_item_id',
    ),
    supabase.from('menu_item_recipes').select('id, menu_item_id, ingredient_id, quantity, affects_availability'),
    selectModifierRows(),
    selectMenuItemModifierRows(),
  ])

  const { data: ingredientRows, error: ingredientError } = ingredientResult
  const { data: modifierRows, error: modifierError, warning: modifierWarning } = modifierResult
  const {
    data: menuItemModifierRows,
    error: menuItemModifierError,
    warning: menuItemModifierWarning,
  } = menuItemModifierResult

  if (ingredientError || menuItemError || recipeError) {
    console.error('loadMasterDataFromSupabase error', {
      ingredientError,
      menuItemError,
      recipeError,
    })
    const firstFailure =
      (ingredientError && formatLoadError('ingredients', ingredientError)) ||
      (menuItemError && formatLoadError('menu_items', menuItemError)) ||
      (recipeError && formatLoadError('menu_item_recipes', recipeError)) ||
      'Master data load failed.'

    return {
      patch: null,
      error: firstFailure,
      warnings: [],
    }
  }

  const warnings = [
    modifierError ? formatLoadError('modifiers', modifierError) : null,
    menuItemModifierError ? formatLoadError('menu_item_modifiers', menuItemModifierError) : null,
    modifierWarning,
    menuItemModifierWarning,
  ].filter(Boolean) as string[]

  if (modifierError || menuItemModifierError) {
    console.error('loadMasterDataFromSupabase optional load warning', {
      modifierError,
      menuItemModifierError,
    })
  }

  const ingredients = ((ingredientRows ?? []) as IngredientRow[]).map((row) =>
    mapIngredientRow(
      row,
      existingSnapshot.ingredients.find((entry) => entry.id === row.id || normalizeNameKey(entry.name) === normalizeNameKey(row.name)),
    ),
  )
  const menuItems = ((menuItemRows ?? []) as MenuItemRow[]).map((row) => mapMenuItemRow(row))
  const recipes = ((recipeRows ?? []) as RecipeRow[]).map((row) => ({
    id: row.id,
    menuItemId: row.menu_item_id,
    ingredientId: row.ingredient_id,
    quantity: Number(row.quantity),
    affectsAvailability: row.affects_availability !== false,
  }))
  const modifierLinksById = new Map<string, string[]>()
  for (const row of (menuItemModifierRows ?? []) as MenuItemModifierRow[]) {
    const currentMenuItemIds = modifierLinksById.get(row.modifier_id) ?? []
    currentMenuItemIds.push(row.menu_item_id)
    modifierLinksById.set(row.modifier_id, currentMenuItemIds)
  }
  const modifiers = ((modifierRows ?? []) as ModifierRow[]).map((row) =>
    mapModifierRow(
      row,
      modifierLinksById.get(row.id) ?? [],
      existingSnapshot.modifiers.find((entry) => entry.id === row.id),
    ),
  )

  return {
    patch: {
      ingredients,
      menuItems,
      recipes,
      inventory: existingSnapshot.inventory,
      inventoryDefaults: ingredients.map((ingredient) => ({
        ingredientId: ingredient.id,
        quantity: Number(ingredient.defaultStockAmount ?? 0),
      })),
      modifiers,
      orders: existingSnapshot.orders,
      discountCodes: existingSnapshot.discountCodes,
    },
    error: null,
    warnings,
  }
}

function mapMenuItemRow(row: MenuItemRow): MenuItem {
  return normalizeMenuItem({
    id: row.id,
    name: row.name,
    category: row.category ?? row.category_slug ?? 'pizza',
    categorySlug: resolveMenuCategorySlug(row.category_slug, row.category),
    sortOrder: Number(row.sort_order ?? 0),
    chilliRating: Number(row.chilli_rating ?? 0),
    imageUrl: row.image_url ?? null,
    price: Number(row.base_price_pence ?? 0) / 100,
    loyverseItemId: row.loyverse_item_id ?? '',
    description: row.description ?? '',
    active: row.active ?? true,
  })
}

function remapInventoryRows(rows: ServiceInventory[], ingredientIdMap: Map<string, string>) {
  return rows.map((row) => ({
    ...row,
    ingredientId: ingredientIdMap.get(row.ingredientId) ?? row.ingredientId,
  }))
}

function remapModifiers(
  modifiers: Modifier[],
  ingredientIdMap: Map<string, string>,
  menuItemIdMap: Map<string, string>,
): Modifier[] {
  return modifiers.map((modifier) => ({
    ...modifier,
    stockIngredientId: modifier.stockIngredientId
      ? ingredientIdMap.get(modifier.stockIngredientId) ?? modifier.stockIngredientId
      : modifier.stockIngredientId,
    menuItemIds: modifier.menuItemIds.map((menuItemId) => menuItemIdMap.get(menuItemId) ?? menuItemId),
  }))
}

function remapOrders(orders: Order[], menuItemIdMap: Map<string, string>): Order[] {
  return orders.map((order) => ({
    ...order,
    items: order.items.map((item) => ({
      ...item,
      menuItemId: menuItemIdMap.get(item.menuItemId) ?? item.menuItemId,
    })),
  }))
}

function remapDiscountCodes(
  discountCodes: DiscountCode[],
  menuItemIdMap: Map<string, string>,
): DiscountCode[] {
  return discountCodes.map((discountCode) => ({
    ...discountCode,
    appliesToMenuItemId: discountCode.appliesToMenuItemId
      ? menuItemIdMap.get(discountCode.appliesToMenuItemId) ?? discountCode.appliesToMenuItemId
      : discountCode.appliesToMenuItemId,
  }))
}

export async function syncMasterDataToSupabase(snapshot: ServiceSnapshot): Promise<MasterDataPatch | null> {
  if (!supabase) {
    return null
  }

  try {
    const [ingredientResult, { data: menuItemRows, error: menuLoadError }] =
      await Promise.all([
        selectIngredientRows(),
        supabase.from('menu_items').select(
          'id, name, category, category_slug, description, base_price_pence, sort_order, chilli_rating, image_url, active, loyverse_item_id',
        ),
      ])

    const { data: ingredientRows, error: ingredientLoadError } = ingredientResult

    if (ingredientLoadError || menuLoadError) {
      console.error('syncMasterDataToSupabase load error', { ingredientLoadError, menuLoadError })
      return null
    }

    const existingIngredients = (ingredientRows ?? []) as IngredientRow[]
    const existingMenuItems = (menuItemRows ?? []) as MenuItemRow[]
    const ingredientById = new Map(existingIngredients.map((row) => [row.id, row]))
    const ingredientByName = new Map(existingIngredients.map((row) => [normalizeNameKey(row.name), row]))
    const menuById = new Map(existingMenuItems.map((row) => [row.id, row]))
    const menuByName = new Map(existingMenuItems.map((row) => [normalizeNameKey(row.name), row]))

    const ingredientIdMap = new Map<string, string>()
    const syncedIngredients: Ingredient[] = []

    for (const ingredient of snapshot.ingredients) {
      const existing =
        (isUuid(ingredient.id) ? ingredientById.get(ingredient.id) : null) ??
        ingredientByName.get(normalizeNameKey(ingredient.name))

      const savedIngredient = await persistIngredientToSupabase({
        ...ingredient,
        id: existing?.id ?? ingredient.id,
      })
      if (!savedIngredient) {
        console.error('syncMasterDataToSupabase ingredient save error', { ingredient })
        return null
      }

      ingredientIdMap.set(ingredient.id, savedIngredient.id)
      syncedIngredients.push(savedIngredient)
    }

    const menuItemIdMap = new Map<string, string>()
    const syncedMenuItems: MenuItem[] = []

    for (const menuItem of snapshot.menuItems.map(normalizeMenuItem)) {
      const existing =
        (isUuid(menuItem.id) ? menuById.get(menuItem.id) : null) ??
        menuByName.get(normalizeNameKey(menuItem.name))

      const payload = {
        ...(existing ? { id: existing.id } : {}),
        name: menuItem.name.trim(),
        category: menuItem.category,
        category_slug: menuItem.categorySlug,
        description: menuItem.description,
        base_price_pence: Math.round(Number(menuItem.price ?? 0) * 100),
        sort_order: Number(menuItem.sortOrder ?? 0),
        chilli_rating: Number(menuItem.chilliRating ?? 0),
        image_url: menuItem.imageUrl ?? null,
        active: menuItem.active ?? true,
        loyverse_item_id: menuItem.loyverseItemId || null,
        is_pizza: !['dips', 'drinks'].includes(resolveMenuCategorySlug(menuItem.categorySlug, menuItem.category)),
      }

      const operation = existing
        ? supabase
            .from('menu_items')
            .upsert(payload)
            .select('id, name, category, category_slug, description, base_price_pence, sort_order, chilli_rating, image_url, active, loyverse_item_id')
            .single()
        : supabase
            .from('menu_items')
            .insert(payload)
            .select('id, name, category, category_slug, description, base_price_pence, sort_order, chilli_rating, image_url, active, loyverse_item_id')
            .single()

      const { data, error } = await operation
      if (error || !data) {
        console.error('syncMasterDataToSupabase menu save error', { menuItem, error })
        return null
      }

      menuItemIdMap.set(menuItem.id, data.id)
      syncedMenuItems.push(mapMenuItemRow(data as MenuItemRow))
    }

    const desiredRecipes = new Map<string, MenuItemRecipe>()
    for (const recipe of snapshot.recipes) {
      const menuItemId = menuItemIdMap.get(recipe.menuItemId) ?? recipe.menuItemId
      const ingredientId = ingredientIdMap.get(recipe.ingredientId) ?? recipe.ingredientId
      if (!isUuid(menuItemId) || !isUuid(ingredientId) || Number(recipe.quantity) <= 0) {
        continue
      }

      desiredRecipes.set(`${menuItemId}:${ingredientId}`, {
        ...recipe,
        id: recipe.id,
        menuItemId,
        ingredientId,
        quantity: Number(recipe.quantity),
        affectsAvailability: recipe.affectsAvailability !== false,
      })
    }

    const affectedMenuIds = Array.from(new Set(Array.from(desiredRecipes.values()).map((recipe) => recipe.menuItemId)))

    if (affectedMenuIds.length) {
      const { error: deleteError } = await supabase
        .from('menu_item_recipes')
        .delete()
        .in('menu_item_id', affectedMenuIds)

      if (deleteError) {
        console.error('syncMasterDataToSupabase recipe delete error', deleteError)
        return null
      }

      const recipePayload = Array.from(desiredRecipes.values()).map((recipe) => ({
        menu_item_id: recipe.menuItemId,
        ingredient_id: recipe.ingredientId,
        quantity: recipe.quantity,
        affects_availability: recipe.affectsAvailability !== false,
      }))

      if (recipePayload.length) {
        const { error: insertError } = await supabase.from('menu_item_recipes').insert(recipePayload)
        if (insertError) {
          console.error('syncMasterDataToSupabase recipe insert error', insertError)
          return null
        }
      }
    }

    const { data: persistedRecipes, error: recipeLoadError } = await supabase
      .from('menu_item_recipes')
      .select('id, menu_item_id, ingredient_id, quantity, affects_availability')

    if (recipeLoadError) {
      console.error('syncMasterDataToSupabase recipe load error', recipeLoadError)
      return null
    }

    const syncedRecipes: MenuItemRecipe[] = ((persistedRecipes ?? []) as RecipeRow[]).map((row) => ({
      id: row.id,
      menuItemId: row.menu_item_id,
      ingredientId: row.ingredient_id,
      quantity: Number(row.quantity),
      affectsAvailability: row.affects_availability !== false,
    }))

    return {
      ingredients: syncedIngredients,
      menuItems: syncedMenuItems,
      recipes: syncedRecipes,
      inventory: remapInventoryRows(snapshot.inventory, ingredientIdMap),
      inventoryDefaults: remapInventoryRows(snapshot.inventoryDefaults, ingredientIdMap),
      modifiers: remapModifiers(snapshot.modifiers as Modifier[], ingredientIdMap, menuItemIdMap),
      orders: remapOrders(snapshot.orders as Order[], menuItemIdMap),
      discountCodes: remapDiscountCodes(snapshot.discountCodes as DiscountCode[], menuItemIdMap),
    }
  } catch (error) {
    console.error('syncMasterDataToSupabase unexpected error', error)
    return null
  }
}
