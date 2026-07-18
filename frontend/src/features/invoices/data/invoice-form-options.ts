export interface MaterialOption {
  id: string
  name: string
  code: string
  storageLocation: string
  availableMeters: number
  pricePerMeter: number
}

// Mocked — the materials feature has a schema table but no backend routes
// yet, same as orders/invoices.
export const MATERIALS: MaterialOption[] = [
  {
    id: 'mat-1',
    name: 'Cotton Poplin — White',
    code: 'FB-CTN-WHT-01',
    storageLocation: 'Warehouse A / Shelf 3',
    availableMeters: 120,
    pricePerMeter: 18,
  },
  {
    id: 'mat-2',
    name: 'Wool Blend — Grey',
    code: 'FB-WOL-GRY-02',
    storageLocation: 'Store Room B',
    availableMeters: 45,
    pricePerMeter: 32,
  },
  {
    id: 'mat-3',
    name: 'Egyptian Cotton — Ivory',
    code: 'FB-CTN-IVR-03',
    storageLocation: 'Warehouse A / Shelf 5',
    availableMeters: 80,
    pricePerMeter: 24,
  },
  {
    id: 'mat-4',
    name: 'Linen Blend — Sand',
    code: 'FB-LIN-SND-04',
    storageLocation: 'Store Room B',
    availableMeters: 60,
    pricePerMeter: 21,
  },
]

export const BRANCHES = [
  'Riyadh — Olaya',
  'Jeddah — Tahlia',
  'Dammam — Corniche',
]

export const THOBE_TYPES = ['Saudi', 'Emirati', 'Kuwaiti', 'Qatari']
export const FRONT_POCKETS = ['None', 'Single', 'Double']
export const COLLARS = ['Mandarin', 'Classic Round', 'Banded', 'Spread']
export const SLEEVES = ['Long Straight', 'Tapered', '3/4 Length']
export const PATTIS = ['Plain', 'Stitched', 'Embroidered']
