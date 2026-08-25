mod app;
mod auth;
mod config;
mod error;
mod features;
mod request_log;
mod seed;
mod state;

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
    let address = SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(address).await?;
    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await?;
    sqlx::migrate!().run(&db).await?;

    if config.seed_dev_data {
        seed::run(&db).await?;
    }

    let token_introspection = auth::TokenIntrospection::discover(&config)
        .await
        .map_err(error::AppError::Auth)?;
    let zitadel_users = features::users::zitadel::ZitadelUserDirectory::discover(&config)
        .await
        .map_err(error::AppError::Auth)?;
    let app = app::router(AppState::new(
        config,
        db,
        token_introspection,
        zitadel_users,
    ));

    tracing::info!("Listening on: {}", address);
    axum::serve(listener, app).await?;

    Ok(())
}
