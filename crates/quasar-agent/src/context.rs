use tiktoken_rs::cl100k_base;

/// Estimate token count using tiktoken
pub fn estimate_tokens(text: &str) -> usize {
    match cl100k_base() {
        Ok(bpe) => bpe.encode_with_special_tokens(text).len(),
        Err(_) => {
            // Fallback heuristic
            let ascii = text.chars().filter(|c| c.is_ascii()).count();
            let non_ascii = text.chars().count() - ascii;
            (ascii / 4) + (non_ascii / 2)
        }
    }
}

/// Truncate tool output that's too long
pub fn truncate_tool_output(output: &str, max_tokens: usize) -> String {
    let tokens = estimate_tokens(output);
    if tokens <= max_tokens {
        return output.to_string();
    }

    match cl100k_base() {
        Ok(bpe) => {
            let tokens = bpe.encode_with_special_tokens(output);
            let truncated = &tokens[..max_tokens.min(tokens.len())];
            match bpe.decode(truncated.to_vec()) {
                Ok(decoded) => format!("{}\n\n... (truncated by Rust)", decoded),
                Err(_) => {
                    let max_chars = max_tokens * 4;
                    let truncated: String = output.chars().take(max_chars).collect();
                    let remaining = output.len() - truncated.len();
                    format!("{}\n\n... ({} characters truncated)", truncated, remaining)
                }
            }
        }
        Err(_) => {
            let max_chars = max_tokens * 4;
            let truncated: String = output.chars().take(max_chars).collect();
            let remaining = output.len() - truncated.len();
            format!("{}\n\n... ({} characters truncated)", truncated, remaining)
        }
    }
}

/// Build context window from messages
pub fn build_context_window(
    messages: &[quasar_core::Message],
    max_tokens: usize,
) -> Vec<quasar_core::Message> {
    let mut total_tokens = 0;
    let mut result = Vec::new();

    // Iterate from newest to oldest
    for msg in messages.iter().rev() {
        let msg_tokens = estimate_tokens(&msg.content) + 4; // overhead
        if total_tokens + msg_tokens > max_tokens && !result.is_empty() {
            break;
        }
        result.push(msg.clone());
        total_tokens += msg_tokens;
    }

    result.reverse();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_estimate_tokens() {
        let text = "Hello, world!";
        let tokens = estimate_tokens(text);
        assert!(tokens > 0);
        assert!(tokens < 10);
    }

    #[test]
    fn test_truncate_tool_output() {
        let long_text = "a".repeat(10000);
        let truncated = truncate_tool_output(&long_text, 100);
        assert!(truncated.len() < long_text.len());
        assert!(truncated.contains("truncated"));
    }
}
