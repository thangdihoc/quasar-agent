use quasar_core::QuasarResult;
use std::time::Duration;

/// Fetch content from a URL as cleaned text
pub async fn web_fetch(url: &str, max_length: Option<usize>) -> QuasarResult<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;

    let response = client
        .get(url)
        .header("User-Agent", "Quasar-Agent/0.3")
        .send()
        .await?;

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|val| val.to_str().ok())
        .unwrap_or("")
        .to_string();

    if !content_type.contains("text") && !content_type.contains("json") && !content_type.contains("xml") {
        let size = response
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|val| val.to_str().ok())
            .unwrap_or("unknown")
            .to_string();
        return Ok(format!("Binary content ({}), size: {} bytes", content_type, size));
    }

    let raw_text = response.text().await?;
    let mut text = raw_text;

    // Basic HTML stripping if applicable
    if content_type.contains("html") {
        text = strip_html(&text);
    }

    let limit = max_length.unwrap_or(20_000);
    if text.len() > limit {
        text = format!("{}\n... (truncated)", &text[..limit]);
    }

    Ok(text)
}

fn strip_html(html: &str) -> String {
    let document = scraper::Html::parse_document(html);
    let mut text_pieces = Vec::new();

    // Use scraper's selectors to get elements and extract text correctly
    let selector = scraper::Selector::parse("body").unwrap();
    if let Some(body) = document.select(&selector).next() {
        for text_node in body.text() {
            let trimmed = text_node.trim();
            if !trimmed.is_empty() {
                text_pieces.push(trimmed);
            }
        }
    } else {
        // Fallback to all text
        for text_node in document.root_element().text() {
            let trimmed = text_node.trim();
            if !trimmed.is_empty() {
                text_pieces.push(trimmed);
            }
        }
    }

    text_pieces.join(" ")
}
