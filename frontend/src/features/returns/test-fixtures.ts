import type { ReturnableLine, ReturnContext } from './types/returns'

export const PRODUCT: ReturnableLine = {
  lineId: 'product-1',
  kind: 'product',
  description: 'Buttons',
  quantity: 3,
  returnedQuantity: 0,
  creditedAmount: 0,
  lineTotal: 10,
  creditLimit: 10,
  collected: true,
  canRestock: true,
}

export const CONTEXT: ReturnContext = {
  settlement: {
    amountPaid: 30,
    amountCredited: 50,
    cashRefunded: 0,
    giftCardRefunded: 0,
    netTotal: 50,
    netAmountPaid: 30,
    netGiftCardRedeemed: 70,
    balanceDue: 0,
    refundDue: 50,
    paymentStatus: 'paid',
  },
  lines: [PRODUCT],
  returns: [],
  refunds: [],
  giftCards: [{ id: 'gift-1', code: 'GC-1', refundableAmount: 70 }],
}
