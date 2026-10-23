use std::collections::{HashMap, HashSet};

use uuid::Uuid;

use crate::{error::AppError, list, state::AppState};

use super::{
    repository,
    types::{CreateDesignOptionInput, DesignAsset, DesignOption, UpdateDesignOptionInput},
};

/// The fixed order design slots, matching the `orders` columns and the
/// catalog sections: `neck` is the collar, `front_pocket` the `fPocket` field,
/// `side_pocket` the `sPocket` field, `thob_type` the `thobeType` field. New
/// slots are a schema change, not a row — only the options inside these are
/// dynamic.
pub const CATEGORIES: [&str; 7] = [
    "thob_type",
    "neck",
    "sleeve",
    "front_pocket",
    "side_pocket",
    "patti",
    "emd",
];

/// Upper bound on an uploaded illustration. Chip display never exceeds ~150px
/// and the printed invoice shows ~52px, so anything bigger is wasted bytes in
/// the table.
const MAX_IMAGE_BYTES: usize = 2 * 1024 * 1024;

fn normalized_category(category: &str) -> Result<String, AppError> {
    let category = category.trim();
    if CATEGORIES.contains(&category) {
        Ok(category.to_string())
    } else {
        Err(AppError::BadRequest("unknown design category".to_string()))
    }
}

// The slug is the stored identity written onto `orders`, so it only has to be
// non-blank and short — EMD seeds the exact entered values ("6", "Zik Zak"),
// which are neither lowercase nor hyphenated. Uniqueness per category comes
// from the database constraint and surfaces as a 409 through `error.rs`.
fn normalized_slug(slug: &str) -> Result<String, AppError> {
    let slug = slug.trim();
    if slug.is_empty() {
        return Err(AppError::BadRequest(
            "design option id cannot be empty".to_string(),
        ));
    }
    if slug.len() > 60 {
        return Err(AppError::BadRequest(
            "design option id must be 60 characters or fewer".to_string(),
        ));
    }
    Ok(slug.to_string())
}

fn normalized_label(label: &str) -> Result<String, AppError> {
    let label = label.trim();
    if label.is_empty() {
        return Err(AppError::BadRequest(
            "design option label cannot be empty".to_string(),
        ));
    }
    if label.len() > 120 {
        return Err(AppError::BadRequest(
            "design option label must be 120 characters or fewer".to_string(),
        ));
    }
    Ok(label.to_string())
}

fn validate_sort_order(sort_order: i32) -> Result<(), AppError> {
    if sort_order < 1 {
        return Err(AppError::BadRequest(
            "a design position must be 1 or more".to_string(),
        ));
    }
    Ok(())
}

/// The next position at the end of a category, so a create without an explicit
/// position appends rather than colliding with position 1.
async fn next_sort_order(state: &AppState, category: &str) -> Result<i32, AppError> {
    let row = sqlx::query!(
        r#"
        SELECT COALESCE(MAX(sort_order), 0) + 1 AS "next!"
        FROM design_options
        WHERE category = $1
        "#,
        category,
    )
    .fetch_one(state.db())
    .await?;
    Ok(row.next)
}

/// Decodes a `data:image/<svg|webp|png|jpeg>;base64,...` URL into bytes plus
/// mime. The magic bytes are checked against the claimed type so a mislabeled
/// upload can't land a PNG in a webp-only pipeline later. SVG is sniffed as
/// text (`<svg` after an optional XML prolog and whitespace) rather than by
/// magic bytes; it renders through `<img>` and print `data:` URIs exactly
/// like the rasters, so vectors can replace illustrations option by option
/// with no pipeline change.
fn decode_image_data_url(data_url: &str) -> Result<(Vec<u8>, String), AppError> {
    let invalid = || {
        AppError::BadRequest("design image must be a svg, webp, png or jpeg data URL".to_string())
    };
    let (prefix, encoded) = data_url.split_once(',').ok_or_else(invalid)?;
    let mime = match prefix.trim() {
        "data:image/svg+xml;base64" => "image/svg+xml",
        "data:image/webp;base64" => "image/webp",
        "data:image/png;base64" => "image/png",
        "data:image/jpeg;base64" => "image/jpeg",
        _ => return Err(invalid()),
    };
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded.trim())
        .map_err(|_| invalid())?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(AppError::BadRequest(
            "design image must be smaller than 2 MB".to_string(),
        ));
    }
    let magic_ok = match mime {
        "image/svg+xml" => is_svg(&bytes),
        "image/webp" => bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "image/png" => bytes.len() >= 8 && &bytes[0..8] == b"\x89PNG\r\n\x1a\n",
        _ => bytes.len() >= 3 && &bytes[0..3] == b"\xFF\xD8\xFF",
    };
    if !magic_ok {
        return Err(invalid());
    }
    Ok((bytes, mime.to_string()))
}

/// Sniffs an SVG document: optional whitespace, an optional `<?xml ...?>`
/// prolog, then `<svg`. Anything else (HTML, other XML) is rejected, and
/// scripts inside are inert anyway — illustrations only ever render through
/// `<img>` and print `data:` URIs, never inline markup.
fn is_svg(bytes: &[u8]) -> bool {
    let text = match std::str::from_utf8(bytes) {
        Ok(text) => text,
        Err(_) => return false,
    };
    let mut rest = text.trim_start();
    if let Some(after_prolog) = rest
        .strip_prefix("<?xml")
        .and_then(|prolog| prolog.find("?>").map(|end| &prolog[end + 2..]))
    {
        rest = after_prolog.trim_start();
    }
    rest.starts_with("<svg")
}

pub async fn list_options(
    state: &AppState,
    params: &list::ListParams,
) -> Result<list::Page<DesignOption>, AppError> {
    repository::list_options(state, params).await
}

pub async fn create_option(
    state: &AppState,
    input: CreateDesignOptionInput,
) -> Result<DesignOption, AppError> {
    crate::features::pricing::service::validate_amount(input.cost)?;
    let category = normalized_category(&input.category)?;
    let slug = normalized_slug(&input.slug)?;
    let label = normalized_label(&input.label)?;
    let sort_order = match input.sort_order {
        Some(sort_order) => {
            validate_sort_order(sort_order)?;
            sort_order
        }
        None => next_sort_order(state, &category).await?,
    };
    let (image, image_mime) = match input.image_data_url.as_deref() {
        Some(data_url) => {
            let (bytes, mime) = decode_image_data_url(data_url)?;
            (Some(bytes), mime)
        }
        None => (None, "image/webp".to_string()),
    };

    let option = repository::create_option(
        state,
        &category,
        &slug,
        &label,
        sort_order,
        image.as_deref(),
        &image_mime,
        input.cost,
    )
    .await?;

    tracing::info!(option_id = %option.id, category = %category, slug = %slug, "design catalog entry created");

    Ok(option)
}

pub async fn update_option(
    state: &AppState,
    option_id: Uuid,
    input: UpdateDesignOptionInput,
) -> Result<DesignOption, AppError> {
    let label = input.label.as_deref().map(normalized_label).transpose()?;
    if let Some(cost) = input.cost {
        crate::features::pricing::service::validate_amount(cost)?;
    }

    if let Some(sort_order) = input.sort_order {
        validate_sort_order(sort_order)?;
    }

    // Three-state illustration: absent leaves it, null clears it, a data URL
    // replaces it.
    let (touch_image, image, image_mime) = match input.image_data_url.as_ref() {
        None => (false, None, None),
        Some(None) => (true, None, None),
        Some(Some(data_url)) => {
            let (bytes, mime) = decode_image_data_url(data_url)?;
            (true, Some(bytes), Some(mime))
        }
    };

    let option = repository::update_option(
        state,
        option_id,
        label.as_deref(),
        input.sort_order,
        input.is_active,
        touch_image,
        image.as_deref(),
        image_mime.as_deref(),
        input.cost,
    )
    .await?
    .ok_or_else(|| AppError::NotFound(format!("design option {option_id} not found")))?;

    tracing::info!(
        option_id = %option_id,
        is_active = ?input.is_active,
        sort_order = ?input.sort_order,
        "design catalog entry updated"
    );

    Ok(option)
}

pub async fn get_image(
    state: &AppState,
    option_id: Uuid,
) -> Result<Option<(Vec<u8>, String)>, AppError> {
    Ok(repository::get_image(state, option_id).await?)
}

/// The catalog rows for a set of stored `(category, slug)` design values,
/// keyed for the document renderers. Missing pairs are simply absent — the
/// caller falls back per pair (see the documents' `resolve_design`).
pub async fn lookup_map(
    state: &AppState,
    pairs: &HashSet<(String, String)>,
) -> Result<HashMap<(String, String), DesignAsset>, AppError> {
    let pairs: Vec<(String, String)> = pairs.into_iter().cloned().collect();
    let assets = repository::lookup_assets(state, &pairs).await?;
    Ok(assets
        .into_iter()
        .map(|asset| ((asset.category.clone(), asset.slug.clone()), asset))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_category_accepts_only_the_seven_slots() {
        for category in CATEGORIES {
            assert_eq!(normalized_category(category).unwrap(), category);
        }
        for category in ["", "collar", "NECK", "buttons"] {
            let error = normalized_category(category).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{category:?}");
        }
    }

    #[test]
    fn normalized_slug_trims_but_keeps_case_for_emd_values() {
        assert_eq!(normalized_slug("  Zik Zak ").unwrap(), "Zik Zak");
        assert_eq!(normalized_slug("6").unwrap(), "6");
    }

    #[test]
    fn normalized_slug_rejects_blank_and_overlong_ids() {
        for slug in ["", "   "] {
            let error = normalized_slug(slug).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{slug:?}");
        }
        let error = normalized_slug(&"x".repeat(61)).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }

    #[test]
    fn normalized_label_rejects_blank_names() {
        for label in ["", "   ", "\t\n"] {
            let error = normalized_label(label).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{label:?}");
        }
    }

    #[test]
    fn validate_sort_order_rejects_zero_and_negatives() {
        for sort_order in [0, -1, -12] {
            let error = validate_sort_order(sort_order).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{sort_order}");
        }
        assert!(validate_sort_order(1).is_ok());
    }

    #[test]
    fn decode_image_data_url_accepts_a_webp_picture() {
        // Minimal RIFF....WEBP header; the magic check only reads the first
        // twelve bytes.
        let mut bytes = b"RIFF\x00\x00\x00\x00WEBP".to_vec();
        bytes.extend_from_slice(&[0u8; 16]);
        let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
        let (decoded, mime) =
            decode_image_data_url(&format!("data:image/webp;base64,{encoded}")).unwrap();
        assert_eq!(decoded, bytes);
        assert_eq!(mime, "image/webp");
    }

    #[test]
    fn decode_image_data_url_rejects_mislabeled_and_oversized_pictures() {
        let encoded = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            b"\x89PNG\r\n\x1a\nrest",
        );
        // PNG bytes claimed as webp.
        let error =
            decode_image_data_url(&format!("data:image/webp;base64,{encoded}")).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));

        // Not a data URL at all, and an unsupported type.
        for data_url in ["новичок", "data:image/gif;base64,R0lGODw=="] {
            let error = decode_image_data_url(data_url).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{data_url}");
        }

        // Over the size limit.
        let big = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &vec![0u8; MAX_IMAGE_BYTES + 1],
        );
        let error = decode_image_data_url(&format!("data:image/jpeg;base64,{big}")).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }

    #[test]
    fn decode_image_data_url_accepts_svg_with_or_without_a_prolog() {
        for svg in [
            "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
            "  <?xml version=\"1.0\"?>\n<svg></svg>",
        ] {
            let encoded =
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, svg.as_bytes());
            let (decoded, mime) =
                decode_image_data_url(&format!("data:image/svg+xml;base64,{encoded}")).unwrap();
            assert_eq!(decoded, svg.as_bytes());
            assert_eq!(mime, "image/svg+xml");
        }
    }

    #[test]
    fn decode_image_data_url_rejects_non_svg_markup_claimed_as_svg() {
        // HTML and non-svg XML are not illustrations, and binary is not text.
        for payload in [
            "<html><body>hi</body></html>".as_bytes().to_vec(),
            b"<?xml version=\"1.0\"?><note>hi</note>".to_vec(),
            b"\x89PNG\r\n\x1a\nrest".to_vec(),
        ] {
            let encoded =
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &payload);
            let error =
                decode_image_data_url(&format!("data:image/svg+xml;base64,{encoded}")).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)));
        }
    }
}
