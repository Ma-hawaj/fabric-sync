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

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub oauth_issuer_url: String,
    pub oauth_client_id: String,
    pub oauth_client_secret: Option<String>,
    pub oauth_introspection_url: Option<String>,
    pub oauth_resource_audience: Option<String>,
    /// Loads `seeds/dev_seed.sql` at startup. Off unless explicitly enabled,
    /// and the seed itself refuses to run against a database that already has
    /// data — see `seed::run`.
    pub seed_dev_data: bool,
    pub invoice_branding: InvoiceBranding,
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
        let oauth_introspection_url = env::var("OAUTH_INTROSPECTION_URL").ok();
        let oauth_resource_audience = env::var("OAUTH_RESOURCE_AUDIENCE").ok();
        let seed_dev_data = env::var("SEED_DEV_DATA")
            .map(|value| value == "true" || value == "1")
            .unwrap_or(false);

        Self {
            port,
            database_url,
            oauth_issuer_url,
            oauth_client_id,
            oauth_client_secret,
            oauth_introspection_url,
            oauth_resource_audience,
            seed_dev_data,
            invoice_branding: InvoiceBranding::from_env(),
        }
    }
}
