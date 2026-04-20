use crate::db;
use crate::git::remote;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn spawn_detached(mut cmd: Command) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn spawn_visible(mut cmd: Command) -> Result<(), String> {
    // Terminals NEED a window; don't apply CREATE_NO_WINDOW.
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

async fn load_path(id: i64) -> Result<PathBuf, String> {
    let repo = db::with_conn(|c| crate::db::queries::find_repo(c, id))?;
    Ok(PathBuf::from(repo.path))
}

#[tauri::command]
pub async fn open_folder(id: i64) -> Result<(), String> {
    let path = load_path(id).await?;
    if !path.exists() {
        return Err(format!("path missing: {}", path.display()));
    }
    #[cfg(windows)]
    {
        let mut cmd = Command::new("explorer");
        cmd.arg(path);
        return spawn_detached(cmd);
    }
    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        cmd.arg(path);
        return spawn_detached(cmd);
    }
    #[cfg(target_os = "linux")]
    {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(path);
        return spawn_detached(cmd);
    }
    #[allow(unreachable_code)]
    Err("unsupported platform".to_string())
}

#[tauri::command]
pub async fn open_terminal(id: i64) -> Result<(), String> {
    let path = load_path(id).await?;
    if !path.exists() {
        return Err(format!("path missing: {}", path.display()));
    }
    let pref = terminal_pref();
    launch_terminal(&pref, &path, None)
}

/// Launch the user's preferred terminal in `path`, with `command` as the
/// initial command to execute. The shell is kept open after `command`
/// exits so users can read output, retry, or keep using the terminal.
/// Called by `cli_actions::run_cli_action` — not a Tauri command directly.
///
/// SAFETY: `command` is interpolated into shell commandlines. Callers MUST
/// have already sanitized the input. `commands::settings::validate_cli_actions`
/// is the canonical validator for the current caller — it strips shell
/// metacharacters before the value is persisted.
pub async fn launch_terminal_in_repo_with_command(
    id: i64,
    command: &str,
) -> Result<(), String> {
    let path = load_path(id).await?;
    if !path.exists() {
        return Err(format!("path missing: {}", path.display()));
    }
    let pref = terminal_pref();
    launch_terminal(&pref, &path, Some(command))
}

fn terminal_pref() -> String {
    db::with_conn(|c| crate::db::queries::get_setting(c, "terminal"))
        .ok()
        .flatten()
        .unwrap_or_else(|| "auto".to_string())
}

#[cfg(windows)]
fn launch_terminal(pref: &str, path: &Path, run: Option<&str>) -> Result<(), String> {
    let path_str = path
        .to_str()
        .ok_or_else(|| "path contains non-utf8 characters".to_string())?;

    match pref {
        "wt" => launch_wt(path_str, run),
        "git-bash" => launch_git_bash(path, run),
        "cmd" => launch_cmd(path_str, run),
        _ => {
            // auto — try in order
            if which("wt.exe") {
                if launch_wt(path_str, run).is_ok() {
                    return Ok(());
                }
            }
            let git_bash = PathBuf::from(r"C:\Program Files\Git\git-bash.exe");
            if git_bash.exists() {
                if launch_git_bash_at(&git_bash, path, run).is_ok() {
                    return Ok(());
                }
            }
            launch_cmd(path_str, run)
        }
    }
}

#[cfg(windows)]
fn which(name: &str) -> bool {
    let path = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path) {
        if dir.join(name).exists() {
            return true;
        }
    }
    false
}

#[cfg(windows)]
fn launch_wt(path: &str, run: Option<&str>) -> Result<(), String> {
    let mut cmd = Command::new("wt.exe");
    cmd.arg("-d").arg(path);
    if let Some(r) = run {
        // After -d, wt treats the rest of argv as the commandline to run.
        // Route through `cmd /k` so the shell stays open after the user's
        // command exits. `run` is validated by the caller to contain no
        // shell metacharacters, but wt itself consumes `;` as a new-tab
        // separator; the caller's whitelist disallows `;` so we're safe.
        cmd.args(["cmd", "/k", r]);
    }
    spawn_visible(cmd)
}

#[cfg(windows)]
fn launch_git_bash(path: &Path, run: Option<&str>) -> Result<(), String> {
    let default = std::path::PathBuf::from(r"C:\Program Files\Git\git-bash.exe");
    launch_git_bash_at(&default, path, run)
}

#[cfg(windows)]
fn launch_git_bash_at(exe: &Path, path: &Path, run: Option<&str>) -> Result<(), String> {
    if !exe.exists() {
        return Err(format!("{} not found", exe.display()));
    }
    let mut cmd = Command::new(exe);
    cmd.arg(format!("--cd={}", path.display()));
    if let Some(r) = run {
        // `exec bash` keeps the interactive shell after the user's command
        // exits (so they can read output / retry).
        cmd.args(["-c", &format!("{r}; exec bash")]);
    }
    spawn_visible(cmd)
}

#[cfg(windows)]
fn launch_cmd(path: &str, run: Option<&str>) -> Result<(), String> {
    // `cmd /K "cd /d \"<path>\""` composes a command-line string, so it's
    // exposed to cmd.exe's parsing quirks — `%VAR%` expansion, `^` escaping,
    // `!` delayed expansion. Windows filesystem rules forbid `"` in paths
    // so the quotes can't be broken, but any other meta-char in a directory
    // name would still be interpreted by cmd. Refuse rather than compose a
    // risky command line; caller can pick `wt` or `git-bash` which pass the
    // path as a proper argv entry.
    if path.contains(['%', '^', '!', '"']) {
        return Err(format!(
            "refused: path contains characters unsafe for cmd.exe ({path}). Use Windows Terminal or Git Bash instead."
        ));
    }
    let tail = match run {
        Some(r) => format!("cd /d \"{path}\" && {r}"),
        None => format!("cd /d \"{path}\""),
    };
    let mut cmd = Command::new("cmd");
    cmd.args(["/c", "start", "cmd", "/K", &tail]);
    spawn_visible(cmd)
}

#[cfg(target_os = "macos")]
fn launch_terminal(pref: &str, path: &Path, run: Option<&str>) -> Result<(), String> {
    let path_str = path
        .to_str()
        .ok_or_else(|| "path contains non-utf8 characters".to_string())?;

    match pref {
        "iterm2" => launch_macos_app("iTerm", path_str, run),
        "terminal" => launch_macos_app("Terminal", path_str, run),
        _ => {
            // auto — prefer iTerm when installed, otherwise Terminal.
            if std::path::Path::new("/Applications/iTerm.app").exists() {
                if launch_macos_app("iTerm", path_str, run).is_ok() {
                    return Ok(());
                }
            }
            launch_macos_app("Terminal", path_str, run)
        }
    }
}

#[cfg(target_os = "macos")]
fn launch_macos_app(app_name: &str, path: &str, run: Option<&str>) -> Result<(), String> {
    match run {
        None => {
            // `open -a <app> <path>` opens <path> in <app>. For Terminal/iTerm
            // this opens a new window with the working directory set to <path>.
            let mut cmd = Command::new("open");
            cmd.args(["-a", app_name, path]);
            spawn_visible(cmd)
        }
        Some(r) => {
            // AppleScript: `tell application "Terminal" to do script "cd ... && ..."`.
            // Single-quote the path and the command so AppleScript treats them
            // as a literal bash commandline. The caller has already validated
            // that `r` contains no single quotes or other shell metacharacters.
            let script = format!(
                "tell application \"{app}\" to do script \"cd '{path}' && {cmd}\"",
                app = app_name,
                path = path,
                cmd = r
            );
            let mut cmd = Command::new("osascript");
            cmd.args(["-e", &script]);
            spawn_visible(cmd)
        }
    }
}

#[cfg(target_os = "linux")]
fn launch_terminal(pref: &str, path: &Path, run: Option<&str>) -> Result<(), String> {
    let path_str = path
        .to_str()
        .ok_or_else(|| "path contains non-utf8 characters".to_string())?;

    match pref {
        "gnome-terminal" => launch_linux_terminal("gnome-terminal", path_str, run),
        "konsole" => launch_linux_terminal("konsole", path_str, run),
        "alacritty" => launch_linux_terminal("alacritty", path_str, run),
        "kitty" => launch_linux_terminal("kitty", path_str, run),
        "xterm" => launch_linux_terminal("xterm", path_str, run),
        _ => {
            // auto — walk a sensible preference order, skipping any that
            // aren't on PATH. `x-terminal-emulator` is the Debian/Ubuntu
            // alternatives-system default and is the last resort before
            // plain `xterm`.
            for candidate in [
                "gnome-terminal",
                "konsole",
                "alacritty",
                "kitty",
                "x-terminal-emulator",
                "xterm",
            ] {
                if which(candidate) {
                    if launch_linux_terminal(candidate, path_str, run).is_ok() {
                        return Ok(());
                    }
                }
            }
            Err("no terminal emulator found on PATH".to_string())
        }
    }
}

#[cfg(target_os = "linux")]
fn which(name: &str) -> bool {
    let path = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path) {
        if dir.join(name).exists() {
            return true;
        }
    }
    false
}

#[cfg(target_os = "linux")]
fn launch_linux_terminal(name: &str, path: &str, run: Option<&str>) -> Result<(), String> {
    let mut cmd = Command::new(name);
    // Different emulators spell "start here" differently:
    //   gnome-terminal / konsole / x-terminal-emulator / alacritty → --working-directory
    //   kitty → --directory
    //   xterm → no cwd flag, inherit from spawn's current_dir
    match name {
        "xterm" => {
            cmd.current_dir(path);
        }
        "kitty" => {
            cmd.args(["--directory", path]);
        }
        _ => {
            cmd.args(["--working-directory", path]);
        }
    }
    if let Some(r) = run {
        // Hand the command to bash via `-c`; `exec bash` keeps the shell
        // open after it exits. Caller has already sanitized `r`, so simple
        // interpolation is safe.
        let shell_line = format!("{r}; exec bash");
        // gnome-terminal splits args after `--`; every other emulator
        // here accepts `-e`.
        if name == "gnome-terminal" || name == "x-terminal-emulator" {
            cmd.args(["--", "bash", "-c", &shell_line]);
        } else {
            cmd.args(["-e", "bash", "-c", &shell_line]);
        }
    }
    spawn_visible(cmd)
}

fn ensure_http_https(url: &str) -> Result<(), String> {
    if url.starts_with("http://") || url.starts_with("https://") {
        Ok(())
    } else {
        Err(format!("refused: url is not http/https ({url})"))
    }
}

async fn open_url_via_opener(
    app: &tauri::AppHandle,
    url: &str,
) -> Result<(), String> {
    ensure_http_https(url)?;
    tauri_plugin_opener::OpenerExt::opener(app)
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Open an arbitrary http(s) URL in the user's default browser.
///
/// Used by the commit dialog's "Open PR" button — the URL itself is
/// computed backend-side (`compare_web_url`) and round-trips through
/// the frontend, but we still re-validate the scheme at the IPC
/// boundary (invariant #5). The tauri-plugin-opener capability is
/// already restricted to `http://**` / `https://**` in
/// `capabilities/default.json`, so this command sits behind two layers:
/// the capability gate AND the scheme check.
#[tauri::command]
pub async fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    open_url_via_opener(&app, &url).await
}

#[tauri::command]
pub async fn open_remote(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let path = load_path(id).await?;
    let origin = crate::git::remote::origin_url(&path)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no origin remote configured".to_string())?;
    let web = crate::git::remote::to_web_url(&origin)
        .ok_or_else(|| format!("cannot derive web url from: {origin}"))?;
    open_url_via_opener(&app, &web).await
}

#[tauri::command]
pub async fn set_tray_tooltip(
    app: tauri::AppHandle,
    text: String,
) -> Result<(), String> {
    crate::tray::set_tooltip(&app, &text)
}

#[tauri::command]
pub async fn open_commit(
    app: tauri::AppHandle,
    id: i64,
    sha: String,
) -> Result<(), String> {
    if sha.trim().is_empty() {
        return Err("sha is empty".into());
    }
    let path = load_path(id).await?;
    let origin = remote::origin_url(&path)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no origin remote configured".to_string())?;
    let url = remote::commit_web_url(&origin, sha.trim())
        .ok_or_else(|| format!("cannot derive commit url from: {origin}"))?;
    open_url_via_opener(&app, &url).await
}
