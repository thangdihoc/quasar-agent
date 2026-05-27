use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};
use parking_lot::RwLock;
use tokio::time::sleep;
use crate::{QuasarError, QuasarResult};

#[derive(Debug, Clone)]
pub struct RetryOptions {
    pub max_retries: usize,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
}

impl Default for RetryOptions {
    fn default() -> Self {
        Self {
            max_retries: 3,
            base_delay_ms: 1000,
            max_delay_ms: 30_000,
        }
    }
}

pub async fn with_retry<F, Fut, T>(mut f: F, options: RetryOptions) -> QuasarResult<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = QuasarResult<T>>,
{
    let mut attempt = 0;
    loop {
        match f().await {
            Ok(result) => return Ok(result),
            Err(e) => {
                attempt += 1;
                if attempt > options.max_retries {
                    return Err(e);
                }
                let delay = std::cmp::min(
                    options.base_delay_ms * 2_u64.pow(attempt as u32 - 1),
                    options.max_delay_ms,
                );
                tracing::warn!("Retry attempt {}/{} after {}ms: {:?}", attempt, options.max_retries, delay, e);
                sleep(Duration::from_millis(delay)).await;
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

pub struct CircuitBreaker {
    name: String,
    state: Arc<RwLock<CircuitState>>,
    failure_count: Arc<RwLock<usize>>,
    last_failure_time: Arc<RwLock<Option<Instant>>>,
    failure_threshold: usize,
    reset_timeout: Duration,
}

impl Clone for CircuitBreaker {
    fn clone(&self) -> Self {
        Self {
            name: self.name.clone(),
            state: Arc::clone(&self.state),
            failure_count: Arc::clone(&self.failure_count),
            last_failure_time: Arc::clone(&self.last_failure_time),
            failure_threshold: self.failure_threshold,
            reset_timeout: self.reset_timeout,
        }
    }
}

impl CircuitBreaker {
    pub fn new(name: impl Into<String>, failure_threshold: usize, reset_timeout: Duration) -> Self {
        Self {
            name: name.into(),
            state: Arc::new(RwLock::new(CircuitState::Closed)),
            failure_count: Arc::new(RwLock::new(0)),
            last_failure_time: Arc::new(RwLock::new(None)),
            failure_threshold,
            reset_timeout,
        }
    }

    pub fn state(&self) -> CircuitState {
        *self.state.read()
    }

    pub fn check_state(&self) {
        let mut state = self.state.write();
        if *state == CircuitState::Open {
            if let Some(last_failure) = *self.last_failure_time.read() {
                if last_failure.elapsed() >= self.reset_timeout {
                    tracing::info!("Circuit breaker '{}' transitioning to HalfOpen", self.name);
                    *state = CircuitState::HalfOpen;
                    *self.failure_count.write() = 0;
                }
            }
        }
    }

    pub async fn execute<F, Fut, T>(&self, f: F) -> QuasarResult<T>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = QuasarResult<T>>,
    {
        self.check_state();

        let state = self.state();
        if state == CircuitState::Open {
            return Err(QuasarError::provider(format!(
                "Circuit breaker '{}' is OPEN",
                self.name
            )));
        }

        match f().await {
            Ok(result) => {
                if state == CircuitState::HalfOpen {
                    tracing::info!("Circuit breaker '{}' transitioning to Closed", self.name);
                    *self.state.write() = CircuitState::Closed;
                }
                *self.failure_count.write() = 0;
                Ok(result)
            }
            Err(e) => {
                let mut count = self.failure_count.write();
                *count += 1;
                *self.last_failure_time.write() = Some(Instant::now());

                if *count >= self.failure_threshold {
                    tracing::error!("Circuit breaker '{}' transitioning to OPEN after {} failures", self.name, count);
                    *self.state.write() = CircuitState::Open;
                }

                Err(e)
            }
        }
    }
}
