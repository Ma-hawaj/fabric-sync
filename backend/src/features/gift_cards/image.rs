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
pub const WIDTH: u32 = 1080;
pub const HEIGHT: u32 = 1920;
pub const MAX_BYTES: usize = 5 * 1024 * 1024;
const TEMPLATE: &str = include_str!("../../../templates/gift-card.svg");
const OVERLAY_TEMPLATE: &str = include_str!("../../../templates/gift-card-overlay.svg");
const DEFAULT_ARTWORK_PATH: &str = "assets/gift-card/artwork.png";

struct Artwork {
    data_url: String,
}

impl Artwork {
    fn from_png(bytes: &[u8]) -> Result<Self, AppError> {
        tiny_skia::Pixmap::decode_png(bytes).map_err(|_| {
            AppError::Image("The gift card artwork must be a valid PNG file.".into())
        })?;
        Ok(Self {
            data_url: format!("data:image/png;base64,{}", STANDARD.encode(bytes)),
        })
    }

    fn load(configured_path: Option<&str>) -> Result<Option<Self>, AppError> {
        let path = configured_path.unwrap_or(DEFAULT_ARTWORK_PATH);
        match std::fs::read(path) {
            Ok(bytes) => Self::from_png(&bytes).map(Some),
            Err(error)
                if configured_path.is_none() && error.kind() == std::io::ErrorKind::NotFound =>
            {
                Ok(None)
            }
            Err(error) => Err(AppError::Image(format!(
                "Could not read gift card artwork at {path}: {error}"
            ))),
        }
    }
}

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
                include_bytes!("../../../assets/fonts/thmanyahserifdisplay-Regular.otf").as_slice(),
                include_bytes!("../../../assets/fonts/thmanyahserifdisplay-Bold.otf").as_slice(),
                include_bytes!("../../../assets/fonts/thmanyahserifdisplay-Black.otf").as_slice(),
                include_bytes!("../../../assets/fonts/SpaceGrotesk-Medium.otf").as_slice(),
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
    svg_for_artwork(branding, card, on, None)
}

fn svg_for_artwork(
    branding: &InvoiceBranding,
    card: &GiftCard,
    on: NaiveDate,
    artwork: Option<&Artwork>,
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
    let brand_ar = display_line(&branding.name_ar, 44);
    let phone = display_line(&branding.phone, 24);
    let balance = document::format_amount(card.balance);
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
        .map(|d| document::format_date(&d))
        .unwrap_or_else(|| "No expiry date".into());
    let background = match artwork {
        Some(artwork) => artwork.data_url.clone(),
        None => format!(
            "data:image/jpeg;base64,{}",
            STANDARD.encode(include_bytes!("../../../assets/gift-card/background.jpg"))
        ),
    };
    // Split at a hyphen near the middle to fit the designer's narrow code field.
    // Keep the hyphen so the two displayed lines retain every code character.
    let split = (card.code.chars().count() > 10)
        .then(|| {
            card.code
                .match_indices('-')
                .map(|(index, _)| index + 1)
                .filter(|index| *index < card.code.len())
                .min_by_key(|index| index.abs_diff(card.code.len() / 2))
        })
        .flatten();
    let code_lines = match split {
        Some(index) => vec![&card.code[..index], &card.code[index..]],
        None => vec![card.code.as_str()],
    };
    let longest_code_line = code_lines
        .iter()
        .map(|line| line.chars().count())
        .max()
        .unwrap_or(1);
    let template = if artwork.is_some() {
        OVERLAY_TEMPLATE
    } else {
        TEMPLATE
    };
    let mut env = Environment::new();
    env.set_auto_escape_callback(|_| AutoEscape::Html);
    env.add_template("gift-card.svg", template)?;
    Ok(env.get_template("gift-card.svg")?.render(context! {
        brand_size => (840.0 / (brand.chars().count().max(1) as f64 * 0.65)).min(48.0),
        brand_ar_size => (840.0 / (brand_ar.chars().count().max(1) as f64 * 0.65)).min(40.0),
        brand, brand_ar, logo, background,
        balance_size => (420.0 / (balance.chars().count().max(1) as f64 * 0.65)).min(94.0),
        balance, currency => document::CURRENCY,
        recipient_size => (840.0 / (recipient.chars().count().max(1) as f64 * 0.65)).min(32.0),
        recipient, recipient_direction => if rtl {"rtl"} else {"ltr"},
        has_recipient => card.bought_for.as_deref().is_some_and(|name| !name.trim().is_empty()),
        code => card.code, code_size => (480.0 / (card.code.chars().count().max(1) as f64 * 0.61)).min(36.0),
        overlay_code_size => (200.0 / (longest_code_line.max(1) as f64 * 0.61)).min(22.0),
        code_start_y => if code_lines.len() > 1 {1244} else {1262}, code_lines,
        expiry_size => (290.0 / (expiry.chars().count().max(1) as f64 * 0.6)).min(32.0),
        phone_size => (440.0 / (phone.chars().count().max(1) as f64 * 0.65)).min(38.0),
        phone, qr_size, qr_path, expiry, status,
    })?)
}

pub(super) fn render(
    branding: &InvoiceBranding,
    card: &GiftCard,
    on: NaiveDate,
) -> Result<GiftCardImage, AppError> {
    let svg = svg(branding, card, on)?;
    render_svg(card, &svg)
}

fn render_svg(card: &GiftCard, svg: &str) -> Result<GiftCardImage, AppError> {
    let options = usvg::Options {
        fontdb: fonts(),
        ..Default::default()
    };
    let tree = usvg::Tree::from_str(svg, &options).map_err(|e| AppError::Image(e.to_string()))?;
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
    let artwork_path = state.gift_card_artwork_path().map(str::to_owned);
    let card = card.clone();
    let on = chrono::Utc::now()
        .with_timezone(&state.timezone()?)
        .date_naive();
    tokio::task::spawn_blocking(move || match Artwork::load(artwork_path.as_deref())? {
        Some(artwork) => render_svg(
            &card,
            &svg_for_artwork(&branding, &card, on, Some(&artwork))?,
        ),
        None => render(&branding, &card, on),
    })
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
            issued_by: None,
            taxed_at_issue: false,
            replaces_card_id: None,
            replaces_card_code: None,
            replaced_by_card_id: None,
            replaced_by_card_code: None,
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
    fn design_fonts_are_available_without_system_fonts() {
        use usvg::fontdb::{Family, Query, Weight};

        let db = fonts();
        for (family, weight) in [
            ("thmanyah serif display", 400),
            ("thmanyah serif display", 700),
            ("thmanyah serif display", 900),
            ("Space Grotesk", 500),
        ] {
            let id = db
                .query(&Query {
                    families: &[Family::Name(family)],
                    weight: Weight(weight),
                    ..Default::default()
                })
                .unwrap_or_else(|| panic!("Missing bundled font: {family} {weight}"));
            assert_eq!(db.face(id).unwrap().weight, Weight(weight));
        }
    }

    #[test]
    fn long_recipients_and_large_balances_fit_the_portrait_fields() {
        let mut card = card();
        card.balance = 99_999_999.99;
        card.expires_on = None;
        for name in [
            "Alexander Christopher Montgomery-Worthington III",
            "عبدالرحمن عبدالله محمد عبدالعزيز المنصوري الطويل",
        ] {
            card.bought_for = Some(name.into());
            let source = svg(&branding(), &card, today()).unwrap();
            assert!(source.contains("No expiry date"));
            let tree = usvg::Tree::from_str(
                &source,
                &usvg::Options {
                    fontdb: fonts(),
                    ..Default::default()
                },
            )
            .unwrap();
            for (id, left, right) in [
                ("recipient", 64.0, 1016.0),
                ("balance", 110.0, 590.0),
                ("code", 110.0, 590.0),
                ("expiry", 650.0, 970.0),
                ("redemption-qr", 64.0, 1016.0),
            ] {
                let bounds = tree.node_by_id(id).unwrap().abs_bounding_box();
                assert!(bounds.width() > 0.0, "Empty {id}");
                assert!(
                    bounds.left() >= left && bounds.right() <= right,
                    "{id} exceeds its field for {name}: {bounds:?}"
                );
                assert!(bounds.top() >= 0.0 && bounds.bottom() <= HEIGHT as f32);
            }
        }
        card.bought_for = None;
        assert!(svg(&branding(), &card, today())
            .unwrap()
            .contains("Someone special"));
    }

    #[test]
    fn fixed_png_preserves_artwork_and_fits_variable_fields() {
        let mut original = tiny_skia::Pixmap::new(WIDTH, HEIGHT).unwrap();
        original.fill(tiny_skia::Color::from_rgba8(241, 235, 225, 255));
        let png = original.encode_png().unwrap();
        let artwork = Artwork::from_png(&png).unwrap();
        let embedded = artwork
            .data_url
            .strip_prefix("data:image/png;base64,")
            .unwrap();
        assert_eq!(STANDARD.decode(embedded).unwrap(), png);

        let mut card = card();
        card.balance = 99_999_999.99;
        card.expires_on = None;
        let source = svg_for_artwork(&branding(), &card, today(), Some(&artwork)).unwrap();
        assert!(!source.contains("<mask"));
        assert!(!source.contains("Fabric Sync"));
        assert!(!source.contains("Gift Value"));
        assert!(source.contains("No expiry date"));
        assert!(source.contains(&card.code));
        assert!(source.contains("GC-7KMP-"));
        assert!(source.contains("4RWT-9DXH"));
        let tree = usvg::Tree::from_str(
            &source,
            &usvg::Options {
                fontdb: fonts(),
                ..Default::default()
            },
        )
        .unwrap();
        for (id, left, right, bottom) in [
            ("recipient", 64.0, 1016.0, 900.0),
            ("balance", 110.0, 590.0, 1058.0),
            ("code", 260.0, 470.0, 1274.0),
            ("expiry", 595.0, 835.0, 1274.0),
        ] {
            let bounds = tree.node_by_id(id).unwrap().abs_bounding_box();
            assert!(bounds.width() > 0.0, "Empty {id}");
            assert!(
                bounds.left() >= left && bounds.right() <= right,
                "{id}: {bounds:?}"
            );
            assert!(bounds.bottom() <= bottom, "{id}: {bounds:?}");
        }
        let rendered = render_svg(&card, &source).unwrap();
        let decoded = tiny_skia::Pixmap::decode_png(&rendered.png).unwrap();
        for (x, y) in [
            (0, 0),
            (1079, 1919),
            (540, 200),
            (540, 451),
            (540, 1560),
            (540, 1810),
        ] {
            assert_eq!(
                decoded.pixel(x, y),
                original.pixel(x, y),
                "Artwork changed at {x},{y}"
            );
        }

        if let (Ok(input), Ok(output)) = (
            std::env::var("GIFT_CARD_SAMPLE_ARTWORK"),
            std::env::var("GIFT_CARD_SAMPLE_OUTPUT"),
        ) {
            let artwork = Artwork::load(Some(&input)).unwrap().unwrap();
            let mut sample = self::card();
            sample.code = "GC-DEMO-0000-0000".into();
            sample.initial_amount = 50.0;
            sample.balance = 50.0;
            sample.expires_on = Some("2027-12-31".parse().unwrap());
            let source = svg_for_artwork(&branding(), &sample, today(), Some(&artwork)).unwrap();
            std::fs::write(output, render_svg(&sample, &source).unwrap().png).unwrap();
        }
    }

    #[test]
    fn fixed_png_omits_missing_recipient_and_labels_unusable_cards() {
        let mut pixels = tiny_skia::Pixmap::new(9, 16).unwrap();
        pixels.fill(tiny_skia::Color::WHITE);
        let artwork = Artwork::from_png(&pixels.encode_png().unwrap()).unwrap();
        let mut card = card();
        card.bought_for = None;
        card.is_active = false;
        let source = svg_for_artwork(&branding(), &card, today(), Some(&artwork)).unwrap();
        assert!(!source.contains("id=\"recipient\""));
        assert!(!source.contains("Someone special"));
        assert!(source.contains("VOIDED"));
        card.is_active = true;
        card.balance = 0.0;
        assert!(svg_for_artwork(&branding(), &card, today(), Some(&artwork))
            .unwrap()
            .contains("FULLY REDEEMED"));
        card.balance = 50.0;
        card.expires_on = Some("2026-01-01".parse().unwrap());
        assert!(svg_for_artwork(&branding(), &card, today(), Some(&artwork))
            .unwrap()
            .contains("EXPIRED"));
    }

    #[test]
    fn configured_artwork_errors_are_reported() {
        assert!(Artwork::from_png(b"not a PNG").is_err());
        let missing =
            std::env::temp_dir().join(format!("missing-gift-card-{}.png", uuid::Uuid::new_v4()));
        assert!(Artwork::load(Some(missing.to_str().unwrap())).is_err());
    }
}
