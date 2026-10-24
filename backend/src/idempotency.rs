use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::AppError;

/// Hash typed input after deserialization has applied defaults and normalized
/// numeric representations. The separately stored request ID is not content.
/// Version the operation name whenever its input semantics change.
pub(crate) fn request_hash(operation: &str, target: Uuid, input: &impl Serialize) -> [u8; 32] {
    let mut input = serde_json::to_value(input).expect("serializable request input");
    if let Value::Object(fields) = &mut input {
        fields.remove("requestId");
    }
    let mut canonical = serde_json::json!([operation, target, input]);
    canonical.sort_all_objects();
    normalize_zero(&mut canonical);
    Sha256::digest(serde_json::to_vec(&canonical).expect("serializable canonical input")).into()
}

fn normalize_zero(value: &mut Value) {
    match value {
        Value::Number(number) if number.is_f64() && number.as_f64() == Some(0.0) => {
            *value = serde_json::json!(0.0);
        }
        Value::Array(values) => values.iter_mut().for_each(normalize_zero),
        Value::Object(fields) => fields.values_mut().for_each(normalize_zero),
        _ => {}
    }
}

pub(crate) fn verify_request_hash(stored: &[u8], incoming: &[u8]) -> Result<(), AppError> {
    if stored != incoming {
        return Err(AppError::Conflict(
            "this requestId was already used with different values".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hashes_canonical_content_without_the_request_id() {
        let target = Uuid::nil();
        let first = json!({"requestId": Uuid::new_v4(), "amount": 10.0,
            "refund": {"amount": 0.0, "method": "cash"}});
        let second = json!({"refund": {"method": "cash", "amount": -0.0},
            "amount": 10.0, "requestId": Uuid::new_v4()});
        let hash = request_hash("refund.v1", target, &first);
        assert_eq!(hash, request_hash("refund.v1", target, &second));
        let canonical = format!(
            r#"["refund.v1","{target}",{{"amount":10.0,"refund":{{"amount":0.0,"method":"cash"}}}}]"#
        );
        let expected: [u8; 32] = Sha256::digest(canonical.as_bytes()).into();
        assert_eq!(hash, expected);
        assert_ne!(hash, request_hash("return.v1", target, &first));
        assert_ne!(hash, request_hash("refund.v1", Uuid::new_v4(), &first));
        assert_ne!(
            hash,
            request_hash("refund.v1", target, &json!({"amount": 20.0}))
        );
        assert!(verify_request_hash(&hash, &hash).is_ok());
        assert!(matches!(
            verify_request_hash(&hash, &[0; 32]),
            Err(AppError::Conflict(_))
        ));
    }
}
