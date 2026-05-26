use crate::{QuasarConfig, QuasarError, QuasarResult};
use std::path::Path;

pub async fn load_config(path: impl AsRef<Path>) -> QuasarResult<QuasarConfig> {
    let content = tokio::fs::read_to_string(path.as_ref())
        .await
        .map_err(|e| QuasarError::config(format!("Failed to read config file: {}", e)))?;

    let config: QuasarConfig = toml::from_str(&content)
        .map_err(|e| QuasarError::config(format!("Failed to parse config: {}", e)))?;

    Ok(config)
}

pub fn load_config_sync(path: impl AsRef<Path>) -> QuasarResult<QuasarConfig> {
    let content = std::fs::read_to_string(path.as_ref())
        .map_err(|e| QuasarError::config(format!("Failed to read config file: {}", e)))?;

    let config: QuasarConfig = toml::from_str(&content)
        .map_err(|e| QuasarError::config(format!("Failed to parse config: {}", e)))?;

    Ok(config)
}
