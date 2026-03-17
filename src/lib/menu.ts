import type { MenuItem } from '../types/domain'

export const MENU_CATEGORY_OPTIONS = [
  { slug: 'pizza', label: 'Pizza', shortLabel: 'Pizza', isPizza: true },
  { slug: 'garlic-pizza', label: 'Garlic Pizza', shortLabel: 'Garlic Pizza', isPizza: true },
  { slug: 'house-specials', label: 'House Specials', shortLabel: 'Specials', isPizza: true },
  { slug: 'dips', label: 'Dips', shortLabel: 'Dips', isPizza: false },
  { slug: 'drinks', label: 'Drinks', shortLabel: 'Drinks', isPizza: false },
] as const

export type MenuCategorySlug = (typeof MENU_CATEGORY_OPTIONS)[number]['slug']

const MENU_CATEGORY_LABELS = new Map(
  MENU_CATEGORY_OPTIONS.map((option) => [option.slug, option.label]),
)

const MENU_CATEGORY_SHORT_LABELS = new Map(
  MENU_CATEGORY_OPTIONS.map((option) => [option.slug, option.shortLabel]),
)

const PIZZA_CATEGORY_SET = new Set<MenuCategorySlug>(
  MENU_CATEGORY_OPTIONS.filter((option) => option.isPizza).map((option) => option.slug),
)

function sanitizeCategoryValue(value?: string | null) {
  return value?.trim().toLowerCase() ?? ''
}

export function resolveMenuCategorySlug(
  categorySlug?: string | null,
  legacyCategory?: string | null,
): MenuCategorySlug {
  const slug = sanitizeCategoryValue(categorySlug)
  const legacy = sanitizeCategoryValue(legacyCategory)

  if (slug === 'pizza' || slug === 'garlic-pizza' || slug === 'house-specials' || slug === 'dips' || slug === 'drinks') {
    return slug
  }

  if (legacy === 'pizza') {
    return 'pizza'
  }

  if (legacy === 'side' || legacy === 'sides' || legacy === 'dip' || legacy === 'dips') {
    return 'dips'
  }

  if (legacy === 'drink' || legacy === 'drinks') {
    return 'drinks'
  }

  if (legacy === 'garlic pizza') {
    return 'garlic-pizza'
  }

  if (legacy === 'house specials' || legacy === 'specials') {
    return 'house-specials'
  }

  return 'pizza'
}

export function getMenuCategoryLabel(categorySlug?: string | null, legacyCategory?: string | null) {
  const slug = resolveMenuCategorySlug(categorySlug, legacyCategory)
  return MENU_CATEGORY_LABELS.get(slug) ?? 'Pizza'
}

export function getMenuCategoryShortLabel(categorySlug?: string | null, legacyCategory?: string | null) {
  const slug = resolveMenuCategorySlug(categorySlug, legacyCategory)
  return MENU_CATEGORY_SHORT_LABELS.get(slug) ?? 'Pizza'
}

export function isPizzaMenuItem(menuItem?: Pick<MenuItem, 'category' | 'categorySlug'> | null) {
  if (!menuItem) {
    return false
  }

  return PIZZA_CATEGORY_SET.has(resolveMenuCategorySlug(menuItem.categorySlug, menuItem.category))
}

export function getMenuItemSortOrder(menuItem?: Pick<MenuItem, 'sortOrder'> | null) {
  return Number.isFinite(menuItem?.sortOrder) ? Number(menuItem?.sortOrder) : 0
}

export function getMenuItemChilliRating(menuItem?: Pick<MenuItem, 'chilliRating'> | null) {
  const rating = Number(menuItem?.chilliRating ?? 0)
  if (!Number.isFinite(rating)) {
    return 0
  }

  return Math.max(0, Math.min(3, Math.trunc(rating)))
}

export function getMenuItemImageUrl(menuItem?: Pick<MenuItem, 'imageUrl'> | null) {
  const imageUrl = menuItem?.imageUrl?.trim()
  return imageUrl ? imageUrl : null
}

export function normalizeMenuItem(menuItem: MenuItem): MenuItem {
  const categorySlug = resolveMenuCategorySlug(menuItem.categorySlug, menuItem.category)

  return {
    ...menuItem,
    category: menuItem.category || categorySlug,
    categorySlug,
    sortOrder: getMenuItemSortOrder(menuItem),
    chilliRating: getMenuItemChilliRating(menuItem),
    imageUrl: getMenuItemImageUrl(menuItem),
    active: menuItem.active ?? true,
  }
}

export function sortMenuItems(menuItems: MenuItem[]) {
  return [...menuItems].sort((left, right) => {
    const orderDelta = getMenuItemSortOrder(left) - getMenuItemSortOrder(right)
    if (orderDelta !== 0) {
      return orderDelta
    }

    return left.name.localeCompare(right.name)
  })
}
