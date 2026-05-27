use quasar_core::{QuasarResult, QuasarError};
use std::path::Path;
use tokio::fs::{self, File};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// Read a file's content
pub async fn file_read(path_str: &str, max_lines: Option<usize>) -> QuasarResult<String> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err(QuasarError::tool(format!("File does not exist: {}", path_str)));
    }

    let mut file = File::open(path).await?;
    let mut contents = String::new();
    file.read_to_string(&mut contents).await?;

    let mut result = contents;
    if let Some(max) = max_lines {
        let lines: Vec<&str> = result.lines().collect();
        let total_lines = lines.len();
        let sliced = lines.into_iter().take(max).collect::<Vec<&str>>().join("\n");
        result = sliced;
        if total_lines > max {
            result.push_str(&format!("\n... ({} more lines)", total_lines - max));
        }
    }

    if result.len() > 20_000 {
        result = format!("{}\n... (truncated)", &result[..20_000]);
    }

    Ok(result)
}

/// Write content to a file. Creates parent directories if needed.
pub async fn file_write(path_str: &str, content: &str) -> QuasarResult<String> {
    let path = Path::new(path_str);
    
    // Create parent directory
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }

    let mut file = File::create(path).await?;
    file.write_all(content.as_bytes()).await?;
    file.flush().await?;

    Ok(format!("File written successfully: {}", path_str))
}

/// Edit a file by replacing a specific search string
pub async fn file_edit(path_str: &str, search: &str, replace: &str) -> QuasarResult<String> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err(QuasarError::tool(format!("File does not exist: {}", path_str)));
    }

    let mut file = File::open(path).await?;
    let mut content = String::new();
    file.read_to_string(&mut content).await?;

    if !content.contains(search) {
        return Err(QuasarError::tool("Search text not found in file"));
    }

    let new_content = content.replace(search, replace);
    
    let mut write_file = File::create(path).await?;
    write_file.write_all(new_content.as_bytes()).await?;
    write_file.flush().await?;

    Ok(format!("File edited successfully: {}", path_str))
}

/// List files and directories
pub async fn file_list(path_str: &str) -> QuasarResult<String> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err(QuasarError::tool(format!("Directory does not exist: {}", path_str)));
    }

    let mut entries = fs::read_dir(path).await?;
    let mut lines = Vec::new();

    let mut count = 0;
    while let Some(entry) = entries.next_entry().await? {
        count += 1;
        if count > 200 {
            lines.push("... (truncated, too many entries)".to_string());
            break;
        }

        let file_type = entry.file_type().await?;
        let file_name = entry.file_name().to_string_lossy().into_owned();

        if file_type.is_dir() {
            lines.push(format!("📁 {}/", file_name));
        } else {
            let metadata = entry.metadata().await?;
            let size = metadata.len();
            let size_str = if size < 1024 {
                format!("{}B", size)
            } else {
                format!("{:.1}KB", size as f64 / 1024.0)
            };
            lines.push(format!("📄 {} ({})", file_name, size_str));
        }
    }

    if lines.is_empty() {
        Ok("(empty directory)".to_string())
    } else {
        Ok(lines.join("\n"))
    }
}
