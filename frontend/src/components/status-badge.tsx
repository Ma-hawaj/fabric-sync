import type { ComponentProps } from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const statusBadgeVariants = cva('', {
  variants: {
    tone: {
      neutral:
        'border-muted-foreground/20 bg-muted-foreground/10 text-muted-foreground dark:bg-muted-foreground/10',
      success:
        'border-success/20 bg-success/10 text-success dark:bg-success/10',
      warning:
        'border-warning/20 bg-warning/10 text-warning dark:bg-warning/10',
      info: 'border-info/20 bg-info/10 text-info dark:bg-info/10',
      danger:
        'border-destructive/20 bg-destructive/10 text-destructive dark:bg-destructive/10',
    },
  },
  defaultVariants: {
    tone: 'neutral',
  },
})

export type StatusTone = NonNullable<
  VariantProps<typeof statusBadgeVariants>['tone']
>

/** Semantic status colors remain separate from the workspace's brand accent. */
export function StatusBadge({
  tone = 'neutral',
  className,
  ...props
}: Omit<ComponentProps<typeof Badge>, 'variant'> & { tone?: StatusTone }) {
  return (
    <Badge
      {...props}
      variant="outline"
      data-tone={tone}
      className={cn(statusBadgeVariants({ tone }), className)}
    />
  )
}
