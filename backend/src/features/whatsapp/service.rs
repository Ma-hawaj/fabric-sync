//! Sends the customer-facing invoice image through Meta's WhatsApp Business
//! Cloud API.
//!
//! The flow is upload-then-send: the client captures `GET /invoices/:id/document`
//! to a PNG (that needs a browser's rasterizer, so the frontend does it) and
//! posts the file here; `send_invoice_image` uploads it to the Cloud API's
//! `/media` endpoint and immediately sends it to one recipient's `/messages`.
//! An uploaded media id is valid for 30 days, so there is nothing to cache.
//!
//! Two WhatsApp constraints shape this endpoint:
//! - The recipient number must be full international digits, country code first
//!   (the `wa.me` shape), which is what `normalize_recipient` enforces.
//! - A **plain** (non-template) image message is only deliverable inside the
//!   24-hour customer-service window, i.e. after the customer has written to
//!   this number. Outside it, Whatsapp rejects the send — the error's own
//!   `error.message` is passed straight through so the client can tell the
//!   operator what happened (a template message with a fixed image header is
//!   the alternative, but it cannot carry a per-invoice image, so it isn't
//!   wired here).
//!
//! Credentials come from `Config`, which builds this client as `None` unless
//! `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN` are both set — the
//! endpoint then fails fast rather than the whole server refusing to boot.

use base64::Engine;
use serde::Deserialize;

use crate::{
    config::{Config, InvoiceBranding},
    document::{format_amount, CURRENCY},
    error::AppError,
    features::invoices::types::InvoiceDetail,
};

/// WhatsApp's own error envelope; its `error.message` is what gets surfaced.
#[derive(Deserialize)]
struct GraphErrorEnvelope {
    error: Option<GraphError>,
}

#[derive(Deserialize)]
struct GraphError {
    message: String,
}

#[derive(Deserialize)]
struct MediaUploadResponse {
    id: String,
}

#[derive(Deserialize)]
struct SendMessageResponse {
    #[serde(default)]
    messages: Vec<MessageInfo>,
}

#[derive(Deserialize)]
struct MessageInfo {
    id: String,
}

/// The Cloud API caps image messages at 5 MB, so that is the decode guard too
/// (the JSON body limit on the route is sized to the ~6.7 MB base64 that a
/// 5 MB file produces).
const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;

/// A full international number is the only shape WhatsApp accepts. Anything
/// non-numeric is stripped (`+`, dashes, spaces…); 8–15 digits afterwards
/// passes, which is roughly the international range.
pub(crate) fn normalize_recipient(to: &str) -> Result<String, AppError> {
    let digits: String = to.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if !(8..=15).contains(&digits.len()) {
        return Err(AppError::BadRequest(
            "the recipient must be a full international phone number (digits only, country code first)"
                .to_string(),
        ));
    }
    Ok(digits)
}

fn normalize_mime(mime_type: &str) -> Result<String, AppError> {
    let mime_type = mime_type.trim().to_ascii_lowercase();
    if mime_type.starts_with("image/") {
        Ok(mime_type)
    } else {
        Err(AppError::BadRequest(format!(
            "{mime_type} is not an image type WhatsApp can send"
        )))
    }
}

fn decode_invoice_image(media_base64: &str) -> Result<Vec<u8>, AppError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(media_base64)
        .map_err(|_| AppError::BadRequest("the invoice image is not valid base64".to_string()))?;
    if bytes.is_empty() {
        return Err(AppError::BadRequest(
            "the invoice image is empty".to_string(),
        ));
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(AppError::BadRequest(format!(
            "the invoice image is too large — WhatsApp's cap is {} bytes",
            MAX_IMAGE_BYTES
        )));
    }
    Ok(bytes)
}

/// The short caption under the image. Built server-side from the invoice the
/// backend already looks up, so no display text is ever trusted from the
/// client — the image itself carries the detail.
pub(crate) fn invoice_caption(business_name: &str, invoice_number: i64, total: f64) -> String {
    format!(
        "{business_name} — Invoice {invoice_number} — total {} {CURRENCY}",
        format_amount(total),
    )
}

#[derive(Clone, Debug)]
pub struct WhatsAppClient {
    http: reqwest::Client,
    /// The Graph API version to call, e.g. `v21.0`.
    api_version: String,
    phone_number_id: String,
    token: String,
}

impl WhatsAppClient {
    /// `None` unless both the phone number id and the access token are set —
    /// see the module docs. There is nothing to probe at boot (no discovery
    /// step), so an unconfigured deployment simply can't send.
    pub fn from_config(config: &Config) -> Option<Self> {
        let phone_number_id = config.whatsapp_phone_number_id.clone()?;
        let token = config.whatsapp_access_token.clone()?;
        Some(Self {
            http: reqwest::Client::new(),
            api_version: config
                .whatsapp_api_version
                .clone()
                .unwrap_or_else(|| "v21.0".to_string()),
            phone_number_id,
            token,
        })
    }

    fn media_upload_url(&self) -> String {
        format!(
            "https://graph.facebook.com/{}/{}/media",
            self.api_version, self.phone_number_id
        )
    }

    fn message_url(&self) -> String {
        format!(
            "https://graph.facebook.com/{}/{}/messages",
            self.api_version, self.phone_number_id
        )
    }

    /// Uploads one image and sends it to one recipient, returning WhatsApp's
    /// message id. The caption and the recipient are validated/normalized
    /// here, not in the handler, so the pure helpers are the testable seam.
    pub async fn send_invoice_image(
        &self,
        branding: &InvoiceBranding,
        invoice: &InvoiceDetail,
        to: &str,
        mime_type: &str,
        media_base64: &str,
    ) -> Result<String, AppError> {
        let to = normalize_recipient(to)?;
        let bytes = decode_invoice_image(media_base64)?;
        let mime_type = normalize_mime(mime_type)?;

        let media_id = self.upload_media(&mime_type, &bytes).await?;
        let caption = invoice_caption(
            &branding.name_en,
            invoice.invoice_number,
            invoice.totals.total,
        );
        self.send_image(&to, &media_id, &caption).await
    }

    async fn upload_media(&self, mime_type: &str, bytes: &[u8]) -> Result<String, AppError> {
        let part = reqwest::multipart::Part::bytes(bytes.to_vec())
            .file_name("invoice.png")
            .mime_str(mime_type)
            .map_err(|error| {
                AppError::WhatsApp(format!("unsupported media type {mime_type}: {error}"))
            })?;
        let form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("messaging_product", "whatsapp")
            .text("type", mime_type.to_string());

        let response = self
            .http
            .post(&self.media_upload_url())
            .bearer_auth(&self.token)
            .multipart(form)
            .send()
            .await
            .map_err(|error| {
                AppError::WhatsApp(format!("failed to reach the WhatsApp media API: {error}"))
            })?;
        let response = ensure_success(response).await?;

        let MediaUploadResponse { id } = response.json().await.map_err(|error| {
            AppError::WhatsApp(format!(
                "failed to parse the WhatsApp media response: {error}"
            ))
        })?;
        Ok(id)
    }

    async fn send_image(
        &self,
        to: &str,
        media_id: &str,
        caption: &str,
    ) -> Result<String, AppError> {
        let body = serde_json::json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "image",
            "image": { "id": media_id, "caption": caption },
        });

        let response = self
            .http
            .post(&self.message_url())
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await
            .map_err(|error| {
                AppError::WhatsApp(format!(
                    "failed to reach the WhatsApp messages API: {error}"
                ))
            })?;
        let response = ensure_success(response).await?;

        let parsed: SendMessageResponse = response.json().await.map_err(|error| {
            AppError::WhatsApp(format!(
                "failed to parse the WhatsApp messages response: {error}"
            ))
        })?;
        parsed
            .messages
            .into_iter()
            .next()
            .map(|message| message.id)
            .ok_or_else(|| {
                AppError::WhatsApp(
                    "WhatsApp accepted the message but returned no message id".to_string(),
                )
            })
    }
}

/// Everything past a 2xx carries WhatsApp's own explanation of what failed —
/// an unverified recipient number, an out-of-window send, a revoked token.
/// That text is the useful half of the response, so it replaces our own.
async fn ensure_success(response: reqwest::Response) -> Result<reqwest::Response, AppError> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }

    let body = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<GraphErrorEnvelope>(&body)
        .ok()
        .and_then(|envelope| envelope.error)
        .map(|error| error.message)
        .filter(|message| !message.is_empty())
        .unwrap_or_else(|| {
            if body.is_empty() {
                status.to_string()
            } else {
                body
            }
        });
    Err(AppError::WhatsApp(message))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_a_phone_number_to_digits() {
        assert_eq!(
            normalize_recipient("+973-3311-2233").unwrap(),
            "97333112233"
        );
        assert_eq!(normalize_recipient("97333112233").unwrap(), "97333112233");
    }

    #[test]
    fn rejects_improbable_numbers() {
        assert!(normalize_recipient("").is_err());
        assert!(normalize_recipient("12345").is_err()); // seven digits or fewer
        assert!(normalize_recipient("01234567890123456789").is_err()); // 20 digits
    }

    #[test]
    fn decodes_valid_base64_and_rejects_bad_payloads() {
        let png = vec![0x89u8, b'P', b'N', b'G'];
        assert_eq!(
            decode_invoice_image(&base64::engine::general_purpose::STANDARD.encode(&png)).unwrap(),
            png
        );
        assert!(decode_invoice_image("not base64 !!!").is_err());
        assert!(decode_invoice_image("").is_err());
    }

    #[test]
    fn refuses_an_image_past_whatsapps_cap() {
        let huge = vec![0u8; MAX_IMAGE_BYTES + 1];
        let encoded = base64::engine::general_purpose::STANDARD.encode(&huge);
        assert!(decode_invoice_image(&encoded).is_err());
    }

    #[test]
    fn builds_the_caption_from_business_and_invoice_not_client_text() {
        assert_eq!(
            invoice_caption("Fabric Sync", 42, 83.5),
            "Fabric Sync — Invoice 42 — total 83.500 BHD"
        );
    }

    #[test]
    fn only_accepts_image_mime_types() {
        assert_eq!(normalize_mime("Image/PNG").unwrap(), "image/png");
        assert!(normalize_mime("application/pdf").is_err());
    }
}
