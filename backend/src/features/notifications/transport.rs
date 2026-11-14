use crate::{
    features::notifications::{repository::Attachment, service, types::Snapshot},
    state::AppState,
};
use serde_json::{json, Value};

#[derive(Debug)]
pub(crate) struct Failure {
    pub message: String,
    pub retry: bool,
    pub uncertain: bool,
    pub retry_after: i64,
    pub terminal_status: Option<&'static str>,
}

pub(crate) fn failure(message: &str, retry: bool, uncertain: bool) -> Failure {
    Failure {
        message: message.chars().take(700).collect(),
        retry,
        uncertain,
        retry_after: 0,
        terminal_status: None,
    }
}

pub(crate) async fn graph_response(
    response: reqwest::Response,
    message_request: bool,
) -> Result<Value, Failure> {
    let status = response.status();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            v.parse::<i64>().ok().or_else(|| {
                chrono::DateTime::parse_from_rfc2822(v)
                    .ok()
                    .map(|at| (at.with_timezone(&chrono::Utc) - chrono::Utc::now()).num_seconds())
            })
        })
        .unwrap_or(0)
        .clamp(0, 86400);
    let value: Value = response.json().await.map_err(|_| {
        failure(
            "WhatsApp returned an unreadable response",
            !message_request,
            message_request,
        )
    })?;
    if status.is_success() {
        return Ok(value);
    }
    let message = value["error"]["message"]
        .as_str()
        .unwrap_or("WhatsApp rejected this request");
    let known_error = value.get("error").is_some();
    let mut error = failure(
        message,
        known_error && (status.as_u16() == 429 || status.is_server_error()),
        message_request && !known_error,
    );
    error.retry_after = retry_after;
    Err(error)
}

pub(crate) struct PreparedMessage {
    name: String,
    language: String,
    components: Vec<Value>,
}
fn root(state: &AppState) -> String {
    let root = format!(
        "https://graph.facebook.com/{}/{}",
        state.notifications().api_version,
        state
            .notifications()
            .phone_number_id
            .as_deref()
            .unwrap_or_default()
    );
    #[cfg(test)]
    let root = state.notifications().test_graph_url.clone().unwrap_or(root);
    root
}
pub(crate) async fn prepare(
    state: &AppState,
    snapshot: &Snapshot,
    artifact: Option<Attachment>,
) -> Result<PreparedMessage, Failure> {
    let client = service::http_client()
        .map_err(|_| failure("Could not initialize the sender", true, false))?;
    let token = state
        .notifications()
        .access_token
        .as_deref()
        .ok_or_else(|| failure("WhatsApp is not configured", false, false))?;
    let mut components = vec![];
    if !snapshot.parameters.is_empty() {
        components.push(json!({"type":"body","parameters":snapshot.parameters.iter().map(|value|json!({"type":"text","text":value})).collect::<Vec<_>>()}));
    }
    if let Some(artifact) = artifact {
        if service::hash(&artifact.content) != artifact.sha256 {
            return Err(failure(
                "The approved attachment failed its integrity check. Preview and send again.",
                false,
                false,
            ));
        }
        let header = match artifact.mime_type.as_str() {
            "application/pdf" => "document",
            "image/png" | "image/jpeg" => "image",
            _ => return Err(failure("Invalid attachment type", false, false)),
        };
        let part = reqwest::multipart::Part::bytes(artifact.content)
            .file_name(artifact.filename.clone())
            .mime_str(&artifact.mime_type)
            .map_err(|_| failure("Invalid attachment type", false, false))?;
        let response = client
            .post(format!("{}/media", root(state)))
            .bearer_auth(token)
            .multipart(
                reqwest::multipart::Form::new()
                    .part("file", part)
                    .text("messaging_product", "whatsapp")
                    .text("type", artifact.mime_type),
            )
            .send()
            .await
            .map_err(|_| failure("The attachment upload was interrupted", true, false))?;
        let value = graph_response(response, false).await?;
        let id = value["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| failure("WhatsApp did not return a media ID", true, false))?;
        let media = if header == "document" {
            json!({"id":id,"filename":artifact.filename})
        } else {
            json!({"id":id})
        };
        components.insert(
            0,
            json!({"type":"header","parameters":[{"type":header,header:media}]}),
        );
    }
    for button in &snapshot.quick_replies {
        components.push(json!({"type":"button","sub_type":"quick_reply","index":button.index.to_string(),"parameters":[{"type":"payload","payload":button.payload}]}));
    }
    Ok(PreparedMessage {
        name: snapshot.template_name.clone(),
        language: snapshot.language.clone(),
        components,
    })
}
pub(crate) async fn submit(
    state: &AppState,
    mobile: &str,
    message: PreparedMessage,
) -> Result<String, Failure> {
    let client = service::http_client()
        .map_err(|_| failure("Could not initialize the sender", true, false))?;
    let token = state
        .notifications()
        .access_token
        .as_deref()
        .ok_or_else(|| failure("WhatsApp is not configured", false, false))?;
    let response=client.post(format!("{}/messages",root(state))).bearer_auth(token).json(&json!({"messaging_product":"whatsapp","to":mobile.trim_start_matches('+'),"type":"template","template":{"name":message.name,"language":{"code":message.language},"components":message.components}})).send().await.map_err(|_|failure("The send result is unknown. Check WhatsApp delivery before explicitly resending.",false,true))?;
    let value = graph_response(response, true).await?;
    value["messages"][0]["id"]
        .as_str()
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| {
            failure(
                "WhatsApp returned no message ID. Check delivery before resending.",
                false,
                true,
            )
        })
}
