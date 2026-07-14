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
  
  // Thobe Style 1
  thobeType1?: string
  fPocket1?: string
  collar1?: string
  sleeve1?: string
  patti1?: string
  moreDetails1?: string

  // Thobe Style 2
  thobeType2?: string
  fPocket2?: string
  collar2?: string
  sleeve2?: string
  patti2?: string
  moreDetails2?: string

  // Thobe Style 3
  thobeType3?: string
  fPocket3?: string
  collar3?: string
  sleeve3?: string
  patti3?: string
  moreDetails3?: string

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
  mobileNo: string
  measurements: Measurement[]
}
