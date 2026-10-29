//! The shared policy is deny-by-default, including for newly added endpoints.
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Admin,
    Manager,
    Sales,
    Production,
    Inventory,
}

pub fn has_any_role(held: &[Role], required: &[Role]) -> bool {
    !required.is_empty()
        && (held.contains(&Role::Admin)
            || required.iter().any(|role| {
                held.contains(role) || (held.contains(&Role::Manager) && *role != Role::Admin)
            }))
}

/// The primary organization remains trusted when no external IDs are configured.
/// Entries are literal organization IDs; blanks are ignored and duplicates removed.
pub fn trusted_organization_ids(primary: &str, additional: &str) -> Vec<String> {
    let mut ids = Vec::new();
    for id in std::iter::once(primary).chain(additional.split(',')) {
        let id = id.trim();
        if !id.is_empty() && !ids.iter().any(|existing| existing == id) {
            ids.push(id.to_owned());
        }
    }
    ids
}

/// Accept only the explicit project claim: a generic role claim could refer
/// to a different project on a token with several audiences. Each role must
/// also contain a configured trusted organization as a map key.
pub fn roles_from_claims(
    claims: &HashMap<String, serde_json::Value>,
    project: &str,
    trusted_organizations: &[String],
) -> Vec<Role> {
    let namespaced = format!("urn:zitadel:iam:org:project:{project}:roles");
    let mut roles = Vec::new();
    if let Some(map) = claims.get(&namespaced).and_then(|value| value.as_object()) {
        for (name, organizations) in map {
            if organizations.as_object().is_some_and(|map| {
                trusted_organizations.iter().any(|organization| {
                    map.get(organization)
                        .is_some_and(|domain| domain.is_string())
                })
            }) {
                if let Ok(role) =
                    serde_json::from_value::<Role>(serde_json::Value::String(name.clone()))
                {
                    roles.push(role);
                }
            }
        }
    }
    roles
}

#[derive(Deserialize)]
struct Rule {
    method: String,
    path: String,
    roles: Vec<String>,
}
fn policy() -> &'static Vec<Rule> {
    static POLICY: std::sync::OnceLock<Vec<Rule>> = std::sync::OnceLock::new();
    POLICY.get_or_init(|| {
        serde_json::from_str(include_str!("../../frontend/src/lib/access-policy.json"))
            .expect("valid authorization policy")
    })
}

pub fn authorize(held: &[Role], method: &str, path: &str) -> Result<(), AppError> {
    let path = path.strip_prefix("/api").unwrap_or(path);
    let method = if method == "HEAD" { "GET" } else { method };
    let allowed = policy()
        .iter()
        .find(|rule| rule.method == method && rule.path == path)
        .is_some_and(|rule| {
            rule.roles.iter().any(|role| role == "authenticated") || {
                let required: Vec<Role> = rule
                    .roles
                    .iter()
                    .filter_map(|role| {
                        serde_json::from_value(serde_json::Value::String(role.clone())).ok()
                    })
                    .collect();
                has_any_role(held, &required)
            }
        });
    if allowed {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "you do not have permission to perform this action".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn independent_roles_and_overrides() {
        assert!(authorize(&[Role::Sales], "POST", "/api/invoices").is_ok());
        assert!(authorize(&[Role::Production], "POST", "/invoices").is_err());
        assert!(authorize(&[Role::Inventory], "GET", "/locations").is_ok());
        assert!(authorize(&[Role::Manager], "PATCH", "/locations/:id").is_err());
        assert!(authorize(&[Role::Admin], "PATCH", "/locations/:id").is_ok());
        assert!(authorize(&[Role::Admin], "POST", "/future-route").is_err());
        assert!(authorize(&[], "GET", "/orders").is_err());
        assert!(authorize(&[], "GET", "/me/preferences").is_ok());
        assert!(authorize(&[Role::Sales], "HEAD", "/customers").is_ok());
    }
    #[test]
    fn every_rule_has_unique_method_path_and_known_roles() {
        let mut seen = std::collections::HashSet::new();
        for rule in policy() {
            assert!(seen.insert((&rule.method, &rule.path)));
            for role in &rule.roles {
                assert!(
                    role == "authenticated"
                        || serde_json::from_value::<Role>(serde_json::json!(role)).is_ok()
                );
            }
        }
    }
    #[test]
    fn trusted_ids_preserve_primary_and_normalize_external_ids() {
        assert_eq!(trusted_organization_ids("org", ""), vec!["org"]);
        assert_eq!(
            trusted_organization_ids(" org ", " , ext,org, ext, second , ,"),
            vec!["org", "ext", "second"]
        );
        assert_eq!(trusted_organization_ids("org", " , , "), vec!["org"]);
    }

    #[test]
    fn external_grants_require_trusted_ids_and_keep_role_permissions() {
        let claims = serde_json::from_value(serde_json::json!({
            "urn:zitadel:iam:org:project:app:roles": {
                "sales": {"org": "primary.example", "ext": "external.example"},
                "production": {"ext": "external.example", "second": "second.example"},
                "admin": {"untrusted": "unknown.example"},
                "manager": {"ext": 42},
                "inventory": ["ext"],
                "unknown": {"ext": "external.example"}
            },
            "urn:zitadel:iam:org:project:other:roles": {"admin": {"ext": "external.example"}},
            "urn:zitadel:iam:org:project:roles": {"admin": {"ext": "external.example"}}
        }))
        .unwrap();
        let local = roles_from_claims(&claims, "app", &trusted_organization_ids("org", ""));
        assert_eq!(local, vec![Role::Sales]);
        let roles = roles_from_claims(
            &claims,
            "app",
            &trusted_organization_ids("org", "ext, second, ext"),
        );
        assert_eq!(roles.len(), 2);
        assert!(roles.contains(&Role::Sales) && roles.contains(&Role::Production));
        assert!(authorize(&roles, "POST", "/orders/:id/stages/:stageId").is_ok());
        assert!(authorize(&roles, "POST", "/locations").is_err());
        assert!(
            roles_from_claims(&claims, "missing", &trusted_organization_ids("org", "ext"))
                .is_empty()
        );
        assert!(roles_from_claims(&claims, "app", &[]).is_empty());
        assert_eq!(
            roles_from_claims(&claims, "app", &trusted_organization_ids("org", "*")),
            local
        );
    }

    #[test]
    fn roles_are_scoped_to_project_and_organization() {
        let claims: HashMap<String, serde_json::Value> =
            serde_json::from_value(serde_json::json!({
                "groups": ["admin"],
                "urn:zitadel:iam:org:project:roles": {"admin": {"org": "domain"}},
                "urn:zitadel:iam:org:project:other:roles": {"admin": {"org": "domain"}},
                "urn:zitadel:iam:org:project:app:roles": {
                    "sales": {"org": "domain"}, "admin": {"other-org": "domain"},
                    "inventory": ["org"], "unknown": {"org": "domain"}
                }
            }))
            .unwrap();
        assert_eq!(
            roles_from_claims(&claims, "app", &["org".into()]),
            vec![Role::Sales]
        );
        assert!(roles_from_claims(&claims, "missing", &["org".into()]).is_empty());
    }
}

pub fn authorize_repair_update(
    held: &[Role],
    input: &crate::features::orders::types::UpdateRepairInput,
) -> Result<(), AppError> {
    use crate::features::orders::types::RepairStatus;
    if has_any_role(held, &[Role::Manager]) {
        return Ok(());
    }
    let commercial = input.reason.is_some()
        || input.charge.is_some()
        || input.status == Some(RepairStatus::Cancelled);
    let production = input
        .status
        .is_some_and(|status| status != RepairStatus::Cancelled);
    if (commercial && !held.contains(&Role::Sales))
        || (production && !held.contains(&Role::Production))
    {
        return Err(AppError::Forbidden(
            "repair details require sales; production status requires production".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod repair_permission_tests {
    use super::*;
    use crate::features::orders::types::UpdateRepairInput;
    #[test]
    fn repair_fields_require_the_responsible_role() {
        for (body, sales, production) in [
            (serde_json::json!({"charge": 10}), true, false),
            (
                serde_json::json!({"reason": "Customer request"}),
                true,
                false,
            ),
            (serde_json::json!({"status": "cancelled"}), true, false),
            (serde_json::json!({"status": "completed"}), false, true),
            (
                serde_json::json!({"status": "in_progress", "charge": 10}),
                false,
                false,
            ),
            (serde_json::json!({"notes": "Checked"}), true, true),
        ] {
            let input: UpdateRepairInput = serde_json::from_value(body).unwrap();
            assert_eq!(
                authorize_repair_update(&[Role::Sales], &input).is_ok(),
                sales
            );
            assert_eq!(
                authorize_repair_update(&[Role::Production], &input).is_ok(),
                production
            );
            assert!(authorize_repair_update(&[Role::Sales, Role::Production], &input).is_ok());
            assert!(authorize_repair_update(&[Role::Manager], &input).is_ok());
        }
    }
}
