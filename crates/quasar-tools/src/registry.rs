use quasar_core::{ToolDef, QuasarResult};

pub struct ToolRegistry {
    // TODO: Implement tool registry
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {}
    }

    pub fn register_all(&mut self) -> QuasarResult<Vec<ToolDef>> {
        // TODO: Register all tools
        Ok(Vec::new())
    }
}
