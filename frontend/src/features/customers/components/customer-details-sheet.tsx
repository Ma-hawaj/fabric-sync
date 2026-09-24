import * as React from 'react'
import { Button } from '@/components/ui/button'
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
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { printMeasurements } from '../lib/print-measurements'
import {
  Ruler,
  ShieldAlert,
  Sparkles,
  User,
  Calendar,
  Receipt,
  PrinterIcon,
} from 'lucide-react'
import { useCustomerOrders } from '@/features/orders/hooks/use-orders'
import { ThobDiagram } from './thob-diagram'
import { MEASUREMENT_GROUPS, fieldsInGroup } from '../data/measurement-fields'
import type { Customer } from '../types/customers'

interface CustomerDetailsSheetProps {
  customer: Customer | null
  onOpenChange: (open: boolean) => void
}

export function CustomerDetailsSheet({
  customer,
  onOpenChange,
}: CustomerDetailsSheetProps) {
  const [activeMeasurementId, setActiveMeasurementId] = React.useState<
    string | null
  >(null)
  const [hoveredField, setHoveredField] = React.useState<string | null>(null)

  React.useEffect(() => {
    setActiveMeasurementId(customer?.measurements[0]?.id ?? null)
  }, [customer])

  const { data: customerOrders } = useCustomerOrders(customer?.mobileNo)

  const activeMeasurement = React.useMemo(() => {
    if (!customer || customer.measurements.length === 0) return null
    return (
      customer.measurements.find((m) => m.id === activeMeasurementId) ??
      customer.measurements[0]
    )
  }, [customer, activeMeasurementId])

  const [isPrinting, setIsPrinting] = React.useState(false)

  const handlePrint = React.useCallback(() => {
    if (!customer || !activeMeasurement) return
    setIsPrinting(true)
    const pending = printMeasurements(customer, activeMeasurement)
    toast.promise(pending, {
      loading: 'Preparing measurements...',
      success: 'Print dialog opened.',
      error: 'Failed to generate measurement document.',
    })
    void pending.finally(() => setIsPrinting(false))
  }, [customer, activeMeasurement])

  return (
    <Sheet
      open={customer !== null}
      onOpenChange={(open) => !open && onOpenChange(false)}
    >
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:w-3/4 data-[side=right]:sm:max-w-[85vw] overflow-y-auto bg-background/95 backdrop-blur-md border-s shadow-2xl">
        {customer && (
          <div className="space-y-6 px-6 pb-8">
            <SheetHeader className="border-b pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-info/10 text-info">
                  <User className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <SheetTitle className="text-xl font-bold tracking-tight">
                    {customer.name}
                  </SheetTitle>
                  <SheetDescription className="text-muted-foreground mt-0.5">
                    Phone: {customer.mobileNo}
                  </SheetDescription>
                </div>
                {customer.measurements.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePrint}
                    disabled={isPrinting}
                    className="shrink-0"
                  >
                    <PrinterIcon className="mr-1.5 h-4 w-4" />
                    Print
                  </Button>
                )}
              </div>
            </SheetHeader>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1.5">
                <Receipt className="h-3.5 w-3.5" />
                Orders
              </h3>
              {customerOrders.length === 0 ? (
                <div className="rounded-lg border border-border/60 bg-card p-4 text-center text-sm text-muted-foreground">
                  No orders on file for this customer.
                </div>
              ) : (
                <div className="rounded-xl border border-border/60 bg-card shadow-sm">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Invoice Date</TableHead>
                        <TableHead>Material</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customerOrders.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell className="font-medium">
                            {order.invoiceId}
                          </TableCell>
                          <TableCell>
                            {order.invoiceDate.toLocaleDateString()}
                          </TableCell>
                          <TableCell>{order.material}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {customer.measurements.length === 0 ? (
              <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-center">
                <ShieldAlert className="mx-auto h-8 w-8 text-warning" />
                <p className="mt-2 text-sm font-medium text-warning">
                  No measurements on file
                </p>
                <p className="text-xs text-foreground mt-1">
                  This customer doesn't have any measurement records recorded
                  yet.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Measurement history selectors */}
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    Measurement Records
                  </h3>
                  <div className="flex flex-wrap gap-2 border-b border-border/40 pb-3">
                    {customer.measurements.map((m, idx) => (
                      <button
                        key={m.id}
                        onClick={() => setActiveMeasurementId(m.id)}
                        className={cn(
                          'px-3 py-2 text-xs font-medium rounded-md whitespace-nowrap transition-all duration-150 border',
                          activeMeasurement?.id === m.id
                            ? 'bg-info text-info-foreground border-info shadow-sm'
                            : 'bg-card hover:bg-muted text-muted-foreground border-border/60 hover:text-foreground',
                        )}
                      >
                        {idx === 0 ? (
                          <span className="flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            Current
                          </span>
                        ) : (
                          `Previous #${customer.measurements.length - idx}`
                        )}{' '}
                        ({new Date(m.date).toLocaleDateString()})
                      </button>
                    ))}
                  </div>
                </div>

                {activeMeasurement && (
                  <div className="@container animate-in fade-in slide-in-from-bottom-2 duration-200">
                    <div className="grid gap-5 @2xl:grid-cols-[minmax(0,1fr)_16rem] @4xl:grid-cols-[minmax(0,1fr)_21rem]">
                      <div className="order-2 space-y-6 @2xl:order-1">
                        {MEASUREMENT_GROUPS.map((group) => {
                          const recorded = fieldsInGroup(group.id)
                            .map((field) => ({
                              field,
                              value: activeMeasurement[field.name],
                            }))
                            .filter(
                              ({ value }) =>
                                value !== undefined &&
                                value !== null &&
                                value !== '',
                            )
                          if (recorded.length === 0) return null

                          return (
                            <StyleSection key={group.id} title={group.title}>
                              {recorded.map(({ field, value }) => (
                                <MetricItem
                                  key={field.name}
                                  label={field.label}
                                  value={value ?? undefined}
                                  onHover={() => setHoveredField(field.name)}
                                  onLeave={() => setHoveredField(null)}
                                />
                              ))}
                            </StyleSection>
                          )
                        })}
                      </div>

                      <aside className="order-1 h-fit rounded-xl border border-border/60 bg-card p-3 shadow-sm @2xl:order-2 @2xl:sticky @2xl:top-4">
                        <ThobDiagram
                          activeField={hoveredField}
                          values={activeMeasurement}
                          onSelectField={(name) => setHoveredField(name)}
                        />
                        <p className="mt-1 text-center text-xs text-muted-foreground">
                          Hover a measurement to locate it on the thob.
                        </p>
                      </aside>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function MetricItem({
  label,
  value,
  onHover,
  onLeave,
}: {
  label: string
  value?: string | number
  onHover?: () => void
  onLeave?: () => void
}) {
  if (value === undefined || value === '') return null
  return (
    <div
      className="flex flex-col border-b border-border/30 pb-2 transition-colors hover:border-info/60"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
      <span className="text-sm font-semibold text-foreground mt-0.5">
        {value}
      </span>
    </div>
  )
}

function StyleSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  // Filters out null values so we don't render empty containers
  const validChildren = React.Children.toArray(children).filter(Boolean)
  if (validChildren.length === 0) return null

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4.5 shadow-sm space-y-3">
      <h4 className="text-xs font-bold uppercase tracking-wider text-info flex items-center gap-1.5 pb-2 border-b border-border/30">
        <Ruler className="h-3.5 w-3.5" />
        {title}
      </h4>
      <div className="grid grid-cols-3 gap-x-4 gap-y-3.5">{children}</div>
    </div>
  )
}
