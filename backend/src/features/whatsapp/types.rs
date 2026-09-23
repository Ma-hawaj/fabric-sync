use serde::{Deserialize, Serialize};

/// Body for `POST /whatsapp/invoices/:id/messages`. The invoice image arrives
/// base64-encoded in JSON rather than as a multipart upload: it is small (an
/// A4 raster at phone resolution), and it keeps the axum extractors to `Json`
/// with only the usual body-limit bump on the route.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendInvoiceMessageRequest {
    /// The customer's number, as digits — the same shape a `wa.me` href uses:
    /// a full international number, country code first, no `+`. The service
    /// normalizes whatever is sent here before it goes anywhere.
    pub to: String,
    /// The invoice document captured to a PNG and base64-encoded, client-side
    /// (it needs a browser's rasterizer — the server only ever sees the file).
    pub media_base64: String,
    /// MIME type of the encoded file. Defaults to `image/png`, which is all
    /// the current client ever sends.
    #[serde(default = "default_mime_type")]
    pub mime_type: String,
}

fn default_mime_type() -> String {
    "image/png".to_string()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendInvoiceMessageResponse {
    /// The `wamid.` message id WhatsApp assigned to the outbound message.
    pub message_id: String,
}
