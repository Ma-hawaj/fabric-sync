use std::sync::{Arc, OnceLock};

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::NaiveDate;
use minijinja::{context, AutoEscape, Environment};
use qrcode::{Color, QrCode};
use resvg::{tiny_skia, usvg};

use super::{repository, types::GiftCard};
use crate::{
    config::InvoiceBranding, document, error::AppError, features::notifications::service::hash,
    state::AppState,
};

pub const MIME: &str = "image/png";
pub const WIDTH: u32 = 1200;
pub const HEIGHT: u32 = 720;
pub const MAX_BYTES: usize = 5 * 1024 * 1024;
const TEMPLATE: &str = include_str!("../../../templates/gift-card.svg");

pub struct GiftCardImage {
    pub png: Vec<u8>,
    pub filename: String,
    pub sha256: String,
}

impl GiftCardImage {
    pub fn data_url(&self) -> String {
        format!("data:{MIME};base64,{}", STANDARD.encode(&self.png))
    }
}

fn fonts() -> Arc<usvg::fontdb::Database> {
    static FONTS: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            let mut db = usvg::fontdb::Database::new();
            for data in [
                include_bytes!("../../../assets/fonts/DejaVuSans.ttf").as_slice(),
                include_bytes!("../../../assets/fonts/DejaVuSans-Bold.ttf").as_slice(),
                include_bytes!("../../../assets/fonts/DejaVuSansMono.ttf").as_slice(),
            ] {
                db.load_font_data(data.to_vec());
            }
            db.set_sans_serif_family("DejaVu Sans");
            db.set_monospace_family("DejaVu Sans Mono");
            Arc::new(db)
        })
        .clone()
}

fn display_line(raw: &str, limit: usize) -> String {
    let text = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() > limit {
        format!("{}…", text.chars().take(limit - 1).collect::<String>())
    } else {
        text
    }
}

pub(super) fn svg(
    branding: &InvoiceBranding,
    card: &GiftCard,
    on: NaiveDate,
) -> Result<String, AppError> {
    let qr = QrCode::new(card.code.as_bytes())
        .map_err(|_| AppError::Image("The gift card code could not be encoded.".into()))?;
    let qr_size = qr.width() + 8;
    let mut qr_path = String::new();
    for y in 0..qr.width() {
        for x in 0..qr.width() {
            if qr[(x, y)] == Color::Dark {
                qr_path.push_str(&format!("M{} {}h1v1h-1z", x + 4, y + 4));
            }
        }
    }
    let brand = display_line(&branding.name_en, 44);
    let recipient = display_line(
        card.bought_for
            .as_deref()
            .filter(|n| !n.trim().is_empty())
            .unwrap_or("Someone special"),
        48,
    );
    let rtl = recipient
        .chars()
        .find(|c| c.is_alphabetic())
        .is_some_and(|c| matches!(c as u32, 0x0590..=0x08ff | 0xfb1d..=0xfdff | 0xfe70..=0xfeff));
    let status = if !card.is_active {
        "VOIDED"
    } else if card.balance <= 0.0 {
        "FULLY REDEEMED"
    } else if card.expires_on.is_some_and(|d| d < on) {
        "EXPIRED"
    } else {
        ""
    };
    let logo = branding.logo_data_url.as_deref().filter(|s| {
        s.starts_with("data:image/png;base64,")
            || s.starts_with("data:image/jpeg;base64,")
            || s.starts_with("data:image/webp;base64,")
    });
    let expiry = card
        .expires_on
        .map(|d| format!("Valid until {}", document::format_date(&d)))
        .unwrap_or_else(|| "No expiry date".into());
    let mut env = Environment::new();
    env.set_auto_escape_callback(|_| AutoEscape::Html);
    env.add_template("gift-card.svg", TEMPLATE)?;
    Ok(env.get_template("gift-card.svg")?.render(context! {
        brand_size => (650.0 / (brand.chars().count().max(1) as f64 * 0.65)).min(28.0),
        brand, brand_x => if logo.is_some() {148} else {64}, logo,
        balance => document::format_amount(card.balance), currency => document::CURRENCY,
        recipient_size => (720.0 / (recipient.chars().count().max(1) as f64 * 0.65)).min(32.0),
        recipient, recipient_x => if rtl {800} else {64}, recipient_anchor => if rtl {"end"} else {"start"},
        code => card.code, code_size => (700.0 / (card.code.chars().count().max(1) as f64 * 0.61)).min(42.0),
        qr_size, qr_path, expiry, status,
    })?)
}

pub(super) fn render(
    branding: &InvoiceBranding,
    card: &GiftCard,
    on: NaiveDate,
) -> Result<GiftCardImage, AppError> {
    let svg = svg(branding, card, on)?;
    let options = usvg::Options {
        fontdb: fonts(),
        ..Default::default()
    };
    let tree = usvg::Tree::from_str(&svg, &options).map_err(|e| AppError::Image(e.to_string()))?;
    let mut pixmap = tiny_skia::Pixmap::new(WIDTH, HEIGHT)
        .ok_or_else(|| AppError::Image("Could not allocate the gift card image.".into()))?;
    resvg::render(
        &tree,
        tiny_skia::Transform::identity(),
        &mut pixmap.as_mut(),
    );
    let png = pixmap
        .encode_png()
        .map_err(|e| AppError::Image(e.to_string()))?;
    if png.len() > MAX_BYTES {
        return Err(AppError::Image(
            "The gift card image exceeds the WhatsApp image size limit.".into(),
        ));
    }
    Ok(GiftCardImage {
        sha256: hash(&png),
        png,
        filename: format!("gift-card-{}.png", card.id),
    })
}

pub async fn for_card(state: &AppState, card: &GiftCard) -> Result<GiftCardImage, AppError> {
    let branding = state.invoice_branding().clone();
    let card = card.clone();
    let on = chrono::Utc::now()
        .with_timezone(&state.timezone()?)
        .date_naive();
    tokio::task::spawn_blocking(move || render(&branding, &card, on))
        .await
        .map_err(|e| AppError::Image(e.to_string()))?
}

pub async fn get(state: &AppState, id: uuid::Uuid) -> Result<GiftCardImage, AppError> {
    let card = repository::get_gift_card(state, id)
        .await?
        .ok_or_else(|| AppError::NotFound("Gift card not found.".into()))?;
    for_card(state, &card).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn branding() -> InvoiceBranding {
        InvoiceBranding {
            name_en: "Fabric Sync".into(),
            name_ar: "فابريك سينك".into(),
            vat_number: String::new(),
            cr_number: String::new(),
            address_en: String::new(),
            address_ar: String::new(),
            phone: String::new(),
            email: String::new(),
            logo_data_url: None,
            template_dir: None,
        }
    }
    fn card() -> GiftCard {
        GiftCard {
            id: uuid::Uuid::nil(),
            code: "GC-7KMP-4RWT-9DXH".into(),
            initial_amount: 100.0,
            balance: 50.0,
            customer_id: None,
            customer_name: None,
            bought_for: Some("أحمد المنصوري".into()),
            recipient_phone: None,
            delivery_status: None,
            delivery_error: None,
            expires_on: Some("2026-12-31".parse().unwrap()),
            is_active: true,
        }
    }
    fn today() -> NaiveDate {
        "2026-10-24".parse().unwrap()
    }

    #[test]
    fn png_is_deterministic_and_readable_without_system_fonts() {
        let card = card();
        let first = render(&branding(), &card, today()).unwrap();
        let second = render(&branding(), &card, today()).unwrap();
        let decoded = tiny_skia::Pixmap::decode_png(&first.png).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (WIDTH, HEIGHT));
        assert!(first.png.len() < MAX_BYTES);
        assert_eq!(first.png, second.png);
        assert_eq!(first.sha256, hash(&first.png));
        let source = svg(&branding(), &card, today()).unwrap();
        assert!(source.contains("50.000"));
        assert!(source.contains("أحمد المنصوري"));
        assert!(source.contains(&card.code));
        assert!(source.contains("31-12-2026"));
        if let Ok(output) = std::env::var("GIFT_CARD_IMAGE_TEST_OUTPUT") {
            std::fs::write(output, &first.png).unwrap();
        }
    }

    #[test]
    fn recipient_markup_is_escaped_and_unusable_cards_are_labelled() {
        let mut card = card();
        card.bought_for = Some("<script>alert(1)</script> & Co".into());
        let source = svg(&branding(), &card, today()).unwrap();
        assert!(!source.contains("<script>"));
        assert!(source.contains("&lt;script&gt;"));
        card.is_active = false;
        assert!(svg(&branding(), &card, today()).unwrap().contains("VOIDED"));
        card.is_active = true;
        card.balance = 0.0;
        assert!(svg(&branding(), &card, today())
            .unwrap()
            .contains("FULLY REDEEMED"));
        card.balance = 50.0;
        card.expires_on = Some("2026-10-23".parse().unwrap());
        assert!(svg(&branding(), &card, today())
            .unwrap()
            .contains("EXPIRED"));
    }

    #[test]
    fn image_version_changes_with_branding_and_remaining_balance() {
        let mut card = card();
        let original = render(&branding(), &card, today()).unwrap().sha256;
        card.balance = 40.0;
        assert_ne!(
            original,
            render(&branding(), &card, today()).unwrap().sha256
        );
        card.balance = 50.0;
        let mut changed_brand = branding();
        changed_brand.name_en = "Another tailor".into();
        assert_ne!(
            original,
            render(&changed_brand, &card, today()).unwrap().sha256
        );
    }

    #[test]
    fn existing_long_codes_still_render_in_full() {
        let mut card = card();
        card.code = "GC-0123456789ABCDEF0123456789ABCDEF".into();
        assert!(svg(&branding(), &card, today())
            .unwrap()
            .contains(&card.code));
        assert!(render(&branding(), &card, today())
            .unwrap()
            .png
            .starts_with(b"\x89PNG"));
    }
}
