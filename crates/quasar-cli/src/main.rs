use clap::{Parser, Subcommand};
use quasar_core::errors::QuasarResult;

#[derive(Parser)]
#[command(name = "quasar")]
#[command(about = "Rust-first AI Agent CLI", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the agent
    Start {
        #[arg(short, long, default_value = "quasar.toml")]
        config: String,
    },
    /// Setup initial config
    Setup,
    /// Change default model
    Model {
        name: Option<String>,
    },
    /// Check version
    Version,
}

#[tokio::main]
async fn main() -> QuasarResult<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Start { config: _ } => {
            println!("🚀 Starting Quasar agent...");
            println!("Agent ready. Type your query or /quit to exit.");
        }
        Commands::Setup => {
            println!("✅ Setup mode");
            println!("Please configure quasar.toml with your API keys.");
        }
        Commands::Model { name } => {
            if let Some(n) = name {
                println!("✅ Model changed to: {}", n);
            } else {
                println!("Current model: gpt-4o");
            }
        }
        Commands::Version => println!("quasar v0.3.0"),
    }

    Ok(())
}
