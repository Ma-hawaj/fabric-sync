import { createContext, useContext } from 'react'

export interface InvoiceValidationTarget {
  path: string
  attempt: number
}

export const InvoiceWorkspaceContext = createContext<{
  activeOrderKey: string | null
  setActiveOrderKey: (key: string | null) => void
  validationTarget: InvoiceValidationTarget | null
} | null>(null)

export function useInvoiceWorkspace() {
  return useContext(InvoiceWorkspaceContext)
}

export function invoiceFieldPath(path: PropertyKey[]): string {
  return path.reduce<string>(
    (name, part) =>
      typeof part === 'number'
        ? `${name}[${part}]`
        : `${name ? `${name}.` : ''}${String(part)}`,
    '',
  )
}

export function focusInvoiceField(path: string) {
  const element = document.getElementById(path)
  const control = element?.matches('input, button, textarea, select')
    ? element
    : (element?.querySelector<HTMLElement>('input, textarea, select') ??
      element?.querySelector<HTMLElement>('button'))
  const target = control ?? element
  target?.focus()
  const scroll = target?.scrollIntoView
  scroll?.call(target, { block: 'center', behavior: 'smooth' })
}
