import { useListQuery } from '@/hooks/use-list-query'
import { apiBaseUrl } from '@/lib/api'
import type { DesignOption } from '../types/design-option'

const ENDPOINT = '/design-options'
const QUERY_KEY = 'design-options'
const ALL = new URLSearchParams()

/**
 * The whole design catalog, unpaginated — pickers need every option and the
 * admin page lists them all behind client-side filters, so no page of rows
 * will do. An empty request omits `perPage`, which is what tells the API not
 * to page.
 */
export function useDesignOptions() {
  return useListQuery<DesignOption>({
    endpoint: ENDPOINT,
    queryKey: QUERY_KEY,
    searchParams: ALL,
  })
}

/**
 * One category's picker options: active rows only, in catalog order. A stored
 * value that matches nothing (legacy free text like "Saudi") is left to the
 * caller to surface — it still prints as text on the documents.
 */
export function selectCategoryOptions(
  options: DesignOption[],
  category: string,
): DesignOption[] {
  return options
    .filter((option) => option.category === category && option.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
}

/** Absolute-enough src for an `<img>`: same origin in prod, the Vite `/api` proxy in dev. */
export function designOptionImageSrc(option: DesignOption): string | null {
  if (!option.hasImage) {
    return null
  }
  return `${apiBaseUrl}${option.imageUrl}`
}
