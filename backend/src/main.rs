mod app;
mod auth;
mod config;
mod document;
mod error;
mod features;
mod list;
mod request_log;
mod seed;
mod state;
#[cfg(test)]
mod test_support;

use std::net::SocketAddr;

use config::Config;
use sqlx::postgres::PgPoolOptions;
use state::AppState;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<(), error::AppError> {
    if let Err(e) = dotenvy::dotenv() {
        eprintln!("Warning: Could not load .env file: {}", e);
        eprintln!("Falling back to system environment variables.");
    }

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .with(tracing_subscriber::fmt::layer())
        .init();

    // None of this runs inside a request, so it's outside request_log's
    // canonical line entirely — a DB or OIDC-discovery failure here would
    // otherwise only ever surface as tokio::main's default Debug-print, not
    // through tracing like every other error in the app.
    if let Err(error) = run().await {
        tracing::error!(error = ?error, "server exited with an error");
        return Err(error);
    }

    Ok(())
}

async fn run() -> Result<(), error::AppError> {
    let config = Config::from_env();
    // A misspelled TIMEZONE must refuse to boot rather than silently print
    // UTC on every document.
    config.timezone().map_err(error::AppError::Config)?;
    config.notifications.messages(false)?;
    config.notifications.messages(true)?;
    let address = SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(address).await?;
    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await?;
    sqlx::migrate!().run(&db).await?;

    seed::run_reference_data(&db).await?;

    if config.seed_design_options {
        seed::run_design_options(&db).await?;
    }

    if config.seed_dev_data {
        seed::run(&db).await?;
    }

    let token_introspection = auth::TokenIntrospection::discover(&config)
        .await
        .map_err(error::AppError::Auth)?;
    let zitadel_users = features::users::zitadel::ZitadelUserDirectory::discover(&config)
        .await
        .map_err(error::AppError::Auth)?;
    let state = AppState::new(config, db, token_introspection, zitadel_users);
    features::notifications::start(state.clone());
    let app = app::router(state);

    tracing::info!("Listening on: {}", address);
    axum::serve(listener, app).await?;

    Ok(())
}
