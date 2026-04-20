mod commands;
mod db;
mod git;
mod models;
mod tray;
mod util;

use commands::{
    activity, branch, cli_actions, git_ops, repos, scan, settings, stash, status, system,
    workspaces,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(e) = db::init() {
        eprintln!("[repo-dashboard] fatal: failed to init db: {e}");
        std::process::exit(1);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            tray::build(app.handle())?;
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
            system::set_tray_tooltip,
            // settings
            settings::get_setting,
            settings::set_setting,
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
