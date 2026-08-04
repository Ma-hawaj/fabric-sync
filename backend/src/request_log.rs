use std::time::Instant;

use axum::{
    extract::{MatchedPath, Request},
    http::HeaderName,
    middleware::Next,
    response::Response,
};
use tracing::Instrument;
use uuid::Uuid;

static REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");

/// One canonical log line per request, instead of many scattered ones. This
/// is the outermost layer in `app.rs` — outside every `require_auth` route
/// layer — so the span it opens is `tracing::Span::current()` for the whole
/// request, and downstream code (auth, `AppError::into_response`, business
/// logic) can `.record()` onto it rather than emitting its own log line.
///
/// Fields are declared upfront (`tracing::field::Empty`) because a `tracing`
/// span's schema is fixed at creation; this only covers what's known to be
/// worth a column across every request. Anything request-specific belongs in
/// its own event nested under this span, not as a new field here.
pub async fn log_request(request: Request, next: Next) -> Response {
    let method = request.method().clone();
    // The matched route pattern (e.g. `/orders/:id`), not the raw path — the
    // raw path is one value per row (an id in it), which would make `path`
    // useless to group or filter by.
    let path = request
        .extensions()
        .get::<MatchedPath>()
        .map(|matched| matched.as_str().to_string())
        .unwrap_or_else(|| request.uri().path().to_string());
    let request_id = Uuid::new_v4();

    let span = tracing::info_span!(
        "request",
        request_id = %request_id,
        method = %method,
        path = %path,
        status = tracing::field::Empty,
        duration_ms = tracing::field::Empty,
        user_id = tracing::field::Empty,
        client_id = tracing::field::Empty,
        error = tracing::field::Empty,
    );

    let start = Instant::now();
    let mut response = next.run(request).instrument(span.clone()).await;
    let duration_ms = start.elapsed().as_millis();

    span.record("status", response.status().as_u16());
    span.record("duration_ms", duration_ms);

    if let Ok(header_value) = request_id.to_string().parse() {
        response
            .headers_mut()
            .insert(REQUEST_ID_HEADER.clone(), header_value);
    }

    span.in_scope(|| {
        tracing::info!("request completed");
    });

    response
}
