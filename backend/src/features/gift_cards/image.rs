use std::sync::{Arc, OnceLock};

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::NaiveDate;
use minijinja::{context, AutoEscape, Environment};
use qrcode::{Color, QrCode};
use resvg::{tiny_skia, usvg};

use super::{repository, types::GiftCard};
use crate::{document, error::AppError, features::notifications::service::hash, state::AppState};

pub const MIME: &str = "image/png";
pub const WIDTH: u32 = 1080;
pub const HEIGHT: u32 = 1920;
pub const MAX_BYTES: usize = 5 * 1024 * 1024;
const TEMPLATE: &str = include_str!("../../../templates/gift-card.svg");
const BUNDLED_ARTWORK: &[u8] = include_bytes!("../../../assets/gift-card/artwork.png");

fn denomination_label(initial_amount: f64) -> Option<&'static str> {
    if !initial_amount.is_finite() {
        return None;
    }
    match (initial_amount * 100.0).round() as i64 {
        2_000 => Some("Bronze"),
        3_000 => Some("Silver"),
        4_000.. => Some("Premium"),
        _ => None,
    }
}

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

    fn load(configured_path: Option<&str>) -> Result<Self, AppError> {
        match configured_path {
            None => Self::from_png(BUNDLED_ARTWORK),
            Some(path) => {
                let bytes = std::fs::read(path).map_err(|error| {
                    AppError::Image(format!(
                        "Could not read gift card artwork at {path}: {error}"
                    ))
                })?;
                Self::from_png(&bytes)
            }
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
                include_bytes!("../../../assets/fonts/thmanyahserifdisplay-Bold.otf").as_slice(),
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

fn svg(card: &GiftCard, on: NaiveDate, artwork: &Artwork) -> Result<String, AppError> {
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
    let balance = denomination_label(card.initial_amount)
        .map(str::to_owned)
        .unwrap_or_else(|| document::format_amount(card.balance));
    let currency = if denomination_label(card.initial_amount).is_some() {
        ""
    } else {
        document::CURRENCY
    };
    let status = if !card.is_active {
        "VOIDED"
    } else if card.balance <= 0.0 {
        "FULLY REDEEMED"
    } else if card.expires_on.is_some_and(|d| d < on) {
        "EXPIRED"
    } else {
        ""
    };
    let expiry = card
        .expires_on
        .map(|d| document::format_date(&d))
        .unwrap_or_else(|| "No expiry date".into());
    let mut env = Environment::new();
    env.set_auto_escape_callback(|_| AutoEscape::Html);
    // This proportional font needs its actual text width to keep wide codes
    // on one line without shrinking every code to the widest possible letters.
    let code_measurement = env.render_str(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><text id="code" font-family="Space Grotesk" font-size="38" font-weight="500">{{ code }}</text></svg>"#,
        context! {code => card.code},
    )?;
    let code_tree = usvg::Tree::from_str(
        &code_measurement,
        &usvg::Options {
            fontdb: fonts(),
            ..Default::default()
        },
    )
    .map_err(|e| AppError::Image(e.to_string()))?;
    let code_width = code_tree
        .node_by_id("code")
        .map(|node| node.abs_bounding_box().width())
        .unwrap_or(1.0);
    let code_size = 38.0 * (400.0 / code_width.max(1.0)).min(1.0);
    env.add_template("gift-card.svg", TEMPLATE)?;
    Ok(env.get_template("gift-card.svg")?.render(context! {
        background => artwork.data_url.as_str(),
        balance_size => (420.0 / (balance.chars().count().max(1) as f64 * 0.65)).min(94.0),
        balance, currency,
        code => card.code,
        code_size,
        qr_size, qr_path, expiry, status,
    })?)
}

fn render(card: &GiftCard, on: NaiveDate, artwork: &Artwork) -> Result<GiftCardImage, AppError> {
    let svg = svg(card, on, artwork)?;
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
    let artwork_path = state.gift_card_artwork_path().map(str::to_owned);
    let card = card.clone();
    let on = chrono::Utc::now()
        .with_timezone(&state.timezone()?)
        .date_naive();
    tokio::task::spawn_blocking(move || {
        let artwork = Artwork::load(artwork_path.as_deref())?;
        render(&card, on, &artwork)
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

    fn artwork() -> Artwork {
        Artwork::load(None).unwrap()
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
        let first = render(&card, today(), &artwork()).unwrap();
        let second = render(&card, today(), &artwork()).unwrap();
        let decoded = tiny_skia::Pixmap::decode_png(&first.png).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (WIDTH, HEIGHT));
        assert!(first.png.len() < MAX_BYTES);
        assert_eq!(first.png, second.png);
        assert_eq!(first.sha256, hash(&first.png));
        let source = svg(&card, today(), &artwork()).unwrap();
        assert!(source.contains("50.000"));
        assert!(!source.contains("أحمد المنصوري"));
        assert!(source.contains(&card.code));
        assert!(source.contains("31-12-2026"));
        if let Ok(output) = std::env::var("GIFT_CARD_IMAGE_TEST_OUTPUT") {
            std::fs::write(output, &first.png).unwrap();
        }
    }

    #[test]
    fn customer_names_are_not_printed_and_unusable_cards_are_labelled() {
        let mut card = card();
        let original = svg(&card, today(), &artwork()).unwrap();
        card.bought_for = Some("<script>alert(1)</script> & Co".into());
        card.customer_name = Some("Private buyer name".into());
        let source = svg(&card, today(), &artwork()).unwrap();
        assert_eq!(source, original);
        assert!(!source.contains("<script>"));
        assert!(!source.contains("Private buyer name"));
        card.is_active = false;
        assert!(svg(&card, today(), &artwork()).unwrap().contains("VOIDED"));
        card.is_active = true;
        card.balance = 0.0;
        assert!(svg(&card, today(), &artwork())
            .unwrap()
            .contains("FULLY REDEEMED"));
        card.balance = 50.0;
        card.expires_on = Some("2026-10-23".parse().unwrap());
        assert!(svg(&card, today(), &artwork()).unwrap().contains("EXPIRED"));
    }

    #[test]
    fn image_version_changes_with_artwork_and_remaining_balance() {
        let mut card = card();
        let original = render(&card, today(), &artwork()).unwrap().sha256;
        card.balance = 40.0;
        assert_ne!(original, render(&card, today(), &artwork()).unwrap().sha256);
        card.balance = 50.0;
        let mut changed_pixels = tiny_skia::Pixmap::new(WIDTH, HEIGHT).unwrap();
        changed_pixels.fill(tiny_skia::Color::WHITE);
        let changed_artwork = Artwork::from_png(&changed_pixels.encode_png().unwrap()).unwrap();
        assert_ne!(
            original,
            render(&card, today(), &changed_artwork).unwrap().sha256
        );
    }

    #[test]
    fn design_fonts_are_available_without_system_fonts() {
        use usvg::fontdb::{Family, Query, Weight};

        let db = fonts();
        for (family, weight) in [("thmanyah serif display", 700), ("Space Grotesk", 500)] {
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
    fn single_line_codes_and_large_balances_fit_the_portrait_fields() {
        let mut card = card();
        card.balance = 99_999_999.99;
        card.expires_on = None;
        for code in [
            "GC-7KMP-4RWT-9DXH",
            "GC-WWWW-WWWW-WWWW",
            "GC-MMMM-MMMM-MMMM",
            "GC-1",
            "GC-7KMP-4RWT-9DXH-7KMP-4RWT-9DXH",
        ] {
            card.code = code.into();
            let source = svg(&card, today(), &artwork()).unwrap();
            assert!(source.contains("No expiry date"));
            assert!(source.contains(&format!(">{code}</text>")));
            let tree = usvg::Tree::from_str(
                &source,
                &usvg::Options {
                    fontdb: fonts(),
                    ..Default::default()
                },
            )
            .unwrap();
            for (id, left, right) in [
                ("balance", 110.0, 590.0),
                ("code", 145.0, 585.0),
                ("expiry", 575.0, 855.0),
                ("redemption-qr", 64.0, 1016.0),
            ] {
                let bounds = tree.node_by_id(id).unwrap().abs_bounding_box();
                assert!(bounds.width() > 0.0, "Empty {id}");
                assert!(
                    bounds.left() >= left && bounds.right() <= right,
                    "{id} exceeds its field for {code}: {bounds:?}"
                );
                assert!(bounds.top() >= 0.0 && bounds.bottom() <= HEIGHT as f32);
            }
        }
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
        let source = svg(&card, today(), &artwork).unwrap();
        assert!(!source.contains("<mask"));
        assert!(!source.contains("Fabric Sync"));
        assert!(!source.contains("Gift Value"));
        assert!(source.contains("No expiry date"));
        assert!(source.contains(&card.code));
        assert!(source.contains(&format!(">{}</text>", card.code)));
        let tree = usvg::Tree::from_str(
            &source,
            &usvg::Options {
                fontdb: fonts(),
                ..Default::default()
            },
        )
        .unwrap();
        for (id, left, right, top, bottom) in [
            ("balance", 110.0, 590.0, 900.0, 1058.0),
            ("code", 145.0, 585.0, 1250.0, 1310.0),
            ("expiry", 575.0, 855.0, 1250.0, 1310.0),
        ] {
            let bounds = tree.node_by_id(id).unwrap().abs_bounding_box();
            assert!(bounds.width() > 0.0, "Empty {id}");
            assert!(
                bounds.left() >= left && bounds.right() <= right,
                "{id}: {bounds:?}"
            );
            assert!(
                bounds.top() >= top && bounds.bottom() <= bottom,
                "{id}: {bounds:?}"
            );
            if id != "balance" {
                assert!(bounds.height() > 24.0, "{id} is too small: {bounds:?}");
            }
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
    }

    #[test]
    fn fixed_png_omits_recipient_details_and_labels_unusable_cards() {
        let mut pixels = tiny_skia::Pixmap::new(9, 16).unwrap();
        pixels.fill(tiny_skia::Color::WHITE);
        let artwork = Artwork::from_png(&pixels.encode_png().unwrap()).unwrap();
        let mut card = card();
        let with_recipient = svg(&card, today(), &artwork).unwrap();
        assert!(!with_recipient.contains("أحمد المنصوري"));
        card.bought_for = None;
        assert_eq!(svg(&card, today(), &artwork).unwrap(), with_recipient);
        card.is_active = false;
        let source = svg(&card, today(), &artwork).unwrap();
        assert!(!source.contains("id=\"recipient\""));
        assert!(!source.contains("Someone special"));
        assert!(source.contains("VOIDED"));
        card.is_active = true;
        card.balance = 0.0;
        assert!(svg(&card, today(), &artwork)
            .unwrap()
            .contains("FULLY REDEEMED"));
        card.balance = 50.0;
        card.expires_on = Some("2026-01-01".parse().unwrap());
        assert!(svg(&card, today(), &artwork).unwrap().contains("EXPIRED"));
    }

    #[test]
    fn configured_artwork_errors_are_reported() {
        assert!(Artwork::from_png(b"not a PNG").is_err());
        let missing =
            std::env::temp_dir().join(format!("missing-gift-card-{}.png", uuid::Uuid::new_v4()));
        assert!(Artwork::load(Some(missing.to_str().unwrap())).is_err());
    }
}
