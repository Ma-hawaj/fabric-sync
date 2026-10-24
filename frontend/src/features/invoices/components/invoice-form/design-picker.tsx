import { useState } from 'react'
import { ChevronDownIcon, SearchIcon, ShirtIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { DesignOptionGrid } from '@/features/design-options/components/design-option-grid'
import {
  designOptionImageSrc,
  selectCategoryOptions,
} from '@/features/design-options/hooks/use-design-options'
import type { DesignOption } from '@/features/design-options/types/design-option'
import { CURRENCY } from '@/lib/currency'
import type { InvoiceFormApi } from '../../types/invoice-form'

export function DesignPicker({
  form,
  name,
  category,
  label,
  options,
}: {
  form: InvoiceFormApi
  name: string
  category: string
  label: string
  options: DesignOption[]
}) {
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState('')
  const [search, setSearch] = useState('')
  const choices = selectCategoryOptions(options, category)
  return (
    <form.Field name={name as never}>
      {(field: any) => {
        const stored: string = field.state.value ?? ''
        const saved = options.find(
          (option) => option.category === category && option.slug === stored,
        )
        const image = saved ? designOptionImageSrc(saved) : null
        const selected = options.find(
          (option) => option.category === category && option.slug === selection,
        )
        const items = [
          {
            id: '',
            label: category === 'emd' ? 'None' : 'Not specified',
            image: null,
          },
          ...choices.map((option) => ({
            id: option.slug,
            label: `${option.label}${option.cost > 0 ? ` (+${CURRENCY} ${option.cost.toFixed(2)})` : ' (included)'}`,
            image: designOptionImageSrc(option),
          })),
        ].filter((option) =>
          option.label.toLowerCase().includes(search.toLowerCase()),
        )
        return (
          <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
              if (nextOpen) {
                setSelection(stored)
                setSearch('')
              }
              setOpen(nextOpen)
            }}
          >
            <DialogTrigger
              render={
                <Button
                  id={name}
                  type="button"
                  variant="outline"
                  aria-label={`Choose ${label}`}
                  className="h-auto min-h-20 w-full justify-start gap-3 whitespace-normal p-3 text-start"
                />
              }
            >
              {image ? (
                <img
                  src={image}
                  alt=""
                  className="size-12 shrink-0 rounded bg-muted/30 object-contain"
                />
              ) : (
                <span className="flex size-12 shrink-0 items-center justify-center rounded bg-muted/50 text-muted-foreground">
                  <ShirtIcon className="size-6" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted-foreground">
                  {label}
                </span>
                <span className="block break-words text-sm font-medium">
                  {saved?.label ??
                    (stored || (category === 'emd' ? 'None' : 'Not specified'))}
                </span>
                {saved && saved.cost > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    +{CURRENCY} {saved.cost.toFixed(2)}
                  </span>
                )}
                {stored && !saved && (
                  <span className="block text-xs text-destructive">
                    Review saved design
                  </span>
                )}
                {saved && !saved.isActive && (
                  <span className="block text-xs text-muted-foreground">
                    Retired design
                  </span>
                )}
              </span>
              <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
            </DialogTrigger>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Choose {label}</DialogTitle>
                <DialogDescription>
                  Select a design. Any additional cost is shown with the option.
                </DialogDescription>
              </DialogHeader>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label={`Search ${label} designs`}
                  placeholder="Search designs..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="ps-9"
                />
              </div>
              {stored && !saved && (
                <p className="text-sm text-destructive">
                  Saved value “{stored}” is not in the catalog. Choose a design
                  or clear it to calculate pricing.
                </p>
              )}
              {saved && !saved.isActive && (
                <p className="text-sm text-muted-foreground">
                  Saved option {saved.label} is retired. You can keep it or
                  choose an active design.
                </p>
              )}
              {items.length ? (
                <DesignOptionGrid
                  options={items}
                  value={selection}
                  onChange={setSelection}
                  columns={3}
                  density="comfortable"
                />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No designs match your search.
                </p>
              )}
              <div className="border-t pt-4">
                <DialogFooter>
                  <p className="me-auto self-center text-sm text-muted-foreground">
                    Selected: {selected?.label ?? (selection || 'None')}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      field.handleChange(selection)
                      setOpen(false)
                    }}
                  >
                    Apply design
                  </Button>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        )
      }}
    </form.Field>
  )
}
