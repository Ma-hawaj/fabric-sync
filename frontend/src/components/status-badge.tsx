import type { ComponentProps } from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const statusBadgeVariants = cva('bg-card dark:bg-card', {
  variants: {
    tone: {
      neutral: 'border-muted-foreground/20 text-muted-foreground',
      success: 'border-success/20 text-success',
      warning: 'border-warning/20 text-warning',
      info: 'border-info/20 text-info',
      danger: 'border-destructive/20 text-destructive',
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
