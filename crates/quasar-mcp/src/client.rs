use quasar_core::{QuasarResult, ToolDef};

pub struct McpClient {
    // TODO: Implement MCP client
}

impl McpClient {
    pub fn new() -> Self {
        Self {}
    }

    pub async fn connect(&mut self) -> QuasarResult<Vec<ToolDef>> {
        // TODO: Connect to MCP server
        Ok(Vec::new())
    }
}
