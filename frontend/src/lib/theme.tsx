import * as React from 'react'

type Theme = 'light' | 'dark' | 'system'
type ResolvedTheme = 'light' | 'dark'

type ThemeProviderState = {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const STORAGE_KEY = 'fabric-sync-theme'

const ThemeProviderContext = React.createContext<ThemeProviderState | null>(
  null,
)

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(getStoredTheme)
  const [resolvedTheme, setResolvedTheme] = React.useState<ResolvedTheme>(() =>
    theme === 'system' ? getSystemTheme() : theme,
  )

  React.useEffect(() => {
    const apply = (value: ResolvedTheme) => {
      document.documentElement.classList.toggle('dark', value === 'dark')
      setResolvedTheme(value)
    }

    if (theme !== 'system') {
      apply(theme)
      return
    }

    apply(getSystemTheme())
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply(getSystemTheme())
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = React.useCallback((next: Theme) => {
    if (next === 'system') {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, next)
    }
    setThemeState(next)
  }, [])

  const value = React.useMemo<ThemeProviderState>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  )

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export function useTheme() {
  const context = React.useContext(ThemeProviderContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
