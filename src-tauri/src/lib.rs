mod commands;
mod db;
mod git;
mod models;
mod tray;
mod util;

use commands::{
    activity, auto_fetch, branch, cli_actions, git_ops, repos, scan, settings, stash, status,
    system, workspaces,
};
use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

/// CLI flag passed by the autostart launcher so the app boots straight to
/// the tray instead of popping the main window in the user's face on every
/// login. The autostart plugin appends this to the launch command we
/// register with the OS (Run-key on Windows, LaunchAgent on macOS,
/// .desktop file on Linux).
const ARG_MINIMIZED: &str = "--minimized";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(e) = db::init() {
        eprintln!("[repo-dashboard] fatal: failed to init db: {e}");
        std::process::exit(1);
    }

    let started_minimized = std::env::args().any(|a| a == ARG_MINIMIZED);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![ARG_MINIMIZED]),
        ))
        .setup(move |app| {
            tray::build(app.handle())?;
            auto_fetch::spawn_scheduler(app.handle().clone());
            if started_minimized {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| tray::on_window_event(window, event))
        .invoke_handler(tauri::generate_handler![
            // repos
            repos::list_repos,
            repos::add_repo,
            repos::remove_repo,
            repos::rename_repo,
            repos::reorder_repos,
            repos::set_repo_push_mode,
            repos::get_push_mode_info,
            // status
            status::get_repo_status,
            status::get_all_statuses,
            status::refresh_all_statuses,
            status::get_repo_log,
            status::get_changed_files,
            // git ops
            git_ops::git_fetch,
            git_ops::git_pull_ff,
            git_ops::git_force_pull,
            git_ops::git_commit_push,
            git_ops::git_fetch_all,
            git_ops::git_pull_all_safe,
            git_ops::undo_last_action,
            git_ops::undo_action_group,
            git_ops::get_action_log,
            git_ops::list_recent_action_groups,
            git_ops::force_pull_preview,
            git_ops::diagnose_auth,
            git_ops::sign_in_remote,
            git_ops::git_setup_status,
            git_ops::configure_credential_helper,
            // system
            system::open_folder,
            system::open_terminal,
            system::open_remote,
            system::open_commit,
            system::open_url,
            system::set_tray_tooltip,
            // settings
            settings::get_setting,
            settings::set_setting,
            // auto-fetch
            auto_fetch::auto_fetch_run_once,
            // cli actions (Claude Code launcher)
            cli_actions::run_cli_action,
            cli_actions::list_cli_actions,
            // scan / ignore
            scan::scan_folder,
            scan::add_scanned_repos,
            scan::list_ignored_paths,
            scan::ignore_path,
            scan::unignore_path,
            // activity feed
            activity::get_activity_feed,
            // branch
            branch::git_list_branches,
            branch::git_checkout,
            branch::git_create_branch,
            // workspaces
            workspaces::list_workspaces,
            workspaces::get_workspace,
            workspaces::create_workspace,
            workspaces::rename_workspace,
            workspaces::delete_workspace,
            workspaces::update_workspace_entries,
            workspaces::get_active_workspace_id,
            workspaces::set_active_workspace_id,
            workspaces::activate_workspace,
            // stash bundles (Phase 2.3)
            stash::list_stash_bundles,
            stash::get_stash_bundle,
            stash::create_stash_bundle,
            stash::restore_stash_bundle,
            stash::delete_stash_bundle,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
