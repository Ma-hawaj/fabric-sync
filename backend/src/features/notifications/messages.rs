use serde::{Deserialize, Serialize};

use super::Config;
use crate::error::AppError;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageTemplate {
    pub template_name: String,
    pub body: String,
    #[serde(default)]
    pub parameters: Vec<Parameter>,
    #[serde(default)]
    pub attach_invoice: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Parameter {
    InvoiceReference,
    CompanyName,
    Total,
    BalanceDue,
    PickupBranch,
}

impl MessageTemplate {
    pub fn render_body(&self, parameters: &[String]) -> String {
        // Find substitutions in the original template. Text inside a parameter
        // must not be interpreted as another template placeholder.
        let mut replacements = Vec::new();
        for (index, value) in parameters.iter().enumerate() {
            let placeholder = format!("{{{{{}}}}}", index + 1);
            for (offset, _) in self.body.match_indices(&placeholder) {
                replacements.push((offset, placeholder.len(), value.as_str()));
            }
        }
        replacements.sort_unstable_by_key(|(offset, _, _)| *offset);
        let mut rendered = String::new();
        let mut cursor = 0;
        for (offset, length, value) in replacements {
            rendered.push_str(&self.body[cursor..offset]);
            rendered.push_str(value);
            cursor = offset + length;
        }
        rendered.push_str(&self.body[cursor..]);
        rendered
    }
}

impl Config {
    pub fn messages(&self, ready: bool) -> Result<Vec<MessageTemplate>, AppError> {
        let (raw, key) = if ready {
            (&self.ready_messages, "WHATSAPP_READY_MESSAGES")
        } else {
            (&self.invoice_messages, "WHATSAPP_INVOICE_MESSAGES")
        };
        let messages = match raw {
            Some(raw) => serde_json::from_str(raw)
                .map_err(|error| AppError::Config(format!("Invalid {key}: {error}")))?,
            None => vec![if ready {
                MessageTemplate {
                    template_name: self.ready_template.clone(),
                    body: self.ready_body.clone(),
                    parameters: vec![
                        Parameter::InvoiceReference,
                        Parameter::PickupBranch,
                        Parameter::BalanceDue,
                    ],
                    attach_invoice: false,
                }
            } else {
                MessageTemplate {
                    template_name: self.invoice_template.clone(),
                    body: self.invoice_body.clone(),
                    parameters: vec![
                        Parameter::InvoiceReference,
                        Parameter::CompanyName,
                        Parameter::Total,
                        Parameter::BalanceDue,
                    ],
                    attach_invoice: true,
                }
            }],
        };
        validate(&messages, ready)
            .map_err(|error| AppError::Config(format!("Invalid {key}: {error}")))?;
        Ok(messages)
    }
}

fn validate(messages: &[MessageTemplate], ready: bool) -> Result<(), String> {
    if messages.is_empty() || messages.len() > 10 {
        return Err("configure between 1 and 10 ordered messages".into());
    }
    let attachments = messages
        .iter()
        .filter(|message| message.attach_invoice)
        .count();
    if attachments > 1 || (!ready && attachments != 1) {
        return Err(
            "invoice messages require exactly one PDF; pickup messages allow at most one PDF"
                .into(),
        );
    }
    for message in messages {
        if message.template_name.is_empty()
            || !message
                .template_name
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
            || message.body.trim().is_empty()
        {
            return Err(
                "each message requires an approved template name and its exact body".into(),
            );
        }
        let mut remaining = message.body.clone();
        for index in 1..=message.parameters.len() {
            let placeholder = format!("{{{{{index}}}}}");
            if !remaining.contains(&placeholder) {
                return Err(format!(
                    "{} is missing {placeholder}",
                    message.template_name
                ));
            }
            remaining = remaining.replace(&placeholder, "");
        }
        if remaining.contains("{{") || remaining.contains("}}") {
            return Err(format!(
                "{} has an unconfigured parameter",
                message.template_name
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_parameter_values_as_literal_text() {
        let message = MessageTemplate {
            template_name: "invoice_v1".into(),
            body: "Hello {{1}}: {{2}} and {{1}}".into(),
            parameters: vec![Parameter::CompanyName, Parameter::InvoiceReference],
            attach_invoice: false,
        };
        assert_eq!(
            message.render_body(&["{{2}}".into(), "INV-1".into()]),
            "Hello {{2}}: INV-1 and {{2}}"
        );
    }

    #[test]
    fn defaults_to_one_message_and_reports_invalid_json_in_configuration() {
        let mut config = Config::from_env();
        config.invoice_messages = None;
        config.ready_messages = None;
        assert_eq!(config.messages(false).unwrap().len(), 1);
        assert!(config.messages(false).unwrap()[0].attach_invoice);
        assert!(!config.messages(true).unwrap()[0].attach_invoice);
        config.invoice_messages = Some("not JSON".into());
        assert!(matches!(config.messages(false), Err(AppError::Config(_))));
        config.invoice_messages =
            Some(r#"[{"templateName":"invoice","body":"Hi","unexpected":true}]"#.into());
        assert!(matches!(config.messages(false), Err(AppError::Config(_))));
    }

    #[test]
    fn accepts_an_ordered_greeting_document_and_followup() {
        let messages: Vec<MessageTemplate> = serde_json::from_value(serde_json::json!([
            {"templateName":"invoice_greeting_v1","body":"Hello! Invoice {{1}} follows.","parameters":["invoiceReference"]},
            {"templateName":"invoice_document_v1","body":"Your invoice is attached.","attachInvoice":true},
            {"templateName":"invoice_help_v1","body":"Contact us about invoice {{1}}.","parameters":["invoiceReference"]}
        ])).unwrap();
        validate(&messages, false).unwrap();
        assert_eq!(messages.len(), 3);
        assert!(messages[1].attach_invoice);
    }

    #[test]
    fn rejects_empty_sequences_bad_placeholders_and_missing_or_repeated_pdfs() {
        assert!(validate(&[], false).is_err());
        let mut message = MessageTemplate {
            template_name: "invoice_v1".into(),
            body: "Invoice {{1}}".into(),
            parameters: vec![Parameter::InvoiceReference],
            attach_invoice: true,
        };
        assert!(validate(&[message.clone(), message.clone()], false).is_err());
        message.attach_invoice = false;
        assert!(validate(&[message.clone()], false).is_err());
        validate(&[message.clone()], true).unwrap();
        message.body = "Invoice {{2}}".into();
        assert!(validate(&[message.clone()], true).is_err());
        message.body = "Hello {{name}}".into();
        message.parameters.clear();
        assert!(validate(&[message], true).is_err());
    }
}
