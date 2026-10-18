import type {
  ReturnableLine,
  ReturnContext,
  CancellationContext,
} from './types/returns'

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
  outcome: 'active',
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

export const CANCELLATION: CancellationContext = {
  order: {
    orderId: 'order-1',
    invoiceId: 'invoice-1',
    status: 'pending',
    outcome: 'active',
    productionStarted: false,
    materialSource: 'shop',
    materialAmount: 3.5,
    canRestoreMaterial: true,
    stockLocation: 'Manama',
  },
  invoice: {
    ...CONTEXT,
    settlement: { ...CONTEXT.settlement, balanceDue: 80, refundDue: 0 },
    lines: [
      {
        ...PRODUCT,
        lineId: 'order-1',
        kind: 'order',
        quantity: 1,
        creditLimit: 90,
        lineTotal: 100,
        collected: false,
        canRestock: false,
      },
    ],
  },
}
