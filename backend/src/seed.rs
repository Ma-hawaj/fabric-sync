use sqlx::PgPool;

use crate::error::AppError;

/// Sample data for local development, loaded when `SEED_DEV_DATA=true`.
///
/// The script is executed with `raw_sql` rather than the `query!` macros on
/// purpose: it is unchecked, so it contributes nothing to `.sqlx` and can never
/// make `cargo sqlx prepare --check` fail.
const DEV_SEED: &str = include_str!("../seeds/dev_seed.sql");

/// Loads the seed, but only into a database that has no customers yet.
///
/// The guard is what makes repeated `cargo run`s safe, and it means the flag
/// can never overwrite or duplicate real data — the seed writes fixed ids, so a
/// second run would otherwise collide on every primary key.
pub async fn run(db: &PgPool) -> Result<(), AppError> {
    let already_seeded: bool = sqlx::query_scalar(r#"SELECT EXISTS (SELECT 1 FROM customers)"#)
        .fetch_one(db)
        .await?;

    if already_seeded {
        tracing::info!("dev seed skipped — the database already has data");
        return Ok(());
    }

    sqlx::raw_sql(DEV_SEED).execute(db).await?;
    tracing::info!("dev seed loaded");

    Ok(())
}
