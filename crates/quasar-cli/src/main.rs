use clap::{Parser, Subcommand};
use quasar_core::{init_logger, LogLevel, QuasarConfig};
use quasar_agent::AgentLoop;
use std::path::PathBuf;

const BANNER: &str = r#"
  ██████╗ ██╗   ██╗ █████╗ ███████╗ █████╗ ██████╗
 ██╔═══██╗██║   ██║██╔══██╗██╔════╝██╔══██╗██╔══██╗
 ██║   ██║██║   ██║███████║███████║███████║██████╔╝
 ██║▄▄ ██║██║   ██║██╔══██║╚════██║██╔══██║██╔══██╗
 ╚██████╔╝╚██████╔╝██║  ██║███████║██║  ██║██║  ██║
  ╚══▀▀═╝  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝
   Personal AI Agent v0.3.0 (Rust Edition)
"#;

#[derive(Parser)]
#[command(name = "quasar")]
#[command(about = "Quasar AI Agent - Personal AI assistant", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Config file path
    #[arg(short, long, default_value = "quasar.toml")]
    config: PathBuf,

    /// Log level
    #[arg(short, long, default_value = "info")]
    log_level: String,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the agent
    Start,
    
    /// Setup configuration interactively
    Setup,
    
    /// Change model
    Model {
        /// Model name (e.g., gpt-4o, claude-3-5-sonnet)
        name: String,
    },
    
    /// Show version
    Version,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env
    dotenvy::dotenv().ok();

    let cli = Cli::parse();

    // Initialize logger
    let log_level = match cli.log_level.to_lowercase().as_str() {
        "trace" => LogLevel::Trace,
        "debug" => LogLevel::Debug,
        "info" => LogLevel::Info,
        "warn" => LogLevel::Warn,
        "error" => LogLevel::Error,
        _ => LogLevel::Info,
    };
    init_logger(log_level);

    match cli.command {
        Commands::Start => {
            println!("{}", BANNER);
            start_agent(cli.config).await?;
        }
        Commands::Setup => {
            setup_config(cli.config).await?;
        }
        Commands::Model { name } => {
            change_model(cli.config, name).await?;
        }
        Commands::Version => {
            println!("Quasar Agent v{}", env!("CARGO_PKG_VERSION"));
            println!("Rust Edition");
        }
    }

    Ok(())
}

async fn start_agent(config_path: PathBuf) -> anyhow::Result<()> {
    tracing::info!("Loading config from {:?}", config_path);

    // Load config
    let config = if config_path.exists() {
        quasar_core::config::load_config(&config_path).await?
    } else {
        tracing::warn!("Config file not found, using defaults");
        create_default_config()?
    };

    tracing::info!("Starting agent with model: {}", config.agent.model);

    // Create agent loop
    let agent = AgentLoop::new(config);

    // TODO: Register tools
    // TODO: Start Telegram bot
    // TODO: Start web server
    // TODO: Connect MCP servers

    tracing::info!("Agent started successfully");
    tracing::info!("Press Ctrl+C to stop");

    // Keep running
    tokio::signal::ctrl_c().await?;
    tracing::info!("Shutting down...");

    Ok(())
}

async fn setup_config(config_path: PathBuf) -> anyhow::Result<()> {
    println!("🚀 Quasar Agent Setup");
    println!();
    
    // TODO: Interactive setup
    println!("⚠️  Interactive setup not yet implemented in Rust version");
    println!("Please create {} manually or use the TypeScript version for setup", config_path.display());
    println!();
    println!("Example config:");
    println!("{}", include_str!("../../../examples/quasar.example.toml"));

    Ok(())
}

async fn change_model(config_path: PathBuf, model: String) -> anyhow::Result<()> {
    println!("Changing model to: {}", model);
    
    // TODO: Update config file
    println!("⚠️  Model change not yet implemented in Rust version");
    println!("Please edit {} manually", config_path.display());

    Ok(())
}

fn create_default_config() -> anyhow::Result<QuasarConfig> {
    // Create minimal default config
    let config = QuasarConfig {
        gateway: quasar_core::GatewayConfig::default(),
        agent: quasar_core::AgentConfig::default(),
        telegram: quasar_core::TelegramConfig {
            token: std::env::var("TELEGRAM_BOT_TOKEN").unwrap_or_default(),
            allowed_users: Vec::new(),
        },
        providers: std::collections::HashMap::new(),
        tools: quasar_core::ToolsConfig::default(),
        memory: quasar_core::MemoryConfig::default(),
        mcp: None,
        computer_use: quasar_core::ComputerUseConfig::default(),
        web: quasar_core::WebConfig { api_key: None },
    };

    Ok(config)
}
