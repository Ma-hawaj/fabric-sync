use std::{
    io::Cursor,
    sync::{Arc, OnceLock},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use image::codecs::jpeg::JpegEncoder;
use resvg::usvg;

use crate::error::AppError;

pub(crate) const MIME: &str = "image/jpeg";
pub(crate) const MAX_BYTES: usize = 5 * 1024 * 1024;
const JPEG_QUALITY: u8 = 85;

pub(crate) fn fonts() -> Arc<usvg::fontdb::Database> {
    static FONTS: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            let mut db = usvg::fontdb::Database::new();
            for data in [
                include_bytes!("../assets/fonts/DejaVuSans.ttf").as_slice(),
                include_bytes!("../assets/fonts/DejaVuSans-Bold.ttf").as_slice(),
                include_bytes!("../assets/fonts/DejaVuSansMono.ttf").as_slice(),
                include_bytes!("../assets/fonts/thmanyahserifdisplay-Bold.otf").as_slice(),
                include_bytes!("../assets/fonts/SpaceGrotesk-Medium.otf").as_slice(),
            ] {
                db.load_font_data(data.to_vec());
            }
            db.set_sans_serif_family("DejaVu Sans");
            db.set_monospace_family("DejaVu Sans Mono");
            Arc::new(db)
        })
        .clone()
}

pub(crate) fn encode_jpeg(rgb: &image::RgbImage) -> Result<Vec<u8>, AppError> {
    let mut bytes = Cursor::new(Vec::new());
    JpegEncoder::new_with_quality(&mut bytes, JPEG_QUALITY)
        .encode_image(rgb)
        .map_err(|error| AppError::Image(error.to_string()))?;
    Ok(bytes.into_inner())
}

pub(crate) fn jpeg_data_url(bytes: &[u8], error: &str) -> Result<String, AppError> {
    let decoded = image::load_from_memory(bytes)
        .map_err(|_| AppError::Image(error.to_owned()))?
        .to_rgb8();
    Ok(format!(
        "data:{MIME};base64,{}",
        STANDARD.encode(encode_jpeg(&decoded)?)
    ))
}
