import * as React from 'react'

import { cn } from '@/lib/utils'

function Table({
  className,
  containerClassName,
  containerRef,
  ...props
}: React.ComponentProps<'table'> & {
  containerClassName?: string
  containerRef?: React.Ref<HTMLDivElement>
}) {
  return (
    <div
      data-slot="table-container"
      ref={containerRef}
      className={cn('relative w-full overflow-x-auto', containerClassName)}
    >
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        '[&_tr]:border-b group-data-[density]/data-table:[&>tr]:[--table-row-background:var(--muted)]',
        className,
      )}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        'border-t bg-muted/50 font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted',
        'group-data-[density]/data-table:bg-(--table-row-background) group-data-[density]/data-table:[--table-row-background:var(--background)] group-data-[density]/data-table:even:[--table-row-background:color-mix(in_oklch,var(--muted)_28%,var(--background))] group-data-[density]/data-table:hover:bg-(--table-row-background) group-data-[density]/data-table:hover:[--table-row-background:var(--muted)]',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-10 px-2 text-start align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pe-0',
        'group-data-[density]/data-table:h-9 group-data-[density]/data-table:bg-muted group-data-[density]/data-table:px-2.5 group-data-[density]/data-table:text-xs',
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pe-0',
        'group-data-[density]/data-table:overflow-hidden group-data-[density]/data-table:px-2.5 group-data-[density]/data-table:text-ellipsis group-data-[density]/data-table:data-[pinned]:bg-(--table-row-background)',
        'group-data-[density=compact]/data-table:h-10 group-data-[density=compact]/data-table:py-1 group-data-[density=compact]/data-table:text-[0.8125rem]',
        'group-data-[density=comfortable]/data-table:h-12 group-data-[density=comfortable]/data-table:py-2.5 group-data-[density=comfortable]/data-table:text-sm',
        className,
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
