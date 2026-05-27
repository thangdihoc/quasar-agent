use napi_derive::napi;
use tiktoken_rs::cl100k_base;
use similar::{ChangeTag, TextDiff};

#[napi]
pub fn count_tokens(text: String) -> u32 {
    let bpe = cl100k_base().unwrap();
    bpe.encode_with_special_tokens(&text).len() as u32
}

#[napi]
pub fn create_diff(original: String, modified: String) -> String {
    let diff = TextDiff::from_lines(&original, &modified);
    let mut result = String::new();
    for change in diff.iter_all_changes() {
        let sign = match change.tag() {
            ChangeTag::Delete => "-",
            ChangeTag::Insert => "+",
            ChangeTag::Equal => " ",
        };
        result.push_str(&format!("{}{}", sign, change));
    }
    result
}

#[napi]
pub fn apply_patch(content: String, search: String, replace: String) -> String {
    content.replace(&search, &replace)
}

#[napi]
pub fn compact_context(text: String, max_tokens: i64) -> String {
    let bpe = cl100k_base().unwrap();
    let tokens = bpe.encode_with_special_tokens(&text);
    if tokens.len() <= max_tokens as usize {
        return text;
    }
    let truncated = &tokens[..max_tokens as usize];
    bpe.decode(truncated.to_vec()).unwrap_or_else(|_| {
        text.chars().take(max_tokens as usize * 4).collect()
    })
}
