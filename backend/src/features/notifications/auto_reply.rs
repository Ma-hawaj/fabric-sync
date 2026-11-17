use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{auto_reply_repository as repository, service, worker};
use crate::{error::AppError, state::AppState};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LinkButton {
    pub label: String,
    pub url: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub enabled: bool,
    pub message: String,
    pub cooldown_hours: i32,
    pub max_per_minute: i32,
    pub button: Option<sqlx::types::Json<LinkButton>>,
    #[sqlx(skip)]
    pub delivery_configured: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Update {
    pub enabled: bool,
    pub message: String,
    pub cooldown_hours: i32,
    pub max_per_minute: i32,
    #[serde(default)]
    pub button: Option<LinkButton>,
}

pub async fn settings(state: &AppState) -> Result<Settings, AppError> {
    let mut settings = repository::settings(state.db()).await?;
    settings.delivery_configured = state.notifications().can_send();
    Ok(settings)
}

pub async fn update(
    state: &AppState,
    mut input: Update,
    actor: &str,
) -> Result<Settings, AppError> {
    input.message = input.message.trim().into();
    if input.message.chars().count() > 4096 || (input.enabled && input.message.is_empty()) {
        return Err(AppError::BadRequest(
            "Enter a reply message of up to 4,096 characters before enabling automatic replies."
                .into(),
        ));
    }
    if !(1..=168).contains(&input.cooldown_hours) || !(1..=60).contains(&input.max_per_minute) {
        return Err(AppError::BadRequest("Choose a cooldown from 1 to 168 hours and a rate limit from 1 to 60 replies per minute.".into()));
    }
    if let Some(button) = &mut input.button {
        button.label = button.label.trim().into();
        button.url = button.url.trim().into();
        if button.label.is_empty()
            || button.label.chars().count() > 20
            || button.label.chars().any(char::is_control)
        {
            return Err(AppError::BadRequest(
                "Enter a button label of up to 20 characters.".into(),
            ));
        }
        let url = reqwest::Url::parse(&button.url).map_err(|_| {
            AppError::BadRequest("Enter a complete http:// or https:// button URL.".into())
        })?;
        if !matches!(url.scheme(), "http" | "https")
            || !(button.url.to_ascii_lowercase().starts_with("http://")
                || button.url.to_ascii_lowercase().starts_with("https://"))
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || button.url.chars().count() > 2048
            || button
                .url
                .chars()
                .any(|c| c.is_whitespace() || c.is_control())
        {
            return Err(AppError::BadRequest("Enter a complete http:// or https:// button URL without credentials or spaces, up to 2,048 characters.".into()));
        }
        if input.message.chars().count() > 1024 {
            return Err(AppError::BadRequest(
                "Keep the reply within 1,024 characters when adding a button.".into(),
            ));
        }
    }
    if input.enabled && !state.notifications().can_send() {
        return Err(AppError::Unavailable(
            "Configure and enable WhatsApp delivery before enabling automatic replies.".into(),
        ));
    }
    repository::update(state.db(), &input, actor).await?;
    settings(state).await
}

pub(super) struct Incoming {
    pub id: String,
    pub phone_number_id: String,
    pub customer_key: String,
    pub destination: String,
    pub destination_field: &'static str,
    pub received_at: DateTime<Utc>,
}

pub(super) struct Job {
    pub id: String,
    pub destination: String,
    pub destination_field: String,
    pub message: String,
    pub button: Option<LinkButton>,
}

fn incoming(phone: &str, value: &Value, message: &Value, now: DateTime<Utc>) -> Option<Incoming> {
    if value["metadata"]["phone_number_id"].as_str()? != phone {
        return None;
    }
    // Reactions, system events, unsupported messages, and message echoes must
    // never generate replies. Status-only events have no messages array.
    if !matches!(
        message["type"].as_str()?,
        "text"
            | "image"
            | "audio"
            | "video"
            | "document"
            | "sticker"
            | "location"
            | "contacts"
            | "interactive"
            | "button"
            | "order"
    ) {
        return None;
    }
    let id = message["id"].as_str()?.trim();
    if id.is_empty() || id.len() > 512 {
        return None;
    }
    let timestamp = message["timestamp"].as_str()?.parse::<i64>().ok()?;
    let received_at = DateTime::from_timestamp(timestamp, 0)?;
    if received_at < now - Duration::hours(23) || received_at > now + Duration::minutes(5) {
        return None;
    }
    let from = message["from"]
        .as_str()
        .filter(|s| (8..=15).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit()));
    let user_id = message["from_user_id"].as_str().filter(|s| {
        !s.is_empty()
            && s.len() <= 128
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
    });
    if from.is_some_and(|from| {
        value["metadata"]["display_phone_number"]
            .as_str()
            .is_some_and(|own| own.trim_start_matches('+') == from)
    }) {
        return None;
    }
    let (destination, destination_field) = if let Some(from) = from {
        (from, "to")
    } else {
        (user_id?, "recipient")
    };
    Some(Incoming {
        id: id.into(),
        phone_number_id: phone.into(),
        customer_key: user_id.unwrap_or(destination).into(),
        destination: destination.into(),
        destination_field,
        received_at,
    })
}

pub async fn enqueue(state: &AppState, payload: &Value) -> Result<(), AppError> {
    let Some(phone) = state.notifications().phone_number_id.as_deref() else {
        return Ok(());
    };
    for entry in payload["entry"].as_array().into_iter().flatten() {
        for change in entry["changes"].as_array().into_iter().flatten() {
            if change["field"].as_str() != Some("messages") {
                continue;
            }
            let value = &change["value"];
            for message in value["messages"].as_array().into_iter().flatten() {
                if let Some(incoming) = incoming(phone, value, message, Utc::now()) {
                    repository::enqueue(state.db(), &incoming, state.notifications().can_send())
                        .await?;
                }
            }
        }
    }
    Ok(())
}

pub async fn tick(state: &AppState) -> Result<(), AppError> {
    let config = state.notifications();
    let Some(job) = repository::claim(
        state.db(),
        config.phone_number_id.as_deref(),
        config.can_send(),
    )
    .await?
    else {
        return Ok(());
    };
    let client = service::http_client()?;
    let mut body = if let Some(button) = &job.button {
        json!({"messaging_product":"whatsapp", "type":"interactive", "interactive":{
            "type":"cta_url", "body":{"text":job.message},
            "action":{"name":"cta_url", "parameters":{"display_text":button.label,"url":button.url}}
        }})
    } else {
        json!({"messaging_product":"whatsapp", "type":"text", "text":{"body":job.message,"preview_url":false}})
    };
    body[&job.destination_field] = json!(job.destination);
    let result = client
        .post(format!("{}/messages", worker::graph_root(config)))
        .bearer_auth(config.access_token.as_deref().unwrap_or_default())
        .json(&body)
        .send()
        .await;
    let (status, id, error) = match result {
        Ok(response) => match worker::graph_response(response, true).await {
            Ok(value) => match value["messages"][0]["id"]
                .as_str()
                .filter(|s| !s.is_empty())
            {
                Some(id) => ("accepted", Some(id.to_owned()), None),
                None => (
                    "uncertain",
                    None,
                    Some("Meta returned no message ID.".into()),
                ),
            },
            Err(error) => (
                if error.uncertain {
                    "uncertain"
                } else {
                    "failed"
                },
                None,
                Some(error.message),
            ),
        },
        Err(_) => (
            "uncertain",
            None,
            Some("The automatic reply result is unknown; automatic retry disabled.".into()),
        ),
    };
    if status != "accepted" {
        tracing::warn!(inbound_message_id=%job.id, outcome=status, "WhatsApp automatic reply was not confirmed; cooldown retained");
    }
    repository::finish(state.db(), &job.id, status, id.as_deref(), error.as_deref()).await
}

#[cfg(test)]
mod tests;
