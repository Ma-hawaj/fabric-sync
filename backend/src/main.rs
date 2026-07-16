mod app;
mod auth;
mod config;
mod error;
mod features;
mod state;

use std::net::SocketAddr;

use config::Config;
use sqlx::postgres::PgPoolOptions;
use state::AppState;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<(), error::AppError> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env();
    let address = SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(address).await?;
    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await?;
    sqlx::migrate!().run(&db).await?;
    let token_introspection = auth::TokenIntrospection::discover(&config)
        .await
        .map_err(error::AppError::Auth)?;
    let app = app::router(AppState::new(config, db, token_introspection));

    axum::serve(listener, app).await?;

    Ok(())
}
