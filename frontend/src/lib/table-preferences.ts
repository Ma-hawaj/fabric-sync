import type { ColumnSizingState, VisibilityState } from '@tanstack/react-table'

export interface TablePreferences {
  visibility?: VisibilityState
  sizing?: ColumnSizingState
  pageSize?: number
}

export function tablePreferenceKey() {
  return `fabric-sync:table:${typeof window === 'undefined' ? '/' : window.location.pathname}`
}

export function readTablePreferences(): TablePreferences {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(tablePreferenceKey()) ?? '{}',
    )
    if (typeof value !== 'object' || !value || Array.isArray(value)) return {}
    const saved = value as TablePreferences
    return {
      visibility: Object.fromEntries(
        Object.entries(saved.visibility ?? {}).filter(
          ([, entry]) => typeof entry === 'boolean',
        ),
      ),
      sizing: Object.fromEntries(
        Object.entries(saved.sizing ?? {}).filter(
          ([, entry]) =>
            typeof entry === 'number' && entry >= 48 && entry <= 600,
        ),
      ),
      pageSize: [10, 20, 25, 30, 40, 50, 100].includes(saved.pageSize ?? 0)
        ? saved.pageSize
        : undefined,
    }
  } catch {
    return {}
  }
}

export function saveTablePreferences(
  key: string,
  preferences: TablePreferences,
) {
  try {
    localStorage.setItem(key, JSON.stringify(preferences))
  } catch {
    // Tables stay usable when browser storage is unavailable.
  }
}
