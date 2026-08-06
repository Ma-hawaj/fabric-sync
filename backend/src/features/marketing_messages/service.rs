use uuid::Uuid;

use crate::{error::AppError, state::AppState};

use super::{
    repository,
    types::{Campaign, CreateCampaignInput},
};

const TEMPLATE_NAME: &str = "marketing_broadcast_v1";
const MAX_BODY_LEN: usize = 1024;

fn normalized_body(body: &str) -> Result<String, AppError> {
    let body = body.trim();

    if body.is_empty() {
        return Err(AppError::BadRequest("message cannot be empty".to_string()));
    }

    if body.chars().count() > MAX_BODY_LEN {
        return Err(AppError::BadRequest(format!(
            "message must be {MAX_BODY_LEN} characters or fewer"
        )));
    }

    Ok(body.to_string())
}

pub async fn list_campaigns(state: &AppState) -> Result<Vec<Campaign>, AppError> {
    Ok(repository::list_campaigns(state).await?)
}

pub async fn get_campaign(state: &AppState, campaign_id: Uuid) -> Result<Campaign, AppError> {
    repository::get_campaign(state, campaign_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("campaign {campaign_id} not found")))
}

pub async fn create_campaign(
    state: &AppState,
    created_by: Option<&str>,
    input: CreateCampaignInput,
) -> Result<Campaign, AppError> {
    let body = normalized_body(&input.body)?;

    if input.recipient_customer_ids.is_empty() {
        return Err(AppError::BadRequest(
            "select at least one recipient".to_string(),
        ));
    }

    let candidates = repository::opted_in_customers(state, &input.recipient_customer_ids).await?;
    if candidates.is_empty() {
        return Err(AppError::BadRequest(
            "none of the selected customers are opted in to marketing messages".to_string(),
        ));
    }

    let mut tx = state.db().begin().await?;
    let campaign_id =
        repository::insert_campaign(&mut tx, TEMPLATE_NAME, &body, created_by).await?;

    for candidate in &candidates {
        let recipient_id =
            repository::insert_recipient(&mut tx, campaign_id, candidate.id, &candidate.mobile_no)
                .await?;

        // The "poller": inlined here because the client is a stub. A real
        // background worker would instead leave this row `pending` after
        // insert and pick it up on its own schedule, calling the same
        // repository::mark_sent/mark_failed — see notifications.rs.
        match state
            .whatsapp_client()
            .send_message(&candidate.mobile_no, &body)
            .await
        {
            Ok(outcome) => {
                repository::mark_sent(&mut tx, recipient_id, &outcome.provider_message_id).await?
            }
            Err(error) => repository::mark_failed(&mut tx, recipient_id, &error.0).await?,
        }
    }

    tx.commit().await?;

    get_campaign(state, campaign_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_body_trims_surrounding_whitespace() {
        assert_eq!(normalized_body("  Hello there \n").unwrap(), "Hello there");
    }

    #[test]
    fn normalized_body_rejects_blank_messages() {
        for body in ["", "   ", "\t\n"] {
            let error = normalized_body(body).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{body:?}");
        }
    }

    #[test]
    fn normalized_body_rejects_messages_over_the_length_cap() {
        let body = "a".repeat(MAX_BODY_LEN + 1);
        let error = normalized_body(&body).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }

    #[test]
    fn normalized_body_accepts_a_message_at_the_length_cap() {
        let body = "a".repeat(MAX_BODY_LEN);
        assert_eq!(normalized_body(&body).unwrap(), body);
    }
}
