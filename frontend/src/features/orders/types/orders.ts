// One row of GET /orders — an order line joined with its invoice, customer,
// and material. invoiceDate arrives as an ISO date string and is parsed to a
// Date in use-orders.ts for the table's date-range filter.
export interface Order {
  id: string
  invoiceId: string
  invoiceDate: Date
  measurementId: string
  customerName: string
  customerMobile: string
  material: string
  materialAmount: number
  price: number
}
