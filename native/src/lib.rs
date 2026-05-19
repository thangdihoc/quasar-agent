use napi_derive::napi;

/// Count tokens for a given text using tiktoken (cl100k_base — GPT-4/Claude compatible)
#[napi]
pub fn count_tokens(text: String) -> u32 {
    let bpe = tiktoken_rs::cl100k_base().unwrap();
    bpe.encode_ordinary(&text).len() as u32
}

/// Create a unified diff between original and modified text
#[napi]
pub fn create_diff(original: String, modified: String) -> String {
    use similar::{ChangeTag, TextDiff};
    let diff = TextDiff::from_lines(&original, &modified);
    let mut output = String::new();

    for change in diff.iter_all_changes() {
        let sign = match change.tag() {
            ChangeTag::Delete => "-",
            ChangeTag::Insert => "+",
            ChangeTag::Equal => " ",
        };
        output.push_str(&format!("{}{}", sign, change));
    }

    output
}

/// Apply a simple search/replace patch to content
#[napi]
pub fn apply_patch(content: String, search: String, replace: String) -> String {
    content.replacen(&search, &replace, 1)
}

/// Compact context by summarizing long text (simple truncation for now)
#[napi]
pub fn compact_context(text: String, max_tokens: u32) -> String {
    let bpe = tiktoken_rs::cl100k_base().unwrap();
    let tokens = bpe.encode_ordinary(&text);

    if tokens.len() as u32 <= max_tokens {
        return text;
    }

    let truncated_tokens = &tokens[..max_tokens as usize];
    bpe.decode(truncated_tokens.to_vec()).unwrap_or_else(|_| text[..text.len() / 2].to_string())
}
