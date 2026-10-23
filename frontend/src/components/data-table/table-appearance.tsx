import * as React from 'react'

export type TableDensity = 'compact' | 'comfortable'
export const TableAppearanceContext = React.createContext<{
  density: TableDensity
  setDensity: (density: TableDensity) => void
}>({ density: 'compact', setDensity: () => {} })

export function useTableAppearance() {
  return React.useContext(TableAppearanceContext)
}
