//! Shared bits between the feature document renderers (invoices, orders):
//! the money/quantity formatting, the minijinja environment setup, and the
//! HTML-to-PDF conversion. One copy of each so the printed figures can't
//! drift between documents.
//!
//! PDFs are produced by a headless Chromium binary fed the same self-contained
//! HTML the browser used to print before. This is deliberate: Arabic needs a
//! real text shaper, which the pure-Rust PDF crates don't have, and Chromium
//! already is one — so the templates stay exactly as they are and the output
//! keeps the same shaping, fonts, QR SVG and WebP design thumbnails.

use std::time::Duration;

use axum::{
    body::Body,
    http::{header, HeaderValue},
    response::Response,
};
use minijinja::Environment;

use crate::{
    config::{InvoiceBranding, PdfConfig},
    error::AppError,
};

/// Currency of the printed amounts. Single-valued by design, matching
/// `CURRENCY` in the frontend's `src/lib/currency.ts`.
pub(crate) const CURRENCY: &str = "BHD";

/// Fils, not cents: BHD is a three-decimal currency. Amounts are still stored
/// and computed to two places (`NUMERIC(10, 2)`), so this only affects how
/// they are written out.
pub(crate) const CURRENCY_DECIMALS: usize = 3;

pub(crate) fn format_amount(value: f64) -> String {
    format!("{value:.CURRENCY_DECIMALS$}")
}

/// Quantities are not money: 3 metres is "3", not "3.000", but 3.25 metres
/// still has to keep its fraction. Trailing zeros are trimmed rather than a
/// fixed precision applied.
pub(crate) fn format_quantity(value: f64) -> String {
    let text = format!("{value:.2}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    text.to_string()
}

/// A minijinja environment that loads the named template from
/// `INVOICE_TEMPLATE_DIR` when it is set, else the copy embedded in the
/// binary. Both the invoice and the order document live in the same templates
/// directory, so the one env var serves both.
pub(crate) fn template_environment(
    branding: &InvoiceBranding,
    template_name: &'static str,
    embedded: &'static str,
) -> Result<Environment<'static>, AppError> {
    let mut env = Environment::new();

    match &branding.template_dir {
        // Loading from disk means the document can be restyled and the change
        // seen on the next request, with no rebuild and no redeploy.
        Some(dir) => env.set_loader(minijinja::path_loader(dir)),
        None => env.add_template(template_name, embedded)?,
    }

    Ok(env)
}

/// Turns a self-contained document HTML page into PDF bytes using headless
/// Chromium's `--print-to-pdf`. The page sizes itself via its own `@page`
/// rule (A4, see the templates); `--no-pdf-header-footer` suppresses
/// Chromium's default URL/date header so only the document prints.
pub(crate) async fn render_html_to_pdf(
    html: &str,
    config: &PdfConfig,
) -> Result<Vec<u8>, AppError> {
    let dir = tempfile::tempdir()
        .map_err(|error| AppError::Pdf(format!("could not create a temp dir: {error}")))?;
    let input = dir.path().join("document.html");
    let output = dir.path().join("document.pdf");
    tokio::fs::write(&input, html)
        .await
        .map_err(|error| AppError::Pdf(format!("could not write the document HTML: {error}")))?;

    // A file:// URL: the documents are fully self-contained (inline styles,
    // inline SVG, data: URIs), so the renderer needs no network access.
    let url = format!("file://{}", input.display());
    let output_arg = format!("--print-to-pdf={}", output.display());

    let mut command = tokio::process::Command::new(&config.chromium_bin);
    command
        .arg("--headless=new")
        .arg("--disable-gpu")
        .arg("--no-sandbox")
        .arg("--disable-dev-shm-usage")
        .arg("--hide-scrollbars")
        .arg("--no-pdf-header-footer")
        .arg("--print-to-pdf-no-header")
        // Lets webfonts and images settle before the PDF is captured, so a
        // cold renderer doesn't print blank boxes where the logo or design
        // thumbnails belong.
        .arg("--virtual-time-budget=5000")
        .arg(output_arg)
        .arg(url);

    let timeout = Duration::from_secs(config.timeout_secs.max(1));
    let result = tokio::time::timeout(timeout, command.output()).await;

    match result {
        Err(_) => Err(AppError::Pdf(format!(
            "the PDF renderer timed out after {}s",
            config.timeout_secs
        ))),
        Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(AppError::Pdf(format!(
                "the PDF renderer was not found at '{}': install Chromium \
                 in the runtime image or set CHROMIUM_BIN",
                config.chromium_bin
            )))
        }
        Ok(Err(error)) => Err(AppError::Pdf(format!(
            "could not start the PDF renderer: {error}"
        ))),
        Ok(Ok(render)) if !render.status.success() => Err(AppError::Pdf(format!(
            "the PDF renderer failed: {}",
            stderr_tail(&render.stderr)
        ))),
        // A zero exit doesn't guarantee a file: a sandboxed renderer (notably
        // the snap Chromium, which sees its own /tmp) can report success
        // while writing nothing to the host path. Its stderr is the only
        // witness, so it goes into the error rather than being discarded.
        Ok(Ok(render)) => match tokio::fs::read(&output).await {
            Err(error) => Err(AppError::Pdf(format!(
                "the PDF renderer exited successfully but wrote no file to '{}': \
                 {error}; renderer output: {}",
                output.display(),
                stderr_tail(&render.stderr)
            ))),
            Ok(bytes) if !bytes.starts_with(b"%PDF") => Err(AppError::Pdf(format!(
                "the PDF renderer wrote {} bytes that are not a PDF \
                 (missing %PDF header); renderer output: {}",
                bytes.len(),
                stderr_tail(&render.stderr)
            ))),
            Ok(bytes) => Ok(bytes),
        },
    }
}

/// The tail of the renderer's stderr for error messages, which become HTTP
/// response bodies — capped so a chatty renderer can't bloat the response.
/// The reason is usually last (e.g. Chromium's `Failed to write file …`).
fn stderr_tail(stderr: &[u8]) -> String {
    const LIMIT: usize = 1000;
    let text = String::from_utf8_lossy(stderr);
    let text = text.trim();
    if text.len() <= LIMIT {
        return text.to_string();
    }
    // Cut on a character boundary, keeping the tail where the reason lives.
    let mut start = text.len() - LIMIT;
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    format!("…{}", &text[start..])
}

/// A `200 application/pdf` response that shows inline in the browser with a
/// download filename. Both document endpoints share it so the headers can't
/// drift between the invoice and the order sheet.
pub(crate) fn pdf_response(bytes: Vec<u8>, filename: &str) -> Response {
    let disposition = format!("inline; filename=\"{filename}\"");
    Response::builder()
        .status(200)
        .header(header::CONTENT_TYPE, "application/pdf")
        .header(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&disposition)
                .unwrap_or_else(|_| HeaderValue::from_static("inline")),
        )
        .body(Body::from(bytes))
        .expect("a PDF response has no invalid header values")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pdf_response_carries_the_content_type_and_filename() {
        let response = pdf_response(vec![1, 2, 3], "INV-7.pdf");
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/pdf");
        assert_eq!(
            response.headers()[header::CONTENT_DISPOSITION],
            "inline; filename=\"INV-7.pdf\""
        );
    }

    #[test]
    fn renderer_stderr_is_trimmed_and_capped_for_response_bodies() {
        assert_eq!(
            stderr_tail(b"  Failed to write file x: nope (2)\n"),
            "Failed to write file x: nope (2)"
        );
        assert_eq!(stderr_tail(b""), "");
        let long = "e".repeat(2500);
        let tail = stderr_tail(long.as_bytes());
        assert!(tail.len() <= 1004, "unexpected length {}", tail.len());
        assert!(tail.ends_with(&"e".repeat(1000)));
    }

    /// A renderer that exits zero without writing anything (what the snap
    /// Chromium does on a host /tmp path) must surface the renderer's own
    /// output, not a bare filesystem error. `/bin/true` plays the silent
    /// renderer; skipped where it doesn't exist.
    #[tokio::test]
    async fn a_silent_successful_renderer_reports_its_own_output() {
        if tokio::process::Command::new("/bin/true")
            .output()
            .await
            .is_err()
        {
            eprintln!("skipping: no /bin/true on this machine");
            return;
        }
        let config = PdfConfig {
            chromium_bin: "/bin/true".to_string(),
            timeout_secs: 10,
        };
        let error = render_html_to_pdf("<html></html>", &config)
            .await
            .unwrap_err();
        let message = format!("{error:?}");
        assert!(
            message.contains("wrote no file"),
            "unexpected error: {message}"
        );
    }

    /// A renderer that writes non-PDF bytes is rejected rather than served as
    /// `application/pdf`. The fake renderer is a shell script that drops
    /// garbage at whatever `--print-to-pdf=` path it is given.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_renderer_that_writes_no_pdf_is_rejected() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().expect("a temp dir");
        let script = dir.path().join("fake-renderer.sh");
        std::fs::write(
            &script,
            "#!/bin/sh\nfor arg in \"$@\"; do\n  case \"$arg\" in \
             --print-to-pdf=*) printf 'garbage' > \"${arg#--print-to-pdf=}\";; \
             esac\ndone\n",
        )
        .expect("the fake renderer");
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
            .expect("chmod +x");

        let config = PdfConfig {
            chromium_bin: script.to_string_lossy().into_owned(),
            timeout_secs: 10,
        };
        let error = render_html_to_pdf("<html></html>", &config)
            .await
            .unwrap_err();
        let message = format!("{error:?}");
        assert!(message.contains("not a PDF"), "unexpected error: {message}");
    }

    #[tokio::test]
    async fn a_missing_renderer_binary_is_a_pdf_error_naming_the_fix() {
        let config = PdfConfig {
            chromium_bin: "/nonexistent/chromium-for-tests".to_string(),
            timeout_secs: 5,
        };
        let error = render_html_to_pdf("<html></html>", &config)
            .await
            .unwrap_err();
        let message = format!("{error:?}");
        assert!(
            message.contains("CHROMIUM_BIN"),
            "unexpected error: {message}"
        );
    }

    /// End-to-end through a real Chromium: a self-contained page (Arabic RTL
    /// plus inline SVG, like the invoice templates) comes back as `%PDF`
    /// bytes. Skipped unless `CHROMIUM_BIN` points at a *working* binary — a
    /// present-but-sandboxed one (notably the snap Chromium, which cannot
    /// write to the host /tmp yet exits zero) skips too, with its error
    /// printed. CI must provide a non-snap Chromium to exercise this.
    #[tokio::test]
    async fn chromium_renders_a_self_contained_page_to_pdf_when_installed() {
        let bin = std::env::var("CHROMIUM_BIN").unwrap_or_else(|_| "chromium".to_string());
        if tokio::process::Command::new(&bin)
            .arg("--version")
            .output()
            .await
            .is_err()
        {
            eprintln!("skipping: no Chromium binary at '{bin}' (set CHROMIUM_BIN)");
            return;
        }

        let config = PdfConfig {
            chromium_bin: bin.clone(),
            timeout_secs: 60,
        };
        let html = "<!doctype html><html lang=\"ar\" dir=\"rtl\"><head>\
            <meta charset=\"utf-8\" /><style>@page { size: A4; margin: 12mm; } \
            body { font-family: sans-serif; }</style></head>\
            <body><h1>INV-7 فاتورة</h1>\
            <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"60\" height=\"60\">\
            <rect width=\"60\" height=\"60\" fill=\"#1d4ed8\" /></svg>\
            </body></html>";
        let pdf = match render_html_to_pdf(html, &config).await {
            Ok(pdf) => pdf,
            Err(error) => {
                eprintln!("skipping: the Chromium at '{bin}' cannot render: {error:?}");
                return;
            }
        };

        assert!(
            pdf.starts_with(b"%PDF"),
            "expected PDF bytes, got {} bytes starting with {:?}",
            pdf.len(),
            &pdf[..pdf.len().min(8)]
        );
        assert!(pdf.len() > 1000, "suspiciously small PDF: {}", pdf.len());
    }
}
