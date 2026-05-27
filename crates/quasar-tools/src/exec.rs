use quasar_core::{QuasarResult, QuasarError};
use std::process::Stdio;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

/// Execute a command in the system shell (PowerShell on Windows, Bash on macOS/Linux)
pub async fn exec_command(command: &str, timeout_ms: Option<u64>) -> QuasarResult<String> {
    let timeout_duration = Duration::from_millis(timeout_ms.unwrap_or(30_000));

    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("powershell.exe");
        c.arg("-NoProfile")
         .arg("-NonInteractive")
         .arg("-Command")
         .arg(command);
        c
    } else {
        let mut c = Command::new("bash");
        c.arg("-c")
         .arg(command);
        c
    };

    cmd.stdout(Stdio::piped())
       .stderr(Stdio::piped());

    // Spawn the child process
    let child = cmd.spawn()?;

    // Wait for the child process with a timeout
    let wait_result = timeout(timeout_duration, child.wait_with_output()).await;

    match wait_result {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            
            let status_code = output.status.code().unwrap_or(-1);
            let combined = if stdout.is_empty() {
                stderr
            } else if stderr.is_empty() {
                stdout
            } else {
                format!("{}\n{}", stdout, stderr)
            };

            let truncated = if combined.len() > 10_000 {
                format!("{}\n... (truncated)", &combined[..10_000])
            } else {
                combined
            };

            Ok(format!("Exit code: {}\n{}", status_code, truncated))
        }
        Ok(Err(e)) => Err(QuasarError::tool(format!("Failed to execute command: {}", e))),
        Err(_) => {
            Err(QuasarError::tool("Command execution timed out".to_string()))
        }
    }
}

/// Deprecated/Alias for backward compatibility
pub async fn exec_powershell(command: &str, timeout_ms: Option<u64>) -> QuasarResult<String> {
    exec_command(command, timeout_ms).await
}
