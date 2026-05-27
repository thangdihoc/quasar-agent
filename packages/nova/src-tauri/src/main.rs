// Nova Desktop Mascot — Tauri v2 Backend
// Transparent always-on-top window with WebSocket bridge to Quasar Agent

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentState {
    state: String,   // "idle" | "thinking" | "speaking" | "listening"
    detail: Option<String>,
}

// Tauri command: get current state
#[tauri::command]
fn get_state() -> AgentState {
    AgentState {
        state: "idle".to_string(),
        detail: None,
    }
}

// WebSocket listener task - connects to Quasar Agent and forwards state events
async fn ws_listener(app: AppHandle) {
    use futures_util::StreamExt;
    use tokio_tungstenite::connect_async;

    let ws_url = "ws://127.0.0.1:18789/nova";

    loop {
        match connect_async(ws_url).await {
            Ok((ws_stream, _)) => {
                println!("[Nova] Connected to Quasar Agent WebSocket");
                let (_, mut read) = ws_stream.split();

                while let Some(msg) = read.next().await {
                    match msg {
                        Ok(tungstenite_msg) => {
                            if let Ok(text) = tungstenite_msg.into_text() {
                                if let Ok(state) = serde_json::from_str::<AgentState>(&text) {
                                    println!("[Nova] State: {} {:?}", state.state, state.detail);
                                    let _ = app.emit("nova-state", state);
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("[Nova] WebSocket error: {}", e);
                            break;
                        }
                    }
                }
                println!("[Nova] Disconnected, reconnecting in 3s...");
            }
            Err(e) => {
                eprintln!("[Nova] Failed to connect: {}. Retrying in 3s...", e);
            }
        }

        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![get_state])
        .setup(|app| {
            let handle = app.handle().clone();

            // Spawn WebSocket listener in background
            tauri::async_runtime::spawn(async move {
                ws_listener(handle).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Nova");
}
