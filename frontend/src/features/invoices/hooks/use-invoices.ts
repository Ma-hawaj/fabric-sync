import { useQuery } from '@tanstack/react-query'
import type { Invoice } from '../types/invoices'

const MOCK_INVOICES: Invoice[] = [
  {
    id: 'INV-001',
    customerName: 'Ahmed Al-Mansoori',
    customerMobile: '+971-50-1234567',
    itemCount: 2,
    materials: ['Cotton Blend', 'Silk'],
    totalPrice: 480.0,
  },
  {
    id: 'INV-002',
    customerName: 'Fatima Al-Farsi',
    customerMobile: '+971-55-9876543',
    itemCount: 1,
    materials: ['Polyester'],
    totalPrice: 210.5,
  },
  {
    id: 'INV-003',
    customerName: 'Zayed Al-Hashimi',
    customerMobile: '+971-52-1112223',
    itemCount: 3,
    materials: ['Wool', 'Linen', 'Cotton'],
    totalPrice: 915.75,
  },
  {
    id: 'INV-004',
    customerName: 'Mariam Al-Suwaidi',
    customerMobile: '+971-56-2223344',
    itemCount: 1,
    materials: ['Cashmere Blend'],
    totalPrice: 650.0,
  },
  {
    id: 'INV-005',
    customerName: 'Khalid Al-Nuaimi',
    customerMobile: '+971-50-3334455',
    itemCount: 2,
    materials: ['Denim', 'Corduroy'],
    totalPrice: 340.25,
  },
  {
    id: 'INV-006',
    customerName: 'Noura Al-Shamsi',
    customerMobile: '+971-55-4445566',
    itemCount: 1,
    materials: ['Satin'],
    totalPrice: 280.0,
  },
  {
    id: 'INV-007',
    customerName: 'Saeed Al-Ketbi',
    customerMobile: '+971-52-5556677',
    itemCount: 4,
    materials: ['Velvet', 'Tweed', 'Wool', 'Cotton Blend'],
    totalPrice: 1240.5,
  },
  {
    id: 'INV-008',
    customerName: 'Hessa Al-Marri',
    customerMobile: '+971-56-6667788',
    itemCount: 1,
    materials: ['Lace'],
    totalPrice: 195.0,
  },
  {
    id: 'INV-009',
    customerName: 'Rashid Al-Falasi',
    customerMobile: '+971-50-7778899',
    itemCount: 2,
    materials: ['Organic Cotton', 'Bamboo Fiber'],
    totalPrice: 410.0,
  },
  {
    id: 'INV-010',
    customerName: 'Aisha Al-Zaabi',
    customerMobile: '+971-55-8889900',
    itemCount: 1,
    materials: ['Hemp'],
    totalPrice: 175.5,
  },
  {
    id: 'INV-011',
    customerName: 'Sultan Al-Dhaheri',
    customerMobile: '+971-52-9990011',
    itemCount: 3,
    materials: ['Microfiber', 'Spandex Blend', 'Recycled Polyester'],
    totalPrice: 560.0,
  },
  {
    id: 'INV-012',
    customerName: 'Latifa Al-Rumaithi',
    customerMobile: '+971-56-0001122',
    itemCount: 1,
    materials: ['Jacquard'],
    totalPrice: 320.0,
  },
  {
    id: 'INV-013',
    customerName: 'Omar Al-Junaibi',
    customerMobile: '+971-50-1122334',
    itemCount: 2,
    materials: ['Cotton', 'Silk'],
    totalPrice: 505.25,
  },
  {
    id: 'INV-014',
    customerName: 'Shamma Al-Ameri',
    customerMobile: '+971-55-2233445',
    itemCount: 1,
    materials: ['Wool'],
    totalPrice: 390.0,
  },
  {
    id: 'INV-015',
    customerName: 'Hamdan Al-Mazrouei',
    customerMobile: '+971-52-3344556',
    itemCount: 2,
    materials: ['Linen', 'Cotton Blend'],
    totalPrice: 445.0,
  },
]

export function useInvoices() {
  return useQuery({
    queryKey: ['invoices'],
    queryFn: async () => {
      // Mock delay to simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500))
      return MOCK_INVOICES
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
