use crate::db;
use crate::models::CliAction;

/// Allowlist of setting keys the frontend may read/write. Must stay in sync
/// with `KEY_MAP` in `src/stores/settingsStore.ts`. Keeping this server-side
/// means a compromised renderer can't stuff arbitrary garbage into the
/// settings table.
const ALLOWED_KEYS: &[&str] = &[
    "terminal",
    "refresh_interval_sec",
    "default_repos_dir",
    "theme",
    "bulk_concurrency",
    "auto_check_updates",
    "cli_actions",
    "sort_by",
    "dim_clean_rows",
    "push_mode",
    // auto-fetch (background scheduled fetch+FF-pull). The scheduler
    // lives in commands::auto_fetch; these keys mirror the frontend
    // KEY_MAP entries in settingsStore.ts. `auto_fetch_last_run_at` is
    // written by the scheduler itself, but we keep it in the allowlist
    // so the frontend can read it back and render "last run Xm ago".
    "auto_fetch_enabled",
    "auto_fetch_interval_sec",
    "auto_fetch_anchor_dow",
    "auto_fetch_anchor_hour",
    "auto_fetch_anchor_minute",
    "auto_fetch_last_run_at",
];

fn ensure_allowed(key: &str) -> Result<(), String> {
    if ALLOWED_KEYS.contains(&key) {
        Ok(())
    } else {
        Err(format!("refused: unknown setting key '{key}'"))
    }
}

/// Whitelist of chars allowed in a slash_command beyond the leading `/`.
/// Keeps the value safe to interpolate into shell commandlines built by
/// `system::launch_terminal_with_command` (which shells out to
/// `bash -c`, `cmd /k`, etc.). Shell metacharacters (`" ' $ ; & | < > ( )
/// { } \ \n \r \t backtick *`) are blocked.
fn slash_command_char_ok(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.' | ',' | ':' | ' ' | '=' | '+' | '@')
}

/// Allowlist of model aliases a CliAction may carry. Passed through as
/// `claude --model <alias>`; keeping it to short aliases means the user
/// doesn't have to chase model-ID churn, and the backend knows the
/// composed command is safe to interpolate (no quoting needed).
pub const ALLOWED_MODELS: &[&str] = &["haiku", "sonnet", "opus"];

/// Server-side validation for the `cli_actions` setting. Runs before the
/// value lands in SQLite so invariant #12 holds even if the renderer is
/// compromised: only well-shaped actions with safe slash commands can be
/// persisted, so the launcher can interpolate them without escaping.
pub fn validate_cli_actions(value: &str) -> Result<(), String> {
    let actions: Vec<CliAction> = serde_json::from_str(value)
        .map_err(|e| format!("cli_actions must be a JSON array of CliAction: {e}"))?;
    if actions.len() > 10 {
        return Err("cli_actions: at most 10 actions allowed".to_string());
    }
    let mut seen_ids = std::collections::HashSet::new();
    for (idx, a) in actions.iter().enumerate() {
        // id: short slug, one of the few stable identifiers we'll use in
        // invoke args, so keep it conservative.
        if a.id.is_empty() || a.id.len() > 32 {
            return Err(format!("cli_actions[{idx}].id must be 1..32 chars"));
        }
        if !a.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
            return Err(format!(
                "cli_actions[{idx}].id may only contain letters, digits, '_' or '-'"
            ));
        }
        if !seen_ids.insert(a.id.clone()) {
            return Err(format!("cli_actions[{idx}].id '{}' is a duplicate", a.id));
        }
        if a.label.is_empty() || a.label.chars().count() > 64 {
            return Err(format!("cli_actions[{idx}].label must be 1..64 chars"));
        }
        if a.label.chars().any(|c| (c as u32) < 0x20) {
            return Err(format!(
                "cli_actions[{idx}].label must not contain control characters"
            ));
        }
        if !a.slash_command.starts_with('/') {
            return Err(format!(
                "cli_actions[{idx}].slashCommand must start with '/' (got {:?})",
                a.slash_command
            ));
        }
        if a.slash_command.chars().count() < 2 || a.slash_command.chars().count() > 128 {
            return Err(format!(
                "cli_actions[{idx}].slashCommand must be 2..128 chars"
            ));
        }
        for c in a.slash_command.chars() {
            if !slash_command_char_ok(c) {
                return Err(format!(
                    "cli_actions[{idx}].slashCommand contains disallowed character {c:?}. \
                     Only letters, digits, / - _ . , : space = + @ are allowed."
                ));
            }
        }
        if let Some(model) = &a.model {
            if !ALLOWED_MODELS.contains(&model.as_str()) {
                return Err(format!(
                    "cli_actions[{idx}].model {model:?} is not allowed. \
                     Allowed values: {}.",
                    ALLOWED_MODELS.join(", ")
                ));
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_setting(key: String) -> Result<Option<String>, String> {
    ensure_allowed(&key)?;
    db::with_conn(|c| crate::db::queries::get_setting(c, &key))
}

#[tauri::command]
pub async fn set_setting(key: String, value: String) -> Result<(), String> {
    ensure_allowed(&key)?;
    if key == "cli_actions" {
        validate_cli_actions(&value)?;
    }
    db::with_conn(|c| crate::db::queries::set_setting(c, &key, &value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_empty_array() {
        assert!(validate_cli_actions("[]").is_ok());
    }

    #[test]
    fn accepts_default_ship_entry() {
        let v = r#"[{"id":"ship","label":"Ship","slashCommand":"/ship"}]"#;
        assert!(validate_cli_actions(v).is_ok());
    }

    #[test]
    fn accepts_slash_command_with_args() {
        let v = r#"[{"id":"task","label":"Start task","slashCommand":"/task start NOR-123"}]"#;
        assert!(validate_cli_actions(v).is_ok());
    }

    #[test]
    fn rejects_missing_leading_slash() {
        let v = r#"[{"id":"ship","label":"Ship","slashCommand":"ship"}]"#;
        assert!(validate_cli_actions(v).is_err());
    }

    #[test]
    fn rejects_shell_metacharacters() {
        for bad in [
            r#"[{"id":"x","label":"x","slashCommand":"/ship; rm -rf *"}]"#,
            r#"[{"id":"x","label":"x","slashCommand":"/ship && pwsh"}]"#,
            r#"[{"id":"x","label":"x","slashCommand":"/ship | cat"}]"#,
            r#"[{"id":"x","label":"x","slashCommand":"/ship \"quoted\""}]"#,
            r#"[{"id":"x","label":"x","slashCommand":"/ship $HOME"}]"#,
            r#"[{"id":"x","label":"x","slashCommand":"/ship `cmd`"}]"#,
        ] {
            assert!(
                validate_cli_actions(bad).is_err(),
                "should reject: {bad}"
            );
        }
    }

    #[test]
    fn rejects_duplicate_ids() {
        let v = r#"[{"id":"a","label":"A","slashCommand":"/a"},{"id":"a","label":"A2","slashCommand":"/b"}]"#;
        assert!(validate_cli_actions(v).is_err());
    }

    #[test]
    fn rejects_bad_id_chars() {
        let v = r#"[{"id":"has space","label":"X","slashCommand":"/x"}]"#;
        assert!(validate_cli_actions(v).is_err());
    }

    #[test]
    fn rejects_over_ten_actions() {
        let mut items = Vec::new();
        for i in 0..11 {
            items.push(format!(r#"{{"id":"a{i}","label":"L","slashCommand":"/x"}}"#));
        }
        let v = format!("[{}]", items.join(","));
        assert!(validate_cli_actions(&v).is_err());
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(validate_cli_actions("{not json}").is_err());
        assert!(validate_cli_actions(r#"{"id":"x"}"#).is_err()); // object, not array
    }

    #[test]
    fn accepts_entry_without_model() {
        let v = r#"[{"id":"ship","label":"Ship","slashCommand":"/ship"}]"#;
        assert!(validate_cli_actions(v).is_ok());
    }

    #[test]
    fn accepts_allowed_models() {
        for m in ["haiku", "sonnet", "opus"] {
            let v = format!(
                r#"[{{"id":"ship","label":"Ship","slashCommand":"/ship","model":"{m}"}}]"#
            );
            assert!(validate_cli_actions(&v).is_ok(), "should accept model={m}");
        }
    }

    #[test]
    fn rejects_unknown_model() {
        for bad in ["gpt-4", "claude-opus-4-7", "HAIKU", "", "haiku-latest"] {
            let v = format!(
                r#"[{{"id":"ship","label":"Ship","slashCommand":"/ship","model":"{bad}"}}]"#
            );
            assert!(
                validate_cli_actions(&v).is_err(),
                "should reject model={bad:?}"
            );
        }
    }
}
