use crate::commands::{settings, system};
use crate::db;
use crate::models::CliAction;

/// Launch Claude Code against a repo with a pre-filled slash command.
///
/// The action's slash command has been server-side validated (see
/// `settings::validate_cli_actions`) to contain only whitelisted
/// characters — no shell metacharacters reach the terminal launcher, so
/// the composed `claude "<slash>"` command is safe to interpolate.
#[tauri::command]
pub async fn run_cli_action(id: i64, action_id: String) -> Result<(), String> {
    let actions = load_cli_actions()?;
    let action = actions
        .into_iter()
        .find(|a| a.id == action_id)
        .ok_or_else(|| format!("action '{action_id}' is not configured"))?;

    // `slash_command` is whitelisted server-side (no quotes, backticks, `$`,
    // `;`, `&`, `|`, newlines, etc.). Wrapping in double quotes groups any
    // embedded spaces (e.g. `/task start NOR-123`) into a single argv entry
    // for `claude`.
    let command_line = format!("claude \"{}\"", action.slash_command);
    system::launch_terminal_in_repo_with_command(id, &command_line).await
}

/// Expose the saved cli_actions to the frontend as typed structs rather
/// than a raw JSON string. Lets the popover menu render without the
/// frontend having to re-parse the setting every render.
#[tauri::command]
pub async fn list_cli_actions() -> Result<Vec<CliAction>, String> {
    load_cli_actions()
}

fn load_cli_actions() -> Result<Vec<CliAction>, String> {
    let raw = db::with_conn(|c| crate::db::queries::get_setting(c, "cli_actions"))?;
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    // Re-validate on read: guards against out-of-band edits to the DB.
    settings::validate_cli_actions(&raw)?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}
