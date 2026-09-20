export interface Measurement {
  id: string
  customerId: string
  date: Date

  // Body Dimensions
  lengthFl?: number | null
  lengthBl?: number | null
  chest?: number | null
  waist?: number | null
  hips?: number | null
  shoulder?: number | null
  sleeveLength?: number | null
  neck?: number | null
  openHand?: number | null

  // Extra Details
  chestUp?: number | null
  cuffWidth?: number | null
  neckWidth?: number | null
  aramHole?: number | null
  foWidth?: number | null
  frantPocketLength?: number | null
  farntPocketLengthByWidth?: string | null
  sidePocket?: string | null
  mobilePocketLengthByWidth?: string | null
}

export interface Customer {
  id: string
  name: string
  nameArabic?: string
  mobileNo: string
  measurements: Measurement[]
}
