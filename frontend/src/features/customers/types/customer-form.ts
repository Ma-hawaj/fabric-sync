export interface CustomerFormValues {
  name: string
  mobileNo: string
}

export function createEmptyCustomerForm(): CustomerFormValues {
  return {
    name: '',
    mobileNo: '',
  }
}
