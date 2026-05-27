use quasar_core::{ToolDef, QuasarResult, ToolParameter};
use std::collections::HashMap;

pub struct ToolRegistry {}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {}
    }

    pub fn register_all() -> QuasarResult<Vec<ToolDef>> {
        let mut tools = Vec::new();

        // 1. file_read
        let mut read_params = HashMap::new();
        read_params.insert("path".to_string(), ToolParameter {
            param_type: "string".to_string(),
            description: Some("Absolute path to the file".to_string()),
            items: None,
            properties: None,
            required: None,
        });
        read_params.insert("maxLines".to_string(), ToolParameter {
            param_type: "number".to_string(),
            description: Some("Max lines to read (default: all)".to_string()),
            items: None,
            properties: None,
            required: None,
        });
        tools.push(ToolDef {
            name: "file_read".to_string(),
            description: "Read the contents of a file. Supports text files.".to_string(),
            parameters: ToolParameter {
                param_type: "object".to_string(),
                description: None,
                items: None,
                properties: Some(read_params),
                required: Some(vec!["path".to_string()]),
            },
        });

        // 2. file_write
        let mut write_params = HashMap::new();
        write_params.insert("path".to_string(), ToolParameter {
            param_type: "string".to_string(),
            description: Some("Absolute path to the file".to_string()),
            items: None,
            properties: None,
            required: None,
        });
        write_params.insert("content".to_string(), ToolParameter {
            param_type: "string".to_string(),
            description: Some("Content to write".to_string()),
            items: None,
            properties: None,
            required: None,
        });
        tools.push(ToolDef {
            name: "file_write".to_string(),
            description: "Write content to a file. Creates parent directories if needed.".to_string(),
            parameters: ToolParameter {
                param_type: "object".to_string(),
                description: None,
                items: None,
                properties: Some(write_params),
                required: Some(vec!["path".to_string(), "content".to_string()]),
            },
        });

        // 3. file_edit
        let mut edit_params = HashMap::new();
        edit_params.insert("path".to_string(), ToolParameter {
            param_type: "string".to_string(),
            description: Some("Absolute path to the file".to_string()),
            items: None,
            properties: None,
            required: None,
        });
        edit_params.insert("search".to_string(), ToolParameter {
            param_type: "string".to_string(),
            description: Some("Exact text to find".to_string()),
            items: None,
            properties: None,
            required: None,
        });
        edit_params.insert("replace".to_string(), ToolParameter {
            param_type: "string".to_string(),
            description: Some("Text to replace with".to_string()),
            items: None,
            properties: None,
            required: None,
        });
        tools.push(ToolDef {
            name: "file_edit".to_string(),
            description: "Edit a file by replacing a specific string with another.".to_string(),
            parameters: ToolParameter {
                param_type: "object".to_string(),
                description: None,
                items: None,
                properties: Some(edit_params),
                required: Some(vec!["path".to_string(), "search".to_string(), "replace".to_string()]),
            },
        });

        // 4. file_list
        let mut list_params = HashMap::new();
        list_params.insert("path".to_string(), ToolParameter {
            param_type: "string".to_string(),
            description: Some("Absolute path to the directory".to_string()),
            items: None,
            properties: None,
            required: None,
        });
        tools.push(ToolDef {
            name: "file_list".to_string(),
            description: "List files and directories in a path.".to_string(),
            parameters: ToolParameter {
                param_type: "object".to_string(),
                description: None,
                items: None,
                properties: Some(list_params),
                required: Some(vec!["path".to_string()]),
            },
        });

        // 5. exec (System command)
        let mut exec_params = HashMap::new();
        exec_params.insert("command".to_string(), ToolParameter {
            param_type: "string".to_string(),
            description: Some("The command to execute (PowerShell format on Windows, Bash on macOS/Linux)".to_string()),
            items: None,
            properties: None,
            required: None,
        });
        exec_params.insert("timeout".to_string(), ToolParameter {
            param_type: "number".to_string(),
            description: Some("Timeout in milliseconds (default: 30000)".to_string()),
            items: None,
            properties: None,
            required: None,
        });
        tools.push(ToolDef {
            name: "exec".to_string(),
            description: "Execute a terminal/shell command on the user's machine. Uses PowerShell on Windows and Bash on macOS/Linux. Use this for system operations, file management, running scripts, installing software, etc. Always explain what the command does before running it.".to_string(),
            parameters: ToolParameter {
                param_type: "object".to_string(),
                description: None,
                items: None,
                properties: Some(exec_params),
                required: Some(vec!["command".to_string()]),
            },
        });

        // 6. web_fetch
        let mut fetch_params = HashMap::new();
        fetch_params.insert("url".to_string(), ToolParameter {
            param_type: "string".to_string(),
            description: Some("The URL to fetch".to_string()),
            items: None,
            properties: None,
            required: None,
        });
        fetch_params.insert("maxLength".to_string(), ToolParameter {
            param_type: "number".to_string(),
            description: Some("Max characters to return (default: 20000)".to_string()),
            items: None,
            properties: None,
            required: None,
        });
        tools.push(ToolDef {
            name: "web_fetch".to_string(),
            description: "Fetch content from a URL and return as text.".to_string(),
            parameters: ToolParameter {
                param_type: "object".to_string(),
                description: None,
                items: None,
                properties: Some(fetch_params),
                required: Some(vec!["url".to_string()]),
            },
        });

        Ok(tools)
    }
}
