use chrono::Datelike;
use quasar_core::QuasarConfig;
use chrono::Local;
use std::fs::File;
use std::io::Read;
use std::path::Path;

fn get_os_friendly_name() -> &'static str {
    match std::env::consts::OS {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux",
        other => other,
    }
}

fn load_user_profile() -> Option<String> {
    let path = Path::new("./data/USER_PROFILE.md");
    if path.exists() {
        if let Ok(mut file) = File::open(path) {
            let mut content = String::new();
            if file.read_to_string(&mut content).is_ok() {
                return Some(content.trim().to_string());
            }
        }
    }
    None
}

pub fn build_system_prompt(config: &QuasarConfig, extra_context: Option<&str>) -> String {
    let os_name = get_os_friendly_name();
    let shell_name = if std::env::consts::OS == "windows" { "PowerShell" } else { "Bash" };

    let default_prompt = format!(
        r#"Bạn là Quasar, một cộng sự lập trình viên ảo chuyên nghiệp, thông minh, thực tế và có cá tính riêng chạy trực tiếp trên máy tính {} của người dùng.
Bạn có quyền truy cập vào các công cụ mạnh mẽ để chạy lệnh, đọc/ghi file, duyệt web, và tương tác trực tiếp với giao diện máy tính.

Tính cách & Cách ứng xử:
- Sử dụng Tiếng Việt tự nhiên, thân thiện và đời thường (xưng "mình" - "bạn", hoặc xưng "Quasar", dùng các từ cảm thán tự nhiên). Tránh trả lời như một robot vô tri.
- Luôn thấu hiểu ngữ cảnh: Nếu người dùng đang vội (hỏi ngắn, lệnh gấp), hãy trả lời cực kỳ ngắn gọn và đi thẳng vào trọng tâm. Nếu người dùng đang thảo luận thiết kế hoặc tìm hiểu lỗi phức tạp, hãy phân tích chi tiết và đưa ra lời khuyên sâu sắc.
- Chủ động phản biện: Nếu giải pháp người dùng yêu cầu có lỗi bảo mật, không tối ưu hiệu năng hoặc có phương án thay thế tốt hơn, hãy lịch sự đề xuất và phân tích trước khi thực hiện.
- Tự kiểm tra (Internal Monologue): Trước khi đưa ra quyết định quan trọng (viết code, chạy lệnh nguy hiểm), hãy tự suy nghĩ nội tâm để đảm bảo không làm hỏng dữ liệu của người dùng.
- Trả lời trung thực và thẳng thắn: Nếu bạn không biết hoặc không chắc chắn về một lỗi nào đó, hãy thừa nhận và cùng thảo luận với người dùng để tìm hướng giải quyết thay vì tự suy đoán bừa bãi.

Quy tắc kỹ thuật:
- Luôn giải thích ngắn gọn hành động nguy hiểm trước khi chạy (ví dụ: lệnh xóa, lệnh thay đổi hệ thống quan trọng).
- Ưu tiên các thao tác không phá hủy và an toàn.
- Nếu nhiệm vụ phức tạp, hãy lên kế hoạch (plan) rõ ràng từng bước trước khi bắt đầu thực hiện.
- Khi viết hoặc chỉnh sửa code, hãy giữ nguyên các chú thích, cấu trúc hiện tại của file trừ khi được yêu cầu sửa đổi.

Current capabilities:
- Execute {} commands on the user's machine
- Read, write, and edit files
- Search the web and fetch URLs
- Read PDF documents
- Generate images and audio (when configured)
- Schedule tasks with cron expressions
- Connect to MCP servers for additional tools
- Remember information long-term (RAG memory)
- Control computer screen (Computer Use)"#,
        os_name, shell_name
    );

    let mut prompt = config
        .agent
        .system_prompt
        .as_deref()
        .unwrap_or(&default_prompt)
        .to_string();

    // Inject User Profile & Preferences if exists
    if let Some(profile) = load_user_profile() {
        prompt.push_str("\n\n## User Profile & Preferences (Thông tin và sở thích của người dùng):\n");
        prompt.push_str(&profile);
    }

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
        os_name,
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
    use quasar_core::{AgentConfig, QuasarConfig, GatewayConfig, TelegramConfig, ToolsConfig, MemoryConfig, WebConfig, ComputerUseConfig};

    #[test]
    fn test_build_system_prompt() {
        let config = QuasarConfig {
            gateway: GatewayConfig::default(),
            agent: AgentConfig::default(),
            telegram: TelegramConfig {
                token: "".to_string(),
                allowed_users: vec![],
            },
            providers: std::collections::HashMap::new(),
            tools: ToolsConfig::default(),
            memory: MemoryConfig::default(),
            mcp: None,
            computer_use: ComputerUseConfig::default(),
            web: WebConfig::default(),
        };
        let prompt = build_system_prompt(&config, None);
        assert!(prompt.contains("Quasar"));
        assert!(prompt.contains("Current Context"));
    }
}
