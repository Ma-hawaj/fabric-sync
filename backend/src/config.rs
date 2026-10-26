use std::env;

/// Who the business is, as printed on the invoice document. None of it belongs
/// in the database — it is one seller, fixed for the deployment — and none of
/// it belongs in the template either, so that the same template can be used by
/// a second branch of the business without being edited.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceBranding {
    pub name_en: String,
    pub name_ar: String,
    pub vat_number: String,
    pub cr_number: String,
    pub address_en: String,
    pub address_ar: String,
    pub phone: String,
    pub email: String,
    /// A `data:` URI rather than a link: the rendered document has to stay
    /// self-contained, since it is printed from an iframe with no page of its
    /// own to resolve relative URLs against, and will later be handed to a
    /// PDF renderer that may have no network access at all.
    pub logo_data_url: Option<String>,
    /// Where to load `invoice.html` from. Unset means the copy compiled into
    /// the binary; setting it points minijinja at a directory instead, so the
    /// document can be restyled without rebuilding.
    #[serde(skip)]
    pub template_dir: Option<String>,
}

#[cfg(test)]
mod urgent_pricing_tests {
    use super::*;

    #[test]
    fn vat_rate_requires_a_finite_fraction_that_fits_the_saved_precision() {
        let mut config = Config::from_env();
        for (raw, expected) in [
            ("0", 0.0),
            ("0.10", 0.1),
            ("0.15", 0.15),
            ("1", 1.0),
            ("0.123456", 0.123456),
        ] {
            config.vat_rate = raw.into();
            assert_eq!(config.vat_rate().unwrap(), expected);
        }
        for raw in [
            "-0.1",
            "1.01",
            "NaN",
            "inf",
            "invalid",
            "",
            "0.1234567",
            "1e-20",
        ] {
            config.vat_rate = raw.into();
            assert!(config.vat_rate().is_err(), "{raw}");
        }
    }

    #[test]
    fn customer_material_price_must_be_explicit_positive_money() {
        let mut config = Config::from_env();
        config.customer_material_base_price = None;
        assert!(config.customer_material_base_price().unwrap().is_none());
        config.customer_material_base_price = Some("15".into());
        assert_eq!(config.customer_material_base_price().unwrap(), Some(15.0));
        for value in ["0", "-1", "0.001", "NaN", "invalid", "100000000"] {
            config.customer_material_base_price = Some(value.into());
            assert!(config.customer_material_base_price().is_err(), "{value}");
        }
    }

    #[test]
    fn urgency_needs_an_explicit_positive_pricing_rule() {
        let mut config = Config::from_env();
        config.urgent_charge_amount = None;
        assert!(config.urgent_charge_rule().unwrap().is_none());
        config.urgent_charge_unit = "amount".into();
        config.urgent_charge_amount = Some("5".into());
        assert_eq!(config.urgent_charge_rule().unwrap().unwrap().amount, 5.0);
        for amount in ["-1", "0", "0.001", "NaN", "invalid", "100000000"] {
            config.urgent_charge_amount = Some(amount.into());
            assert!(config.urgent_charge_rule().is_err(), "{amount}");
        }
        config.urgent_charge_unit = "percent".into();
        config.urgent_charge_amount = Some("101".into());
        assert!(config.urgent_charge_rule().is_err());
        config.urgent_charge_amount = Some("10".into());
        assert!(config.urgent_charge_rule().is_ok());
        config.urgent_charge_unit = "invalid".into();
        assert!(config.urgent_charge_rule().is_err());
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    pub notifications: crate::features::notifications::Config,
    pub port: u16,
    pub database_url: String,
    pub oauth_issuer_url: String,
    pub oauth_client_id: String,
    pub oauth_client_secret: Option<String>,
    pub oauth_introspection_url: Option<String>,
    pub oauth_resource_audience: Option<String>,
    /// IANA timezone the printed documents write dates in (e.g.
    /// `Asia/Bahrain`) — the database stores UTC, and a date printed in the
    /// wrong zone is a wrong date on the paper. Unset means Bahrain.
    pub timezone: String,
    /// Credentials for a dedicated Zitadel machine user used only to back
    /// `GET /users` (see `features::users::zitadel`) — separate from
    /// `oauth_client_id`/`oauth_client_secret` above, which authenticate an
    /// API resource-server credential with no grantable directory-read
    /// permission of its own. `None` unless both are set.
    pub zitadel_users_client_id: Option<String>,
    pub zitadel_users_client_secret: Option<String>,
    /// Loads `seeds/dev_seed.sql` at startup. Off unless explicitly enabled,
    /// and the seed itself refuses to run against a database that already has
    /// data — see `seed::run`.
    pub seed_dev_data: bool,
    /// Loads the staff-facing design catalog and its bundled illustrations
    /// from `seeds/design_options.sql`. Off by default so catalog bootstrap is
    /// an explicit deployment choice and never part of a schema migration.
    pub seed_design_options: bool,
    pub invoice_branding: InvoiceBranding,
    /// Directory the built frontend (`vite build` output) is served from.
    /// Unset means `./static` next to the server binary — the Dockerfile
    /// copies the frontend `dist/` there. Missing directory is not an error:
    /// API routes still work and every other path 404s until a build is
    /// dropped in (e.g. plain `cargo run` without building the frontend).
    pub static_dir: String,
    pub urgent_charge_amount: Option<String>,
    pub urgent_charge_unit: String,
    pub customer_material_base_price: Option<String>,
    pub vat_rate: String,
}

impl InvoiceBranding {
    fn from_env() -> Self {
        fn var(key: &str, fallback: &str) -> String {
            env::var(key)
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| fallback.to_string())
        }

        Self {
            name_en: var("COMPANY_NAME_EN", "Fabric Sync"),
            name_ar: var("COMPANY_NAME_AR", "فابريك سينك"),
            vat_number: var("COMPANY_VAT_NUMBER", ""),
            cr_number: var("COMPANY_CR_NUMBER", ""),
            address_en: var("COMPANY_ADDRESS_EN", ""),
            address_ar: var("COMPANY_ADDRESS_AR", ""),
            phone: var("COMPANY_PHONE", ""),
            email: var("COMPANY_EMAIL", ""),
            logo_data_url: env::var("COMPANY_LOGO_DATA_URL")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            template_dir: env::var("INVOICE_TEMPLATE_DIR")
                .ok()
                .filter(|value| !value.trim().is_empty()),
        }
    }
}

impl Config {
    pub fn vat_rate(&self) -> Result<f64, String> {
        let rate: f64 = self
            .vat_rate
            .parse()
            .map_err(|_| "VAT_RATE must be a decimal fraction between 0 and 1".to_string())?;
        if !rate.is_finite() || !(0.0..=1.0).contains(&rate) {
            return Err("VAT_RATE must be a finite decimal fraction between 0 and 1".into());
        }
        let scaled = rate * 1_000_000.0;
        if (scaled - scaled.round()).abs() > f64::EPSILON * scaled.abs() * 4.0 {
            return Err("VAT_RATE must have at most six decimal places".into());
        }
        // Match the precision of invoices.vat_rate, including its canonical
        // floating-point representation when it is read back from NUMERIC.
        Ok(scaled.round() / 1_000_000.0)
    }

    pub fn customer_material_base_price(&self) -> Result<Option<f64>, String> {
        let Some(raw) = &self.customer_material_base_price else {
            return Ok(None);
        };
        let amount: f64 = raw
            .parse()
            .map_err(|_| "CUSTOMER_MATERIAL_BASE_PRICE must be a positive amount".to_string())?;
        if crate::features::pricing::service::validate_amount(amount).is_err() || amount <= 0.0 {
            return Err(
                "CUSTOMER_MATERIAL_BASE_PRICE must be positive with at most two decimal places"
                    .into(),
            );
        }
        Ok(Some(amount))
    }

    pub fn urgent_charge_rule(
        &self,
    ) -> Result<Option<crate::features::pricing::types::UrgentChargeRule>, String> {
        use crate::features::pricing::{
            service::validate_amount,
            types::{UrgentChargeRule, UrgentChargeUnit},
        };
        let Some(raw) = &self.urgent_charge_amount else {
            return Ok(None);
        };
        let amount: f64 = raw
            .parse()
            .map_err(|_| "URGENT_ORDER_CHARGE must be a positive amount".to_string())?;
        if validate_amount(amount).is_err() || amount <= 0.0 {
            return Err(
                "URGENT_ORDER_CHARGE must be positive with at most two decimal places".into(),
            );
        }
        let unit = match self.urgent_charge_unit.as_str() {
            "amount" => UrgentChargeUnit::Amount,
            "percent" if amount <= 100.0 => UrgentChargeUnit::Percent,
            _ => {
                return Err(
                    "URGENT_ORDER_CHARGE_UNIT must be amount or percent (at most 100%)".into(),
                )
            }
        };
        Ok(Some(UrgentChargeRule { amount, unit }))
    }

    /// The zone printed documents write dates in. Checked once at startup —
    /// a misspelled TIMEZONE must refuse to boot rather than silently print
    /// UTC again.
    pub fn timezone(&self) -> Result<chrono_tz::Tz, String> {
        self.timezone
            .parse()
            .map_err(|_| format!("unknown TIMEZONE {:?}", self.timezone))
    }

    pub fn from_env() -> Self {
        let port = env::var("PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(3000);
        let database_url = env::var("DATABASE_URL").unwrap_or_else(|_| {
            "postgres://postgres:postgres@localhost:5432/fabric_sync".to_string()
        });
        let oauth_issuer_url = env::var("OAUTH_ISSUER_URL")
            .or_else(|_| env::var("OIDC_ISSUER_URL"))
            .unwrap_or_else(|_| "http://localhost:8080".to_string());
        let oauth_client_id = env::var("OAUTH_CLIENT_ID")
            .or_else(|_| env::var("OIDC_CLIENT_ID"))
            .unwrap_or_else(|_| "client_id".to_string());
        let oauth_client_secret = env::var("OAUTH_CLIENT_SECRET")
            .or_else(|_| env::var("OIDC_CLIENT_SECRET"))
            .ok();
        let oauth_introspection_url = env::var("OAUTH_INTROSPECTION_URL")
            .ok()
            .filter(|value| !value.trim().is_empty());
        let oauth_resource_audience = env::var("OAUTH_RESOURCE_AUDIENCE")
            .ok()
            .filter(|value| !value.trim().is_empty());
        let zitadel_users_client_id = env::var("ZITADEL_USERS_CLIENT_ID")
            .ok()
            .filter(|value| !value.trim().is_empty());
        let zitadel_users_client_secret = env::var("ZITADEL_USERS_CLIENT_SECRET")
            .ok()
            .filter(|value| !value.trim().is_empty());
        let seed_dev_data = env::var("SEED_DEV_DATA")
            .map(|value| value == "true" || value == "1")
            .unwrap_or(false);
        let seed_design_options = env::var("SEED_DESIGN_OPTIONS")
            .map(|value| value == "true" || value == "1")
            .unwrap_or(false);
        let timezone = env::var("TIMEZONE")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "Asia/Bahrain".to_string());
        let static_dir = env::var("STATIC_DIR")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "static".to_string());

        Self {
            port,
            vat_rate: env::var("VAT_RATE").unwrap_or_else(|_| "0.10".into()),
            urgent_charge_amount: env::var("URGENT_ORDER_CHARGE")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            urgent_charge_unit: env::var("URGENT_ORDER_CHARGE_UNIT")
                .unwrap_or_else(|_| "amount".into()),
            customer_material_base_price: env::var("CUSTOMER_MATERIAL_BASE_PRICE")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            database_url,
            oauth_issuer_url,
            oauth_client_id,
            oauth_client_secret,
            oauth_introspection_url,
            oauth_resource_audience,
            zitadel_users_client_id,
            zitadel_users_client_secret,
            seed_dev_data,
            seed_design_options,
            timezone,
            static_dir,
            invoice_branding: InvoiceBranding::from_env(),
            notifications: crate::features::notifications::Config::from_env(),
        }
    }
}
