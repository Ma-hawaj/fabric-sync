import * as React from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface ChartCardProps {
  title: string
  description?: string
  /**
   * True when the period leaves nothing to draw. An empty plot with axes and
   * no marks reads as a bug; a sentence reads as an answer.
   */
  isEmpty?: boolean
  emptyLabel?: string
  /**
   * A background refetch. The previous render is held at reduced opacity
   * rather than swapped for a skeleton, so nothing jumps while it lands.
   */
  isFetching?: boolean
  className?: string
  children: React.ReactNode
}

export function ChartCard({
  title,
  description,
  isEmpty = false,
  emptyLabel = 'No data in this period.',
  isFetching = false,
  className,
  children,
}: ChartCardProps) {
  return (
    <Card className={cn('gap-4', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <p className="flex h-[240px] items-center justify-center text-center text-sm text-muted-foreground">
            {emptyLabel}
          </p>
        ) : (
          <div
            className={cn(
              'transition-opacity duration-200',
              isFetching && 'opacity-60',
            )}
          >
            {children}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
