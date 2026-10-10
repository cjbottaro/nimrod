//! Persisted single-keystroke grammar. Action defaults and dispatch remain frontend-owned.
use serde_json::Value;

fn shortcut(binding: &str) -> bool {
    if binding.len() > 80
        || binding != binding.to_lowercase()
        || binding.chars().any(char::is_control)
    {
        return false;
    }
    let parts: Vec<_> = binding.split('+').collect();
    let Some(key) = parts.last().copied() else {
        return false;
    };
    let modifiers = &parts[..parts.len() - 1];
    let order = ["primary", "cmd", "ctrl", "alt", "shift"];
    let expected: Vec<_> = order
        .iter()
        .copied()
        .filter(|modifier| modifiers.contains(modifier))
        .collect();
    if modifiers != expected
        || (modifiers.contains(&"primary")
            && (modifiers.contains(&"cmd") || modifiers.contains(&"ctrl")))
    {
        return false;
    }
    let function = key
        .strip_prefix('f')
        .and_then(|n| n.parse::<u8>().ok().map(|number| (n, number)))
        .is_some_and(|(n, number)| (1..=24).contains(&number) && n == number.to_string());
    let named = [
        "backspace",
        "delete",
        "enter",
        "tab",
        "space",
        "escape",
        "arrowup",
        "arrowdown",
        "arrowleft",
        "arrowright",
        "home",
        "end",
        "pageup",
        "pagedown",
        "plus",
        "-",
    ];
    let character = key.encode_utf16().count() == 1 && !key.chars().any(char::is_whitespace);
    (character || named.contains(&key) || function)
        && (function
            || modifiers
                .iter()
                .any(|m| ["primary", "cmd", "ctrl"].contains(m)))
        && key != "="
        && !(key == "plus" && modifiers.contains(&"shift"))
        && !["q", "h", "a", "c", "v", "x", "z", "tab"].contains(&key)
        && (key != "o" || modifiers.contains(&"shift"))
}

pub fn validate(value: &Value) -> Result<(), String> {
    let actions = value.as_object().ok_or("keybindings must be an object")?;
    if actions.len() > 256 {
        return Err("Too many keybinding actions".into());
    }
    for (action, shortcuts) in actions {
        if action.is_empty()
            || action.len() > 80
            || !action.starts_with(|c: char| c.is_ascii_lowercase())
            || !action
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        {
            return Err("Invalid keybinding action ID".into());
        }
        let shortcuts = shortcuts
            .as_array()
            .ok_or("Keybindings must be shortcut arrays")?;
        if shortcuts.len() > 8 {
            return Err("Too many shortcuts for an action".into());
        }
        let mut seen = std::collections::HashSet::new();
        for binding in shortcuts {
            let binding = binding.as_str().ok_or("Shortcuts must be strings")?;
            if !shortcut(binding) || !seen.insert(binding) {
                return Err(format!("Invalid or duplicate shortcut for {action}"));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn overrides_accept_unbinding_and_preserve_future_actions() {
        validate(&serde_json::json!({ "new": [], "future-action": ["primary+shift+n"] })).unwrap();
        for key in [
            "primary+shift+o",
            "cmd+shift+o",
            "ctrl+shift+o",
            "primary+n",
            "primary+shift+n",
            "primary+backspace",
            "primary+m",
            "primary+e",
            "primary+shift+[",
            "primary+shift+]",
            "primary+plus",
            "primary+-",
            "primary+0",
            "f12",
        ] {
            assert!(shortcut(key), "{key}");
        }
    }
    #[test]
    fn rejects_malformed_reserved_and_duplicate_shortcuts() {
        for key in [
            "n",
            "alt+n",
            "primary+o",
            "cmd+o",
            "ctrl+o",
            "primary+q",
            "primary+v",
            "primary+=",
            "primary+shift+plus",
            "primary+cmd+n",
            "shift+primary+n",
            "primary+primary+n",
            "primary+N",
            "primary+",
            "f25",
            "f01",
        ] {
            assert!(!shortcut(key), "{key}");
        }
        for value in [
            serde_json::json!(null),
            serde_json::json!([]),
            serde_json::json!({ "new": "primary+n" }),
            serde_json::json!({ "new": ["primary+n", "primary+n"] }),
            serde_json::json!({ "bad_id": [] }),
        ] {
            assert!(validate(&value).is_err());
        }
    }
}
