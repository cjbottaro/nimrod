//! Strategy-independent bounded usage history. Native mutation order defines MRU
//! across project windows; timestamps/counts remain available to future rankers.
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const KEY: &str = "nimrod.command-usage.v1";
const LIMIT: usize = 50;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: String,
    last_used_at: u64,
    use_count: u64,
}

pub fn record(state: &mut Map<String, Value>, id: &str, now: u64) -> Result<(), String> {
    if id.is_empty() || id.chars().count() > 256 {
        return Err("Invalid command ID".into());
    }
    let mut entries: Vec<Entry> = state
        .get(KEY)
        .filter(|history| history.get("version") == Some(&Value::from(1)))
        .and_then(|history| history.get("entries"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| serde_json::from_value::<Entry>(value.clone()).ok())
        .filter(|entry| {
            !entry.id.is_empty()
                && entry.id.chars().count() <= 256
                && entry.last_used_at <= MAX_SAFE_INTEGER
                && entry.use_count > 0
                && entry.use_count <= MAX_SAFE_INTEGER
        })
        .collect();
    let count = entries
        .iter()
        .find(|entry| entry.id == id)
        .map_or(1, |entry| {
            entry.use_count.saturating_add(1).min(MAX_SAFE_INTEGER)
        });
    entries.retain(|entry| entry.id != id);
    entries.insert(
        0,
        Entry {
            id: id.into(),
            last_used_at: now.min(MAX_SAFE_INTEGER),
            use_count: count,
        },
    );
    let mut seen = std::collections::HashSet::new();
    entries.retain(|entry| seen.insert(entry.id.clone()));
    entries.truncate(LIMIT);
    state.insert(
        KEY.into(),
        serde_json::json!({ "version": 1, "entries": entries }),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recency_is_mutation_order_not_frequency_or_clock_order() {
        let mut state = Map::new();
        record(&mut state, "a", 100).unwrap();
        record(&mut state, "a", 100).unwrap();
        record(&mut state, "b", 50).unwrap();
        assert_eq!(state[KEY]["entries"][0]["id"], "b");
        assert_eq!(state[KEY]["entries"][1]["useCount"], 2);
        record(&mut state, "a", 50).unwrap();
        assert_eq!(state[KEY]["entries"][0]["id"], "a");
        assert_eq!(state[KEY]["entries"][0]["useCount"], 3);
        assert_eq!(state[KEY]["entries"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn bounded_history_recovers_invalid_entries_and_preserves_unrelated_state() {
        let mut state = Map::new();
        state.insert("other".into(), Value::from(true));
        state.insert(
            KEY.into(),
            serde_json::json!({ "version": 1, "entries": [null, {"id": "bad"}] }),
        );
        for n in 0..60 {
            record(&mut state, &n.to_string(), n).unwrap();
        }
        assert_eq!(state[KEY]["entries"].as_array().unwrap().len(), LIMIT);
        assert_eq!(state[KEY]["entries"][0]["id"], "59");
        assert_eq!(state["other"], true);
        assert!(record(&mut state, "", 0).is_err());
    }
}
