use minijinja::{context, AutoEscape, Environment};
use resvg::{tiny_skia, usvg};
use serde::Serialize;
use serde_json::json;

use super::service::hash;
use crate::{error::AppError, image as rendering, state::AppState};

pub const WIDTH: u32 = 1080;
pub const HEIGHT: u32 = 2486;
const TEMPLATE: &str = include_str!("../../../templates/ready-card.svg");
const BUNDLED_ARTWORK: &[u8] = include_bytes!("../../../assets/ready/artwork.jpeg");
const CARD_VERSION: &str = "ready-card-v1";
const BASE_SIZE: f64 = 40.0;
const MAX_TEXT_WIDTH: f64 = 320.0;
const BASELINES: [i32; 5] = [928, 1090, 1236, 1394, 1554];

#[derive(Clone, Debug, Serialize)]
pub struct ReadyCard {
    pub customer: String,
    pub receipt: String,
    pub measurement: String,
    pub balance: String,
    pub date: String,
}

impl ReadyCard {
    pub fn new(
        customers: Vec<String>,
        measurements: Vec<String>,
        receipt: String,
        balance: String,
        date: String,
    ) -> Self {
        Self {
            customer: join_values(customers),
            receipt,
            measurement: join_values(measurements),
            balance,
            date,
        }
    }
}

pub fn join_values(values: Vec<String>) -> String {
    let mut unique = Vec::new();
    for value in values {
        let value = value.trim();
        if value.is_empty() || unique.iter().any(|seen: &String| seen == value) {
            continue;
        }
        unique.push(value.to_owned());
    }
    let extra = unique.len().saturating_sub(3);
    unique.truncate(3);
    if extra > 0 {
        unique.push(format!("+{extra}"));
    }
    unique.join(" / ")
}

pub fn fingerprint(card: &ReadyCard, artwork_sha: &str) -> Result<String, AppError> {
    serde_json::to_vec(&json!({
        "version": CARD_VERSION,
        "card": card,
        "artwork": artwork_sha,
    }))
    .map(|value| hash(&value))
    .map_err(|error| AppError::Image(error.to_string()))
}

fn artwork_bytes(state: &AppState) -> Result<Vec<u8>, AppError> {
    match state.ready_artwork_path() {
        None => Ok(BUNDLED_ARTWORK.to_vec()),
        Some(path) => std::fs::read(path).map_err(|error| {
            AppError::Image(format!(
                "Could not read ready card artwork at {path}: {error}"
            ))
        }),
    }
}

pub fn artwork_sha(state: &AppState) -> Result<String, AppError> {
    Ok(hash(&artwork_bytes(state)?))
}

struct Artwork {
    data_url: String,
}

impl Artwork {
    fn from_bytes(bytes: &[u8]) -> Result<Self, AppError> {
        Ok(Self {
            data_url: rendering::jpeg_data_url(
                bytes,
                "The ready card artwork must be a valid image file.",
            )?,
        })
    }

    fn load(state: &AppState) -> Result<Self, AppError> {
        Self::from_bytes(&artwork_bytes(state)?)
    }
}

#[derive(Serialize)]
struct TextField {
    name: &'static str,
    text: String,
    y: i32,
    size: f64,
}

fn environment() -> Result<Environment<'static>, AppError> {
    let mut env = Environment::new();
    env.set_auto_escape_callback(|_| AutoEscape::Html);
    env.add_template("ready-card.svg", TEMPLATE)?;
    Ok(env)
}

fn fit_size(env: &Environment<'_>, text: &str) -> f64 {
    if text.is_empty() {
        return BASE_SIZE;
    }
    let measured = env
        .render_str(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="2486"><text id="value" font-family="Space Grotesk" font-weight="500" font-size="{{ size }}">{{ text }}</text></svg>"#,
            context! { text => text, size => BASE_SIZE },
        )
        .unwrap_or_default();
    let width = usvg::Tree::from_str(
        &measured,
        &usvg::Options {
            fontdb: rendering::fonts(),
            ..Default::default()
        },
    )
    .ok()
    .and_then(|tree| {
        tree.node_by_id("value")
            .map(|node| node.abs_bounding_box().width())
    })
    .unwrap_or(1.0);
    BASE_SIZE * (MAX_TEXT_WIDTH / f64::from(width).max(1.0)).min(1.0)
}

fn fields(env: &Environment<'_>, card: &ReadyCard) -> Vec<TextField> {
    [
        ("customer", &card.customer),
        ("receipt", &card.receipt),
        ("measurement", &card.measurement),
        ("balance", &card.balance),
        ("date", &card.date),
    ]
    .into_iter()
    .zip(BASELINES)
    .map(|((name, text), y)| TextField {
        name,
        text: text.clone(),
        y,
        size: fit_size(env, text),
    })
    .collect()
}

pub struct ReadyImage {
    pub bytes: Vec<u8>,
    pub filename: String,
    pub sha256: String,
}

fn render(card: &ReadyCard, artwork: &Artwork) -> Result<ReadyImage, AppError> {
    let env = environment()?;
    let svg = env.get_template("ready-card.svg")?.render(context! {
        background => artwork.data_url.as_str(),
        fields => fields(&env, card),
    })?;
    let tree = usvg::Tree::from_str(
        &svg,
        &usvg::Options {
            fontdb: rendering::fonts(),
            ..Default::default()
        },
    )
    .map_err(|error| AppError::Image(error.to_string()))?;
    let mut pixmap = tiny_skia::Pixmap::new(WIDTH, HEIGHT)
        .ok_or_else(|| AppError::Image("Could not allocate the ready card image.".into()))?;
    resvg::render(
        &tree,
        tiny_skia::Transform::identity(),
        &mut pixmap.as_mut(),
    );
    let rgba = image::RgbaImage::from_raw(WIDTH, HEIGHT, pixmap.data().to_vec())
        .ok_or_else(|| AppError::Image("Could not encode the ready card image.".into()))?;
    let bytes = rendering::encode_jpeg(&image::DynamicImage::ImageRgba8(rgba).to_rgb8())?;
    if bytes.len() > rendering::MAX_BYTES {
        return Err(AppError::Image(
            "The ready card image exceeds the WhatsApp image size limit.".into(),
        ));
    }
    Ok(ReadyImage {
        sha256: hash(&bytes),
        bytes,
        filename: "ready-card.jpg".into(),
    })
}

pub async fn for_card(state: &AppState, card: &ReadyCard) -> Result<ReadyImage, AppError> {
    let card = card.clone();
    let artwork = Artwork::load(state)?;
    tokio::task::spawn_blocking(move || render(&card, &artwork))
        .await
        .map_err(|error| AppError::Image(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card() -> ReadyCard {
        ReadyCard {
            customer: "أحمد المنصوري".into(),
            receipt: "INV-42".into(),
            measurement: "C-6216-001".into(),
            balance: "12.500 BHD".into(),
            date: "25-11-2026".into(),
        }
    }

    fn render_card(card: &ReadyCard) -> ReadyImage {
        render(card, &Artwork::from_bytes(BUNDLED_ARTWORK).unwrap()).unwrap()
    }

    #[test]
    fn jpeg_is_deterministic_and_readable_without_system_fonts() {
        let first = render_card(&card());
        let second = render_card(&card());
        let decoded = image::load_from_memory(&first.bytes).unwrap().to_rgb8();
        assert_eq!(decoded.dimensions(), (WIDTH, HEIGHT));
        assert!(first.bytes.len() < rendering::MAX_BYTES);
        assert_eq!(first.bytes, second.bytes);
        assert_eq!(first.sha256, hash(&first.bytes));
        assert_eq!(first.filename, "ready-card.jpg");
        if let Ok(output) = std::env::var("READY_CARD_IMAGE_TEST_OUTPUT") {
            std::fs::write(output, &first.bytes).unwrap();
        }
    }

    #[test]
    fn filled_values_are_drawn_on_the_dotted_fields() {
        let env = environment().unwrap();
        let values = fields(&env, &card());
        let names: Vec<_> = values.iter().map(|field| field.name).collect();
        assert_eq!(
            names,
            ["customer", "receipt", "measurement", "balance", "date"]
        );
        for field in &values {
            assert!(!field.text.is_empty());
            assert!(field.y > 900 && field.y < 1600);
            assert!(field.size <= BASE_SIZE);
        }
        let source = env
            .get_template("ready-card.svg")
            .unwrap()
            .render(context! {
                background => "data:image/jpeg;base64,AA",
                fields => values,
            })
            .unwrap();
        assert!(source.contains("أحمد المنصوري"));
        assert!(source.contains("INV-42"));
        assert!(source.contains("C-6216-001"));
        assert!(source.contains("12.500 BHD"));
        assert!(source.contains("25-11-2026"));
        assert!(source.contains("font-family=\"Space Grotesk\""));
        assert!(source.contains("text-anchor=\"middle\""));
    }

    #[test]
    fn long_values_shrink_and_empty_values_stay_blank() {
        let env = environment().unwrap();
        let long = ReadyCard {
            customer: "First Customer / Second Customer / Third Customer / Fourth Customer".into(),
            ..card()
        };
        let short = fields(&env, &card())[0].size;
        let shrunk = fields(&env, &long)[0].size;
        assert!(shrunk < short);
        let empty = &fields(
            &env,
            &ReadyCard {
                customer: String::new(),
                ..card()
            },
        )[0];
        assert_eq!(empty.text, "");
        assert_eq!(empty.size, BASE_SIZE);
    }

    #[test]
    fn join_values_deduplicates_and_caps_the_list() {
        assert_eq!(join_values(vec![" A ".into(), "A".into(), "".into()]), "A");
        assert_eq!(
            join_values(vec!["A".into(), "B".into(), "C".into(), "D".into()]),
            "A / B / C / +1"
        );
    }

    #[test]
    fn fingerprint_tracks_card_and_artwork() {
        let base = fingerprint(&card(), "artwork-a").unwrap();
        assert_eq!(base, fingerprint(&card(), "artwork-a").unwrap());
        assert_ne!(base, fingerprint(&card(), "artwork-b").unwrap());
        assert_ne!(
            base,
            fingerprint(
                &ReadyCard {
                    receipt: "INV-43".into(),
                    ..card()
                },
                "artwork-a"
            )
            .unwrap()
        );
    }

    #[test]
    fn invalid_artwork_errors() {
        assert!(Artwork::from_bytes(b"not an image").is_err());
    }
}
