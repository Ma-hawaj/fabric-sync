import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useTheme } from '@/lib/theme'

const options = [
  { value: 'light' as const, label: 'Light', icon: SunIcon },
  { value: 'dark' as const, label: 'Dark', icon: MoonIcon },
  { value: 'system' as const, label: 'System', icon: MonitorIcon },
]

export function ThemeMenuItems() {
  const { theme, setTheme } = useTheme()

  return (
    <>
      {options.map(({ value, label, icon: Icon }) => (
        <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
          <Icon />
          {label}
          {theme === value && <CheckIcon className="ms-auto" />}
        </DropdownMenuItem>
      ))}
    </>
  )
}
