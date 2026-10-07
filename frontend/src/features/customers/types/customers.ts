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
  shoulderDown?: number | null
  sleeveLength?: number | null
  neck?: number | null
  openHand?: number | null
  openHandFolding?: number | null

  // Extra Details
  chestUp?: number | null
  cuffWidth?: number | null
  cuffling?: number | null
  neckWidth?: number | null
  armHole?: number | null
  foWidth?: number | null
  fo?: number | null
  sleeveHalf?: number | null
  button?: number | null
  buttonFold?: number | null
  openFold?: number | null
  bottom?: number | null
  bottomFolding?: number | null
  fullBody?: number | null
  frontPocketLength?: number | null
  frontPocketLengthByWidth?: string | null
  sidePocketLength?: number | null
  sidePocketLengthByWidth?: string | null
  mobilePocketLengthByWidth?: string | null
}

export interface Customer {
  id: string
  name: string
  nameArabic?: string
  mobileNo: string
  measurements: Measurement[]
}
