use crate::config::Config;

#[derive(Clone, Debug)]
pub struct AppState {
    config: Config,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        Self { config }
    }

    pub fn port(&self) -> u16 {
        self.config.port
    }
}
