export interface Measurement {
  id: string
  customerId: string
  date: Date

  // Body Dimensions
  lengthFl?: number
  lengthBl?: number
  chest?: number
  waist?: number
  hips?: number
  shoulder?: number
  sleeveLength?: number
  neck?: number
  openHand?: number
  cuffling?: string

  // Extra Details
  fullBody?: string
  chestUp?: number
  openFold?: string
  cuffWidth?: number
  neckWidth?: number
  aramHole?: number
  sleeveHaffButton?: string
  buttonFold?: string
  fo?: string
  foWidth?: number
  frantPocketLength?: number
  farntPocketLengthByWidth?: string
  sidePocket?: string
  mobilePocketLengthByWidth?: string
}

export interface Customer {
  id: string
  name: string
  nameArabic?: string
  mobileNo: string
  measurements: Measurement[]
}
