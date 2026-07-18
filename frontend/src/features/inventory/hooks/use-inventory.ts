import { useQuery } from '@tanstack/react-query'
import type { Material } from '../types/inventory'

const MOCK_MATERIALS: Material[] = [
  {
    id: 'MAT-001',
    name: 'Cotton',
    sku: 'CTN-100',
    unit: 'meters',
    locations: [
      { location: 'Main Warehouse', quantity: 320 },
      { location: 'Downtown Branch', quantity: 45 },
    ],
  },
  {
    id: 'MAT-002',
    name: 'Wool',
    sku: 'WL-200',
    unit: 'meters',
    locations: [
      { location: 'Main Warehouse', quantity: 120 },
      { location: 'Downtown Branch', quantity: 60 },
      { location: 'Airport Branch', quantity: 15 },
    ],
  },
  {
    id: 'MAT-003',
    name: 'Silk',
    sku: 'SLK-300',
    unit: 'meters',
    locations: [{ location: 'Main Warehouse', quantity: 40 }],
  },
  {
    id: 'MAT-004',
    name: 'Linen',
    sku: 'LNN-400',
    unit: 'meters',
    locations: [
      { location: 'Downtown Branch', quantity: 90 },
      { location: 'Airport Branch', quantity: 25 },
    ],
  },
  {
    id: 'MAT-005',
    name: 'Polyester',
    sku: 'PLY-500',
    unit: 'meters',
    locations: [
      { location: 'Main Warehouse', quantity: 210 },
      { location: 'Airport Branch', quantity: 75 },
    ],
  },
  {
    id: 'MAT-006',
    name: 'Cashmere Blend',
    sku: 'CSH-600',
    unit: 'meters',
    locations: [{ location: 'Downtown Branch', quantity: 12 }],
  },
  {
    id: 'MAT-007',
    name: 'Denim',
    sku: 'DNM-700',
    unit: 'meters',
    locations: [
      { location: 'Main Warehouse', quantity: 150 },
      { location: 'Downtown Branch', quantity: 30 },
      { location: 'Airport Branch', quantity: 0 },
    ],
  },
]

export function useInventory() {
  return useQuery({
    queryKey: ['inventory'],
    queryFn: async () => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      return MOCK_MATERIALS
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
