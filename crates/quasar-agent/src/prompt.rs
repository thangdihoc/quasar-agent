use quasar_core::QuasarConfig;
use chrono::Local;

const DEFAULT_SYSTEM_PROMPT: &str = r#"You are Quasar, a powerful personal AI assistant running on the user's Windows machine.
You have access to tools that let you execute commands, read/write files, search the web, and more.

Key behaviors:
- Be concise and direct
- Use tools proactively when they help
- Always explain what you're doing before executing dangerous commands
- Format responses in markdown when helpful
- If a task requires multiple steps, plan first then execute
- When executing PowerShell commands, prefer non-destructive operations
- If you're unsure about something, ask the user

Current capabilities:
- Execute PowerShell commands on the user's machine
- Read, write, and edit files
- Search the web and fetch URLs
- Read PDF documents
- Generate images and audio (when configured)
- Schedule tasks with cron expressions
- Connect to MCP servers for additional tools
- Remember information long-term (RAG memory)
- Control computer screen (Computer Use)"#;

pub fn build_system_prompt(config: &QuasarConfig, extra_context: Option<&str>) -> String {
    let mut prompt = config
        .agent
        .system_prompt
        .as_deref()
        .unwrap_or(DEFAULT_SYSTEM_PROMPT)
        .to_string();

    // Smart Context Injection
    let now = Local::now();
    let weekday = match now.weekday() {
        chrono::Weekday::Mon => "Thứ Hai",
        chrono::Weekday::Tue => "Thứ Ba",
        chrono::Weekday::Wed => "Thứ Tư",
        chrono::Weekday::Thu => "Thứ Năm",
        chrono::Weekday::Fri => "Thứ Sáu",
        chrono::Weekday::Sat => "Thứ Bảy",
        chrono::Weekday::Sun => "Chủ Nhật",
    };

    let context_block = format!(
        r#"

## Current Context
- Date/Time: {} {}
- Day: {}
- System: {} {}
- Node.js: Rust Agent v{}
"#,
        now.format("%d/%m/%Y"),
        now.format("%H:%M:%S"),
        weekday,
        std::env::consts::OS,
        std::env::consts::ARCH,
        env!("CARGO_PKG_VERSION")
    );

    prompt.push_str(&context_block);

    if let Some(extra) = extra_context {
        prompt.push_str("\n\n");
        prompt.push_str(extra);
    }

    prompt
}

#[cfg(test)]
mod tests {
    use super::*;
    use quasar_core::{AgentConfig, QuasarConfig};

    #[test]
    fn test_build_system_prompt() {
        let config = QuasarConfig {
            agent: AgentConfig::default(),
            ..Default::default()
        };
        let prompt = build_system_prompt(&config, None);
        assert!(prompt.contains("Quasar"));
        assert!(prompt.contains("Current Context"));
    }
}
