import * as React from 'react'
import { useDataTable } from '@/hooks/use-data-table'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { getCustomerColumns } from './components/customer-columns'
import { useCustomers } from './hooks/use-customers'
import type { Customer } from './types/customers'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { Ruler, ShieldAlert, Sparkles, User, Calendar } from 'lucide-react'

export function CustomersPage() {
  const { data: customers = [], isLoading } = useCustomers()
  const [selectedCustomer, setSelectedCustomer] = React.useState<Customer | null>(null)
  const [activeMeasurementId, setActiveMeasurementId] = React.useState<string | null>(null)

  const handleViewDetails = React.useCallback((customer: Customer) => {
    setSelectedCustomer(customer)
    if (customer.measurements.length > 0) {
      setActiveMeasurementId(customer.measurements[0].id)
    } else {
      setActiveMeasurementId(null)
    }
  }, [])

  const columns = React.useMemo(() => getCustomerColumns(handleViewDetails), [handleViewDetails])

  const { table } = useDataTable({
    data: customers,
    columns,
    manualFiltering: false,
    manualSorting: false,
    manualPagination: false,
  })

  const activeMeasurement = React.useMemo(() => {
    if (!selectedCustomer || selectedCustomer.measurements.length === 0) return null
    return (
      selectedCustomer.measurements.find((m) => m.id === activeMeasurementId) ??
      selectedCustomer.measurements[0]
    )
  }, [selectedCustomer, activeMeasurementId])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
        <p className="text-muted-foreground">
          View all registered customers and inspect their measurement histories.
        </p>
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted-foreground py-10">
          Loading customers...
        </div>
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}

      <Sheet
        open={selectedCustomer !== null}
        onOpenChange={(open) => !open && setSelectedCustomer(null)}
      >
        <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:w-3/4 data-[side=right]:sm:max-w-[75vw] overflow-y-auto bg-background/95 backdrop-blur-md border-s shadow-2xl">
          {selectedCustomer && (
            <div className="space-y-6 pb-8">
              <SheetHeader className="border-b pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400">
                    <User className="h-5 w-5" />
                  </div>
                  <div>
                    <SheetTitle className="text-xl font-bold tracking-tight">
                      {selectedCustomer.name}
                    </SheetTitle>
                    <SheetDescription className="text-muted-foreground mt-0.5">
                      Phone: {selectedCustomer.mobileNo}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              {selectedCustomer.measurements.length === 0 ? (
                <div className="rounded-lg border border-yellow-200/50 bg-yellow-50/50 p-4 text-center dark:bg-yellow-950/10 dark:border-yellow-900/30">
                  <ShieldAlert className="mx-auto h-8 w-8 text-yellow-600 dark:text-yellow-400" />
                  <p className="mt-2 text-sm font-medium text-yellow-800 dark:text-yellow-300">
                    No measurements on file
                  </p>
                  <p className="text-xs text-yellow-600/80 dark:text-yellow-400/80 mt-1">
                    This customer doesn't have any measurement records recorded yet.
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
                      {selectedCustomer.measurements.map((m, idx) => (
                        <button
                          key={m.id}
                          onClick={() => setActiveMeasurementId(m.id)}
                          className={cn(
                            "px-3 py-2 text-xs font-medium rounded-md whitespace-nowrap transition-all duration-150 border",
                            activeMeasurement?.id === m.id
                              ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                              : "bg-card hover:bg-muted text-muted-foreground border-border/60 hover:text-foreground"
                          )}
                        >
                          {idx === 0 ? (
                            <span className="flex items-center gap-1">
                              <Sparkles className="h-3 w-3" />
                              Current
                            </span>
                          ) : (
                            `Previous #${selectedCustomer.measurements.length - idx}`
                          )}{' '}
                          ({new Date(m.date).toLocaleDateString()})
                        </button>
                      ))}
                    </div>
                  </div>

                  {activeMeasurement && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-200">
                      {/* Section: Main Body Dimensions */}
                      <StyleSection title="Body Dimensions">
                        <MetricItem label="Length FL" value={activeMeasurement.lengthFl} />
                        <MetricItem label="Length BL" value={activeMeasurement.lengthBl} />
                        <MetricItem label="Chest" value={activeMeasurement.chest} />
                        <MetricItem label="Waist" value={activeMeasurement.waist} />
                        <MetricItem label="Hips" value={activeMeasurement.hips} />
                        <MetricItem label="Shoulder" value={activeMeasurement.shoulder} />
                        <MetricItem label="Sleeve Length" value={activeMeasurement.sleeveLength} />
                        <MetricItem label="Neck" value={activeMeasurement.neck} />
                        <MetricItem label="Arm Hole (Aram)" value={activeMeasurement.aramHole} />
                        <MetricItem label="Open Hand" value={activeMeasurement.openHand} />
                        <MetricItem label="Cuff Width" value={activeMeasurement.cuffWidth} />
                        <MetricItem label="Cuffling Type" value={activeMeasurement.cuffling} />
                      </StyleSection>

                      {/* Section: Extra Customizations */}
                      <StyleSection title="Pocket & Fold Specifications">
                        <MetricItem label="Front Pocket Length" value={activeMeasurement.frantPocketLength} />
                        <MetricItem label="Front Pocket L x W" value={activeMeasurement.farntPocketLengthByWidth} />
                        <MetricItem label="Side Pocket" value={activeMeasurement.sidePocket} />
                        <MetricItem label="Mobile Pocket L x W" value={activeMeasurement.mobilePocketLengthByWidth} />
                        <MetricItem label="FO" value={activeMeasurement.fo} />
                        <MetricItem label="FO Width" value={activeMeasurement.foWidth} />
                        <MetricItem label="Open Fold" value={activeMeasurement.openFold} />
                        <MetricItem label="Button Fold" value={activeMeasurement.buttonFold} />
                      </StyleSection>

                      {/* Section: Tailoring Extra Info */}
                      {(activeMeasurement.fullBody || activeMeasurement.chestUp || activeMeasurement.neckWidth || activeMeasurement.sleeveHaffButton) && (
                        <StyleSection title="Additional Details">
                          <MetricItem label="Full Body Fit" value={activeMeasurement.fullBody} />
                          <MetricItem label="Chest Up" value={activeMeasurement.chestUp} />
                          <MetricItem label="Neck Width" value={activeMeasurement.neckWidth} />
                          <MetricItem label="Sleeve Half Button" value={activeMeasurement.sleeveHaffButton} />
                        </StyleSection>
                      )}

                      {/* Section: Thobe Styles */}
                      {activeMeasurement.thobeType1 && (
                        <StyleSection title="Thobe Style 1">
                          <MetricItem label="Style Type" value={activeMeasurement.thobeType1} />
                          <MetricItem label="Front Pocket" value={activeMeasurement.fPocket1} />
                          <MetricItem label="Collar" value={activeMeasurement.collar1} />
                          <MetricItem label="Sleeve" value={activeMeasurement.sleeve1} />
                          <MetricItem label="Patti" value={activeMeasurement.patti1} />
                          <div className="col-span-2 mt-1">
                            <span className="text-xs text-muted-foreground font-medium">More Details</span>
                            <p className="text-sm text-foreground mt-1 bg-muted/40 p-2.5 rounded border border-border/30 italic">
                              {activeMeasurement.moreDetails1 || "No extra details."}
                            </p>
                          </div>
                        </StyleSection>
                      )}

                      {activeMeasurement.thobeType2 && (
                        <StyleSection title="Thobe Style 2">
                          <MetricItem label="Style Type" value={activeMeasurement.thobeType2} />
                          <MetricItem label="Front Pocket" value={activeMeasurement.fPocket2} />
                          <MetricItem label="Collar" value={activeMeasurement.collar2} />
                          <MetricItem label="Sleeve" value={activeMeasurement.sleeve2} />
                          <MetricItem label="Patti" value={activeMeasurement.patti2} />
                          <div className="col-span-2 mt-1">
                            <span className="text-xs text-muted-foreground font-medium">More Details</span>
                            <p className="text-sm text-foreground mt-1 bg-muted/40 p-2.5 rounded border border-border/30 italic">
                              {activeMeasurement.moreDetails2 || "No extra details."}
                            </p>
                          </div>
                        </StyleSection>
                      )}

                      {activeMeasurement.thobeType3 && (
                        <StyleSection title="Thobe Style 3">
                          <MetricItem label="Style Type" value={activeMeasurement.thobeType3} />
                          <MetricItem label="Front Pocket" value={activeMeasurement.fPocket3} />
                          <MetricItem label="Collar" value={activeMeasurement.collar3} />
                          <MetricItem label="Sleeve" value={activeMeasurement.sleeve3} />
                          <MetricItem label="Patti" value={activeMeasurement.patti3} />
                          <div className="col-span-2 mt-1">
                            <span className="text-xs text-muted-foreground font-medium">More Details</span>
                            <p className="text-sm text-foreground mt-1 bg-muted/40 p-2.5 rounded border border-border/30 italic">
                              {activeMeasurement.moreDetails3 || "No extra details."}
                            </p>
                          </div>
                        </StyleSection>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function MetricItem({ label, value }: { label: string; value?: string | number }) {
  if (value === undefined || value === '') return null
  return (
    <div className="flex flex-col border-b border-border/30 pb-2">
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
      <span className="text-sm font-semibold text-foreground mt-0.5">{value}</span>
    </div>
  )
}

function StyleSection({ title, children }: { title: string; children: React.ReactNode }) {
  // Filters out null values so we don't render empty containers
  const validChildren = React.Children.toArray(children).filter(Boolean)
  if (validChildren.length === 0) return null

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4.5 shadow-sm space-y-3">
      <h4 className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1.5 pb-2 border-b border-border/30">
        <Ruler className="h-3.5 w-3.5" />
        {title}
      </h4>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">{children}</div>
    </div>
  )
}
