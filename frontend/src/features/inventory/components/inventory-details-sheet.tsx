import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MapPin, Package } from 'lucide-react'
import type { Material } from '../types/inventory'

interface InventoryDetailsSheetProps {
  material: Material | null
  onOpenChange: (open: boolean) => void
}

export function InventoryDetailsSheet({
  material,
  onOpenChange,
}: InventoryDetailsSheetProps) {
  const totalQuantity =
    material?.locations.reduce((sum, l) => sum + l.quantity, 0) ?? 0

  return (
    <Sheet
      open={material !== null}
      onOpenChange={(open) => !open && onOpenChange(false)}
    >
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:w-3/4 data-[side=right]:sm:max-w-[40vw] overflow-y-auto bg-background/95 backdrop-blur-md border-s shadow-2xl">
        {material && (
          <div className="space-y-6 pb-8">
            <SheetHeader className="border-b pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400">
                  <Package className="h-5 w-5" />
                </div>
                <div>
                  <SheetTitle className="text-xl font-bold tracking-tight">
                    {material.name}
                  </SheetTitle>
                  <SheetDescription className="text-muted-foreground mt-0.5">
                    SKU: {material.sku} &middot; {totalQuantity} {material.unit}{' '}
                    total
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                Stock by Location
              </h3>
              {material.locations.length === 0 ? (
                <div className="rounded-lg border border-border/60 bg-card p-4 text-center text-sm text-muted-foreground">
                  No stock recorded for this material.
                </div>
              ) : (
                <div className="rounded-xl border border-border/60 bg-card shadow-sm">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Location</TableHead>
                        <TableHead className="text-end">Quantity</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {material.locations.map((stock) => (
                        <TableRow key={stock.location}>
                          <TableCell className="font-medium">
                            {stock.location}
                          </TableCell>
                          <TableCell className="text-end">
                            {stock.quantity} {material.unit}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
