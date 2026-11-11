use super::{repository as store, types::*};
use crate::features::notifications::{
    service::http_client,
    worker::{graph_response, Failure},
};
use crate::{error::AppError, state::AppState};
use reqwest::{Client, Method};
use serde_json::{json, Value};
use uuid::Uuid;

fn base(state: &AppState) -> String {
    let root = format!(
        "https://graph.facebook.com/{}",
        state.notifications().api_version
    );
    #[cfg(test)]
    let root = state.notifications().test_graph_url.clone().unwrap_or(root);
    root
}
fn token(state: &AppState) -> Result<&str, AppError> {
    state
        .notifications()
        .access_token
        .as_deref()
        .ok_or_else(|| AppError::Unavailable("Configure the WhatsApp access token.".into()))
}
fn waba(state: &AppState) -> Result<&str, AppError> {
    state.notifications().waba_id.as_deref().ok_or_else(|| {
        AppError::Unavailable(
            "Configure WHATSAPP_WABA_ID for marketing template management.".into(),
        )
    })
}
async fn response(request: reqwest::RequestBuilder) -> Result<Value, AppError> {
    let result = request.send().await.map_err(|_| {
        AppError::External("Meta request interrupted. Synchronize before trying again.".into())
    })?;
    graph_response(result, false)
        .await
        .map_err(|e| AppError::External(e.message))
}
pub fn components(d: &TemplateDefinition, header_handle: Option<&str>) -> Value {
    let mut result = vec![];
    if d.image_header {
        let mut header = json!({"type":"HEADER","format":"IMAGE"});
        if let Some(handle) = header_handle {
            header["example"] = json!({"header_handle":[handle]});
        }
        result.push(header);
    }
    let mut body = json!({"type":"BODY","text":d.body});
    if !d.examples.is_empty() {
        body["example"] = json!({"body_text":[d.examples]});
    }
    result.push(body);
    if let Some(footer) = &d.footer {
        result.push(json!({"type":"FOOTER","text":footer}));
    }
    let mut buttons = vec![];
    if let (Some(label), Some(url)) = (&d.website_label, &d.website_url) {
        buttons.push(json!({"type":"URL","text":label,"url":url}));
    }
    buttons.push(json!({"type":"QUICK_REPLY","text":d.unsubscribe_label}));
    result.push(json!({"type":"BUTTONS","buttons":buttons}));
    json!(result)
}
pub fn canonical(components: &Value) -> Value {
    let mut result = components.clone();
    if let Some(items) = result.as_array_mut() {
        for item in items {
            if let Some(object) = item.as_object_mut() {
                object.remove("example");
            }
        }
    }
    result
}
pub fn definition(components: &Value) -> Option<TemplateDefinition> {
    let mut d = TemplateDefinition {
        body: String::new(),
        examples: vec![],
        footer: None,
        image_header: false,
        sample_asset_id: None,
        website_label: None,
        website_url: None,
        unsubscribe_label: String::new(),
    };
    let mut seen = std::collections::BTreeSet::new();
    for c in components.as_array()? {
        let kind = c["type"].as_str()?;
        if !seen.insert(kind) {
            return None;
        }
        match kind {
            "BODY" => d.body = c["text"].as_str()?.into(),
            "HEADER" if c["format"] == "IMAGE" => d.image_header = true,
            "FOOTER" => d.footer = Some(c["text"].as_str()?.into()),
            "BUTTONS" => {
                for b in c["buttons"].as_array()? {
                    match b["type"].as_str()? {
                        "URL" if d.website_url.is_none() && d.unsubscribe_label.is_empty() => {
                            let url = b["url"].as_str()?;
                            if !url.starts_with("https://") || url.contains("{{") {
                                return None;
                            }
                            d.website_url = Some(url.into());
                            d.website_label = Some(b["text"].as_str()?.into());
                        }
                        "QUICK_REPLY" if d.unsubscribe_label.is_empty() => {
                            d.unsubscribe_label = b["text"].as_str()?.into()
                        }
                        _ => return None,
                    }
                }
            }
            _ => return None,
        }
    }
    if d.body.is_empty() || d.unsubscribe_label.is_empty() {
        return None;
    }
    Some(d)
}
async fn sample_upload(state: &AppState, id: Uuid) -> Result<String, AppError> {
    let app = state
        .notifications()
        .meta_app_id
        .as_deref()
        .ok_or_else(|| {
            AppError::Unavailable(
                "Configure WHATSAPP_META_APP_ID for template sample uploads.".into(),
            )
        })?;
    let (asset, bytes) = store::asset(&mut *state.db().acquire().await?, id).await?;
    let client = http_client()?;
    let start = response(
        client
            .post(format!("{}/{app}/uploads", base(state)))
            .bearer_auth(token(state)?)
            .query(&[
                ("file_name", asset.filename),
                ("file_length", bytes.len().to_string()),
                ("file_type", asset.mime_type),
            ]),
    )
    .await?;
    let session = start["id"]
        .as_str()
        .filter(|id| id.starts_with("upload:") && !id.contains(['\r', '\n']))
        .ok_or_else(|| AppError::External("Meta did not return an upload session.".into()))?;
    let finish = response(
        client
            .post(format!("{}/{session}", base(state)))
            .header("Authorization", format!("OAuth {}", token(state)?))
            .header("file_offset", "0")
            .body(bytes),
    )
    .await?;
    finish["h"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| AppError::External("Meta did not return a sample image handle.".into()))
}
pub async fn submit(state: &AppState, id: Uuid) -> Result<Template, AppError> {
    waba(state)?;
    token(state)?;
    // Upload the sample before reserving submission: upload retries cannot send a message.
    let initial = store::template(&mut *state.db().acquire().await?, id).await?;
    let handle = if let Some(asset) = initial.definition.sample_asset_id {
        Some(sample_upload(state, asset).await?)
    } else {
        None
    };
    let t = store::begin_submission(state.db(), id).await?;
    if initial.revision != t.revision {
        store::submitted(
            state.db(),
            id,
            None,
            "draft",
            Some("Draft changed during image upload. Submit again."),
            &Value::Null,
        )
        .await?;
        return Err(AppError::Conflict(
            "Template changed during image upload.".into(),
        ));
    }
    let c = components(&t.definition, handle.as_deref());
    let request=http_client()?.post(format!("{}/{}/message_templates",base(state),waba(state)?)).bearer_auth(token(state)?).json(&json!({"name":t.name,"language":t.language,"category":"MARKETING","allow_category_change":false,"components":c}));
    // Ambiguous submissions remain submitting until synchronization finds the name.
    let raw = request.send().await.map_err(|_| {
        AppError::External(
            "Template submission result is unknown. Synchronize before trying again.".into(),
        )
    })?;
    let client_error = raw.status().is_client_error();
    let result = match graph_response(raw, false).await {
        Ok(value) => value,
        Err(error) => {
            if client_error {
                store::submitted(
                    state.db(),
                    id,
                    None,
                    "rejected",
                    Some(&error.message),
                    &canonical(&c),
                )
                .await?;
            }
            return Err(AppError::External(error.message));
        }
    };
    let provider_id = result["id"].as_str().ok_or_else(|| {
        AppError::External("Submission result is unknown. Synchronize templates.".into())
    })?;
    store::submitted(
        state.db(),
        id,
        Some(provider_id),
        &result["status"]
            .as_str()
            .unwrap_or("PENDING")
            .to_lowercase(),
        None,
        &canonical(&c),
    )
    .await?;
    store::template(&mut *state.db().acquire().await?, id).await
}
pub async fn sync(state: &AppState) -> Result<usize, AppError> {
    let client = http_client()?;
    let mut after = None::<String>;
    let mut count = 0;
    loop {
        let mut request = client
            .get(format!(
                "{}/{}/message_templates",
                base(state),
                waba(state)?
            ))
            .bearer_auth(token(state)?)
            .query(&[
                (
                    "fields",
                    "id,name,language,status,category,components,rejected_reason",
                ),
                ("limit", "100"),
            ]);
        if let Some(cursor) = &after {
            request = request.query(&[("after", cursor)]);
        }
        let data = response(request).await?;
        for t in data["data"].as_array().into_iter().flatten() {
            if t["category"] != "MARKETING" {
                continue;
            }
            if let (Some(id), Some(name), Some(language), Some(d)) = (
                t["id"].as_str(),
                t["name"].as_str(),
                t["language"].as_str(),
                definition(&t["components"]),
            ) {
                store::sync_template(
                    state.db(),
                    name,
                    language,
                    id,
                    &d,
                    &t["status"].as_str().unwrap_or("unknown").to_lowercase(),
                    t["rejected_reason"].as_str(),
                    &canonical(&t["components"]),
                )
                .await?;
                count += 1;
            }
        }
        if data["paging"]["next"].as_str().is_none() {
            break;
        }
        let next = data["paging"]["cursors"]["after"]
            .as_str()
            .ok_or_else(|| AppError::External("Meta returned incomplete pagination.".into()))?
            .to_owned();
        if after.as_ref() == Some(&next) {
            return Err(AppError::External(
                "Meta returned a repeated page cursor.".into(),
            ));
        }
        after = Some(next);
    }
    Ok(count)
}
pub async fn refresh(state: &AppState, snapshot: &TemplateSnapshot) -> Result<bool, AppError> {
    let id = snapshot
        .provider_id
        .as_deref()
        .ok_or_else(|| AppError::Conflict("Template has no Meta ID.".into()))?;
    let value = response(
        http_client()?
            .get(format!("{}/{id}", base(state)))
            .bearer_auth(token(state)?)
            .query(&[(
                "fields",
                "id,name,language,status,category,components,rejected_reason",
            )]),
    )
    .await?;
    if value["id"].as_str() != Some(id)
        || value["name"].as_str() != Some(snapshot.name.as_str())
        || value["language"].as_str() != Some(snapshot.language.as_str())
    {
        store::mark_template_unknown(state.db(), snapshot.id, "Meta template identity changed.")
            .await?;
        return Ok(false);
    }
    let supported = definition(&value["components"]);
    let Some(d) = supported.filter(|_| value["category"] == "MARKETING") else {
        store::mark_template_unknown(
            state.db(),
            snapshot.id,
            "Template category or components changed in Meta.",
        )
        .await?;
        return Ok(false);
    };
    store::sync_template(
        state.db(),
        &snapshot.name,
        &snapshot.language,
        id,
        &d,
        &value["status"].as_str().unwrap_or("unknown").to_lowercase(),
        value["rejected_reason"].as_str(),
        &canonical(&value["components"]),
    )
    .await?;
    let t = store::template(&mut *state.db().acquire().await?, snapshot.id).await?;
    Ok(t.state == "approved"
        && !t.archived
        && t.revision == snapshot.revision
        && canonical(&components(&snapshot.definition, None)) == canonical(&value["components"]))
}
fn failure(message: &str, retry: bool, uncertain: bool) -> Failure {
    Failure {
        message: message.into(),
        retry,
        uncertain,
        retry_after: 0,
    }
}
pub async fn send(state: &AppState, job: &Job, p: &Preview) -> Result<String, Failure> {
    let cfg = state.notifications();
    let client: Client =
        http_client().map_err(|_| failure("Could not initialize Meta client.", true, false))?;
    let token = cfg
        .access_token
        .as_deref()
        .ok_or_else(|| failure("WhatsApp is not configured.", false, false))?;
    let phone = cfg.phone_number_id.as_deref().unwrap_or_default();
    let mut c = Vec::new();
    if !p.parameters.is_empty() {
        c.push(json!({"type":"body","parameters":p.parameters.iter().map(|s|json!({"type":"text","text":s})).collect::<Vec<_>>()}));
    }
    if let Some(asset_id) = p.asset_id {
        let (asset, bytes) = store::asset(
            &mut *state
                .db()
                .acquire()
                .await
                .map_err(|_| failure("Image storage unavailable.", true, false))?,
            asset_id,
        )
        .await
        .map_err(|_| failure("Approved image unavailable.", true, false))?;
        if Some(&asset.sha256) != p.asset_sha256.as_ref()
            || crate::features::notifications::service::hash(&bytes) != asset.sha256
        {
            return Err(failure("Approved image changed.", false, false));
        }
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(asset.filename)
            .mime_str(&asset.mime_type)
            .map_err(|_| failure("Invalid image type.", false, false))?;
        let upload = client
            .post(format!("{}/{phone}/media", base(state)))
            .bearer_auth(token)
            .multipart(
                reqwest::multipart::Form::new()
                    .part("file", part)
                    .text("messaging_product", "whatsapp"),
            )
            .send()
            .await
            .map_err(|_| failure("Image upload interrupted.", true, false))?;
        let media = graph_response(upload, false).await?;
        let id = media["id"]
            .as_str()
            .ok_or_else(|| failure("Meta returned no media ID.", true, false))?;
        c.push(json!({"type":"header","parameters":[{"type":"image","image":{"id":id}}]}));
    }
    let button_index = if p.template.definition.website_url.is_some() {
        "1"
    } else {
        "0"
    };
    c.push(json!({"type":"button","sub_type":"quick_reply","index":button_index,"parameters":[{"type":"payload","payload":"MARKETING_UNSUBSCRIBE"}]}));
    if !store::request_started(state.db(), job)
        .await
        .map_err(|_| failure("Could not authorize message submission.", true, false))?
    {
        return Err(failure(
            "Campaign cancelled, expired, or consent withdrawn before submission.",
            false,
            false,
        ));
    }
    let response=client.request(Method::POST,format!("{}/{phone}/messages",base(state))).bearer_auth(token).json(&json!({"messaging_product":"whatsapp","to":job.mobile.trim_start_matches('+'),"type":"template","template":{"name":p.template.name,"language":{"code":p.template.language},"components":c}})).send().await.map_err(|_|failure("Message submission result is unknown. Reconcile before resending.",false,true))?;
    let value = graph_response(response, true).await?;
    value["messages"][0]["id"]
        .as_str()
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| {
            failure(
                "Meta returned no message ID. Reconcile before resending.",
                false,
                true,
            )
        })
}
