import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from '@/components/theme-provider'
import { Toaster } from './toaster'

vi.mock('sonner', () => ({
  Toaster: ({ theme }: { theme: string }) => (
    <output data-testid="toast-theme">{theme}</output>
  ),
}))

function Harness() {
  const { setTheme } = useTheme()
  return (
    <>
      <button onClick={() => setTheme('dark')}>Dark appearance</button>
      <button onClick={() => setTheme('light')}>Light appearance</button>
      <Toaster />
    </>
  )
}

describe('app toaster theme', () => {
  it('loads the saved app theme and follows changes from our theme provider', () => {
    localStorage.setItem('fabric-sync-theme', 'dark')
    render(
      <ThemeProvider defaultTheme="light">
        <Harness />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('toast-theme').textContent).toBe('dark')
    fireEvent.click(screen.getByRole('button', { name: 'Light appearance' }))
    expect(screen.getByTestId('toast-theme').textContent).toBe('light')
    fireEvent.click(screen.getByRole('button', { name: 'Dark appearance' }))
    expect(screen.getByTestId('toast-theme').textContent).toBe('dark')
  })
})
