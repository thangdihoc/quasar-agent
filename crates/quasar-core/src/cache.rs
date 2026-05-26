use dashmap::DashMap;
use std::hash::Hash;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Clone)]
struct CacheEntry<V> {
    value: V,
    expires_at: Instant,
}

pub struct TtlCache<K, V> {
    map: Arc<DashMap<K, CacheEntry<V>>>,
    ttl: Duration,
}

impl<K, V> TtlCache<K, V>
where
    K: Eq + Hash + Clone,
    V: Clone,
{
    pub fn new(ttl: Duration) -> Self {
        Self {
            map: Arc::new(DashMap::new()),
            ttl,
        }
    }

    pub fn insert(&self, key: K, value: V) {
        let entry = CacheEntry {
            value,
            expires_at: Instant::now() + self.ttl,
        };
        self.map.insert(key, entry);
    }

    pub fn get(&self, key: &K) -> Option<V> {
        self.map.get(key).and_then(|entry| {
            if entry.expires_at > Instant::now() {
                Some(entry.value.clone())
            } else {
                drop(entry);
                self.map.remove(key);
                None
            }
        })
    }

    pub fn remove(&self, key: &K) -> Option<V> {
        self.map.remove(key).map(|(_, entry)| entry.value)
    }

    pub fn clear(&self) {
        self.map.clear();
    }

    pub fn cleanup_expired(&self) {
        let now = Instant::now();
        self.map.retain(|_, entry| entry.expires_at > now);
    }
}

impl<K, V> Clone for TtlCache<K, V> {
    fn clone(&self) -> Self {
        Self {
            map: Arc::clone(&self.map),
            ttl: self.ttl,
        }
    }
}

// Tool cache for caching tool results
pub type ToolCache = TtlCache<String, String>;

pub fn tool_cache_key(tool_name: &str, args: &serde_json::Value) -> String {
    format!("{}:{}", tool_name, serde_json::to_string(args).unwrap_or_default())
}
