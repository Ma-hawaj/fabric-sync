import type { ComponentType } from 'react'
import { MoreHorizontalIcon } from 'lucide-react'
import type { Menu } from '@base-ui/react/menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface RowActionItem {
  label: string
  icon?: ComponentType<{ className?: string }>
  onClick?: () => void
  disabled?: boolean
  destructive?: boolean
  separatorBefore?: boolean
  render?: Menu.Item.Props['render']
}

export function RowActions({
  items,
  className,
  align = 'end',
}: {
  items: RowActionItem[]
  className?: string
  align?: 'start' | 'end' | 'center'
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30',
          className,
        )}
        aria-label="Actions"
      >
        <MoreHorizontalIcon className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-44">
        {items.map((item, index) => {
          const Icon = item.icon
          return (
            <div key={index}>
              {item.separatorBefore && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onClick={item.onClick}
                disabled={item.disabled}
                variant={item.destructive ? 'destructive' : 'default'}
                render={item.render}
              >
                {Icon && <Icon className="h-4 w-4" />}
                {item.label}
              </DropdownMenuItem>
            </div>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
