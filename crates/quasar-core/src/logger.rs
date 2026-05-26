use tracing::{Level, Subscriber};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[derive(Debug, Clone, Copy)]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

impl From<LogLevel> for Level {
    fn from(level: LogLevel) -> Self {
        match level {
            LogLevel::Trace => Level::TRACE,
            LogLevel::Debug => Level::DEBUG,
            LogLevel::Info => Level::INFO,
            LogLevel::Warn => Level::WARN,
            LogLevel::Error => Level::ERROR,
        }
    }
}

pub fn init_logger(level: LogLevel) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(format!("{}", Into::<Level>::into(level))));

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_target(true).with_thread_ids(true))
        .init();
}

#[macro_export]
macro_rules! trace {
    ($($arg:tt)*) => {
        tracing::trace!($($arg)*)
    };
}

#[macro_export]
macro_rules! debug {
    ($($arg:tt)*) => {
        tracing::debug!($($arg)*)
    };
}

#[macro_export]
macro_rules! info {
    ($($arg:tt)*) => {
        tracing::info!($($arg)*)
    };
}

#[macro_export]
macro_rules! warn {
    ($($arg:tt)*) => {
        tracing::warn!($($arg)*)
    };
}

#[macro_export]
macro_rules! error {
    ($($arg:tt)*) => {
        tracing::error!($($arg)*)
    };
}
