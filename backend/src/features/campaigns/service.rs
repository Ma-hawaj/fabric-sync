use super::{repository as store, types::*};
use crate::{error::AppError, state::AppState};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgConnection, PgPool};
use std::collections::BTreeMap;
use uuid::Uuid;

fn bad(message: &str) -> AppError {
    AppError::BadRequest(message.into())
}
pub fn render(body: &str, parameters: &[String]) -> Result<String, AppError> {
    // Parse rather than repeated replacement: parameter values cannot introduce
    // other parameters and literal braces are never silently sent to customers.
    let mut result = String::new();
    let mut rest = body;
    let mut seen = std::collections::BTreeSet::new();
    while let Some(start) = rest.find("{{") {
        result.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let end = after
            .find("}}")
            .ok_or_else(|| bad("Close every template placeholder."))?;
        let index: usize = after[..end]
            .parse()
            .map_err(|_| bad("Use numbered placeholders such as {{1}}."))?;
        if index == 0 || index > parameters.len() {
            return Err(bad("Provide a value for every template placeholder."));
        }
        seen.insert(index);
        result.push_str(&parameters[index - 1]);
        rest = &after[end + 2..];
    }
    result.push_str(rest);
    if result.contains("{{") || result.contains("}}") || seen.len() != parameters.len() {
        return Err(bad(
            "Template placeholders must be consecutive and match the supplied values.",
        ));
    }
    if parameters
        .iter()
        .any(|v| v.trim().is_empty() || v.len() > 1024)
    {
        return Err(bad(
            "Template values must be non-empty and at most 1024 bytes.",
        ));
    }
    Ok(result)
}
pub fn validate_template(input: &TemplateInput) -> Result<(), AppError> {
    if input.name.is_empty()
        || input.name.len() > 512
        || !input
            .name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    {
        return Err(bad(
            "Use lowercase letters, numbers and underscores for the template name.",
        ));
    }
    if input.language.is_empty()
        || input.language.len() > 16
        || !input
            .language
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return Err(bad("Select a valid Meta language code."));
    }
    let d = &input.definition;
    if d.body.trim().is_empty() || d.body.chars().count() > 1024 {
        return Err(bad("Enter a template body of at most 1024 characters."));
    }
    render(&d.body, &d.examples)?;
    if d.footer
        .as_ref()
        .is_some_and(|v| v.chars().count() > 60 || v.contains("{{"))
    {
        return Err(bad("Use a static footer of at most 60 characters."));
    }
    if d.unsubscribe_label.trim().is_empty() || d.unsubscribe_label.chars().count() > 25 {
        return Err(bad(
            "Enter an unsubscribe button label of at most 25 characters.",
        ));
    }
    if d.image_header != d.sample_asset_id.is_some() {
        return Err(bad(
            "Image templates require a sample image; text templates cannot have one.",
        ));
    }
    match (&d.website_url, &d.website_label) {
        (Some(url), Some(label)) => {
            let parsed =
                reqwest::Url::parse(url).map_err(|_| bad("Enter a valid HTTPS website URL."))?;
            if parsed.scheme() != "https"
                || parsed.host_str().is_none()
                || !parsed.username().is_empty()
                || parsed.password().is_some()
                || url.contains("{{")
                || label.trim().is_empty()
                || label.chars().count() > 25
            {
                return Err(bad(
                    "Use a static HTTPS URL and a button label of at most 25 characters.",
                ));
            }
        }
        (None, None) => {}
        _ => return Err(bad("Provide both the website URL and its button label.")),
    }
    Ok(())
}
fn decimal(raw: &str) -> Option<u128> {
    let mut parts = raw.split('.');
    let whole = parts.next()?;
    let fraction = parts.next().unwrap_or("");
    if whole.is_empty()
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || fraction.len() > 2
        || !fraction.bytes().all(|b| b.is_ascii_digit())
        || parts.next().is_some()
    {
        return None;
    }
    whole
        .parse::<u128>()
        .ok()?
        .checked_mul(100)?
        .checked_add(format!("{fraction:0<2}").parse::<u128>().ok()?)
}
pub fn validate_campaign(input: &CampaignInput) -> Result<(), AppError> {
    if input.name.trim().is_empty() || input.name.chars().count() > 200 {
        return Err(bad("Enter a campaign name of at most 200 characters."));
    }
    let now = Utc::now();
    if input.expires_at <= now
        || input
            .send_at
            .is_some_and(|at| at <= now || at >= input.expires_at)
    {
        return Err(bad(
            "Choose a future sending time and a later sending deadline.",
        ));
    }
    validate_audience(&input.audience)
}
pub fn validate_audience(f: &AudienceFilter) -> Result<(), AppError> {
    if f.min_purchases.is_some_and(|v| v < 0)
        || f.max_purchases.is_some_and(|v| v < 0)
        || matches!((f.min_purchases,f.max_purchases),(Some(a),Some(b)) if a>b)
        || matches!((f.last_purchase_from,f.last_purchase_to),(Some(a),Some(b)) if a>b)
    {
        return Err(bad("Audience minimums must not exceed maximums."));
    }
    let low = f.min_spend.as_deref().map(decimal).transpose_option()?;
    let high = f.max_spend.as_deref().map(decimal).transpose_option()?;
    if matches!((low,high),(Some(a),Some(b)) if a>b) {
        return Err(bad(
            "Minimum purchase value cannot exceed maximum purchase value.",
        ));
    }
    if f.never_purchased
        && (f.last_purchase_from.is_some()
            || f.last_purchase_to.is_some()
            || f.branch_id.is_some()
            || f.min_purchases.is_some_and(|v| v > 0)
            || low.is_some_and(|v| v > 0))
    {
        return Err(bad(
            "Never-purchased customers cannot also require a purchase.",
        ));
    }
    Ok(())
}
trait DecimalResult {
    fn transpose_option(self) -> Result<Option<u128>, AppError>;
}
impl DecimalResult for Option<Option<u128>> {
    fn transpose_option(self) -> Result<Option<u128>, AppError> {
        match self {
            None => Ok(None),
            Some(Some(v)) => Ok(Some(v)),
            Some(None) => Err(bad(
                "Enter non-negative purchase values with at most two decimal places.",
            )),
        }
    }
}
pub async fn audience(
    state: &AppState,
    db: &mut PgConnection,
    filter: &AudienceFilter,
) -> Result<(Vec<Destination>, Vec<Destination>), AppError> {
    let customers = store::audience(db, filter, &state.timezone()?.to_string()).await?;
    let excluded_mobiles: std::collections::BTreeSet<String> =
        store::excluded_mobiles(db, &filter.excluded_customer_ids)
            .await?
            .into_iter()
            .filter_map(|raw| {
                crate::features::notifications::phone::normalize(
                    &raw,
                    &state.notifications().default_region,
                )
            })
            .collect();
    let mut grouped = BTreeMap::<String, Destination>::new();
    let mut excluded = Vec::new();
    for c in customers {
        let normalized = crate::features::notifications::phone::normalize(
            &c.mobile_no,
            &state.notifications().default_region,
        );
        let Some(mobile) = normalized else {
            excluded.push(Destination {
                mobile: c.mobile_no.clone(),
                customers: vec![c],
                consent_version: None,
                excluded_reason: Some("Missing or invalid mobile number.".into()),
            });
            continue;
        };
        // An explicit customer exclusion also excludes a shared phone destination.
        let manually_excluded = excluded_mobiles.contains(&mobile);
        let d = grouped.entry(mobile.clone()).or_insert(Destination {
            mobile,
            customers: vec![],
            consent_version: None,
            excluded_reason: None,
        });
        d.customers.push(c);
        if manually_excluded {
            d.excluded_reason = Some("Excluded from this campaign.".into());
        }
    }
    let mut destinations = Vec::new();
    let mobiles: Vec<String> = grouped.keys().cloned().collect();
    let mut consents: BTreeMap<String, Consent> = store::consents(db, &mobiles)
        .await?
        .into_iter()
        .map(|c| (c.mobile.clone(), c))
        .collect();
    for mut d in grouped.into_values() {
        let consent = consents.remove(&d.mobile);
        if let Some(c) = consent.filter(|c| c.granted) {
            d.consent_version = Some(c.version);
        } else {
            d.excluded_reason = Some("No current WhatsApp marketing consent.".into());
        }
        if d.excluded_reason.is_some() {
            excluded.push(d);
        } else {
            destinations.push(d);
        }
    }
    Ok((destinations, excluded))
}

pub async fn audience_count(
    state: &AppState,
    filter: &AudienceFilter,
) -> Result<AudienceCount, AppError> {
    validate_audience(filter)?;
    let mut db = state.db().acquire().await?;
    let (destinations, excluded) = audience(state, &mut db, filter).await?;
    let excluded_customers: usize = excluded.iter().map(|d| d.customers.len()).sum();
    Ok(AudienceCount {
        message_count: destinations.len(),
        matching_customers: destinations
            .iter()
            .map(|d| d.customers.len())
            .sum::<usize>()
            + excluded_customers,
        excluded_customers,
    })
}
pub async fn build_preview(
    state: &AppState,
    db: &mut PgConnection,
    c: &Campaign,
    version: Uuid,
) -> Result<Preview, AppError> {
    validate_campaign(&c.definition)?;
    let template = store::template(db, c.definition.template_id).await?;
    if template.state != "approved" || template.archived {
        return Err(AppError::Conflict(
            "Choose an approved, active marketing template.".into(),
        ));
    }
    let body = render(&template.definition.body, &c.definition.parameters)?;
    if template.definition.image_header != c.definition.asset_id.is_some() {
        return Err(bad(
            "Provide an image exactly when the approved template requires one.",
        ));
    }
    let asset_sha256 = if let Some(id) = c.definition.asset_id {
        Some(store::asset(db, id).await?.0.sha256)
    } else {
        None
    };
    let (destinations, excluded) = audience(state, db, &c.definition.audience).await?;
    Ok(Preview {
        version,
        revision: c.revision,
        template: template.into(),
        body,
        parameters: c.definition.parameters.clone(),
        asset_id: c.definition.asset_id,
        asset_sha256,
        send_at: c.definition.send_at,
        expires_at: c.definition.expires_at,
        destinations,
        excluded,
    })
}
pub async fn preview(state: &AppState, id: Uuid) -> Result<Preview, AppError> {
    let mut tx = state.db().begin().await?;
    store::consent_lock(&mut tx).await?;
    let c = store::campaign(&mut tx, id, true).await?;
    if c.state != "draft" {
        return Err(AppError::Conflict(
            "Only drafts can be prepared for approval.".into(),
        ));
    }
    let p = build_preview(state, &mut tx, &c, Uuid::new_v4()).await?;
    store::save_preview(&mut tx, id, &p).await?;
    tx.commit().await?;
    Ok(p)
}
pub async fn approve(
    state: &AppState,
    id: Uuid,
    input: ApproveInput,
    actor: &str,
) -> Result<Campaign, AppError> {
    let mut tx = state.db().begin().await?;
    store::consent_lock(&mut tx).await?;
    if let Some(previous) = store::approval_request(&mut tx, input.request_id).await? {
        if previous != id {
            return Err(AppError::Conflict(
                "Approval request belongs to another campaign.".into(),
            ));
        }
        return store::campaign(&mut tx, id, false).await;
    }
    let c = store::campaign(&mut tx, id, true).await?;
    if c.state != "draft"
        || c.revision != input.expected_revision
        || c.preview_version != Some(input.preview_version)
    {
        return Err(AppError::Conflict(
            "Campaign changed. Review a fresh preview.".into(),
        ));
    }
    let p = build_preview(state, &mut tx, &c, input.preview_version).await?;
    if c.preview.as_ref() != Some(&json!(p)) {
        return Err(AppError::Conflict(
            "Audience, consent, template or image changed. Review a fresh preview.".into(),
        ));
    }
    if p.destinations.is_empty() {
        return Err(bad("Select at least one customer with marketing consent."));
    }
    if !state.notifications().can_send() || !state.notifications().marketing_enabled {
        return Err(AppError::Unavailable(
            "WhatsApp marketing delivery is disabled or not configured.".into(),
        ));
    }
    store::approve(&mut tx, &c, &p, &input, actor).await?;
    let c = store::campaign(&mut tx, id, false).await?;
    tx.commit().await?;
    Ok(c)
}
pub async fn get_consent(state: &AppState, id: Uuid) -> Result<Value, AppError> {
    let mut db = state.db().acquire().await?;
    let raw = store::customer_mobile(&mut db, id).await?;
    let mobile = crate::features::notifications::phone::normalize(
        &raw,
        &state.notifications().default_region,
    );
    let consent = if let Some(ref m) = mobile {
        store::consent(&mut db, m).await?
    } else {
        None
    };
    Ok(json!({"mobile":mobile,"consent":consent}))
}
pub async fn consent(
    state: &AppState,
    id: Uuid,
    input: ConsentInput,
    actor: &str,
) -> Result<Value, AppError> {
    if input.source.trim().is_empty() || input.source.len() > 1000 || input.observed_at > Utc::now()
    {
        return Err(bad(
            "Record how consent was obtained and a time that is not in the future.",
        ));
    }
    let mut tx = state.db().begin().await?;
    store::consent_lock(&mut tx).await?;
    let raw = store::customer_mobile(&mut tx, id).await?;
    let mobile = crate::features::notifications::phone::normalize(
        &raw,
        &state.notifications().default_region,
    )
    .ok_or_else(|| bad("Save a valid customer mobile number first."))?;
    if mobile != input.expected_mobile {
        return Err(AppError::Conflict(
            "Customer phone changed. Reload consent details.".into(),
        ));
    }
    store::record_consent(
        &mut tx,
        &mobile,
        input.granted,
        input.observed_at,
        &input.source,
        actor,
        None,
    )
    .await?;
    tx.commit().await?;
    get_consent(state, id).await
}
pub async fn upload(state: &AppState, input: AssetInput, actor: &str) -> Result<Asset, AppError> {
    if input.filename.is_empty()
        || input.filename.len() > 180
        || input.filename.contains(['/', '\\', '\r', '\n', '"'])
    {
        return Err(bad("Enter a valid image filename."));
    }
    let bytes = STANDARD
        .decode(&input.data_base64)
        .map_err(|_| bad("Invalid image encoding."))?;
    let valid = match input.mime_type.as_str() {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        _ => false,
    };
    if !valid || bytes.is_empty() || bytes.len() > 5 * 1024 * 1024 {
        return Err(bad("Upload a PNG or JPEG image of at most 5 MB."));
    }
    store::insert_asset(
        state.db(),
        &input,
        &bytes,
        &crate::features::notifications::service::hash(&bytes),
        actor,
    )
    .await
}
pub async fn delivery_event(
    db: &mut PgConnection,
    id: &str,
    incoming: &str,
    status: &Value,
) -> Result<bool, AppError> {
    store::delivery_event(
        db,
        id,
        incoming,
        if incoming == "failed" {
            Some(status["errors"].to_string())
        } else {
            None
        }
        .as_deref(),
    )
    .await
}
pub fn is_unsubscribe(message: &Value) -> bool {
    message["button"]["payload"].as_str() == Some("MARKETING_UNSUBSCRIBE")
        || message["interactive"]["button_reply"]["id"].as_str() == Some("MARKETING_UNSUBSCRIBE")
        || message["text"]["body"].as_str().is_some_and(|v| {
            ["STOP", "UNSUBSCRIBE", "إلغاء", "الغاء"].contains(&v.trim().to_uppercase().as_str())
        })
}
pub async fn webhook(db: &PgPool, payload: &Value) -> Result<(), AppError> {
    for entry in payload["entry"].as_array().into_iter().flatten() {
        for change in entry["changes"].as_array().into_iter().flatten() {
            let value = &change["value"];
            if change["field"] == "message_template_status_update" {
                let id = value["message_template_id"]
                    .as_str()
                    .map(str::to_owned)
                    .or_else(|| value["message_template_id"].as_u64().map(|v| v.to_string()));
                if let Some(id) = id {
                    store::template_event(
                        db,
                        &id,
                        &value["event"].as_str().unwrap_or("unknown").to_lowercase(),
                        value["reason"].as_str(),
                    )
                    .await?;
                }
            }
            for message in value["messages"].as_array().into_iter().flatten() {
                if !is_unsubscribe(message) {
                    continue;
                }
                let (Some(from), Some(id), Some(timestamp)) = (
                    message["from"].as_str(),
                    message["id"].as_str(),
                    message["timestamp"]
                        .as_str()
                        .and_then(|v| v.parse::<i64>().ok()),
                ) else {
                    continue;
                };
                let Some(at) = DateTime::from_timestamp(timestamp, 0) else {
                    continue;
                };
                let mobile = format!("+{}", from.trim_start_matches('+'));
                if !mobile[1..].bytes().all(|v| v.is_ascii_digit())
                    || !(9..=16).contains(&mobile.len())
                {
                    continue;
                }
                let mut tx = db.begin().await?;
                store::consent_lock(&mut tx).await?;
                store::record_consent(
                    &mut tx,
                    &mobile,
                    false,
                    at,
                    "WhatsApp unsubscribe",
                    "whatsapp",
                    Some(id),
                )
                .await?;
                store::attribute_unsubscribe(
                    &mut tx,
                    &mobile,
                    message["context"]["id"].as_str(),
                    at,
                )
                .await?;
                tx.commit().await?;
            }
        }
    }
    Ok(())
}
