// WhatsApp helpers for the "send the invoice to the customer" flows (new
// invoice, all orders ready, resend). Sending itself happens on the backend
// through the WhatsApp Business Cloud API — the dialog captures the invoice
// document to a PNG and posts it to `/whatsapp/invoices/:id/messages`, and the
// server builds the caption — so there is nothing left here but turning a
// phone number into the digits WhatsApp accepts.

/** Digits only, which is the shape the WhatsApp API expects — `+`, dashes, and spaces dropped. */
export function normalizePhoneNumber(phone: string): string {
  return phone.replace(/\D/g, '')
}
