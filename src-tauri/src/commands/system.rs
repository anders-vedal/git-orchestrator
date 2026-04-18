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
    let pref = db::with_conn(|c| crate::db::queries::get_setting(c, "terminal"))
        .ok()
        .flatten()
        .unwrap_or_else(|| "auto".to_string());

    launch_terminal(&pref, &path)
}

#[cfg(windows)]
fn launch_terminal(pref: &str, path: &Path) -> Result<(), String> {
    use std::path::PathBuf;

    let path_str = path
        .to_str()
        .ok_or_else(|| "path contains non-utf8 characters".to_string())?;

    match pref {
        "wt" => launch_wt(path_str),
        "git-bash" => launch_git_bash(path),
        "cmd" => launch_cmd(path_str),
        _ => {
            // auto — try in order
            if which("wt.exe") {
                if launch_wt(path_str).is_ok() {
                    return Ok(());
                }
            }
            let git_bash = PathBuf::from(r"C:\Program Files\Git\git-bash.exe");
            if git_bash.exists() {
                if launch_git_bash_at(&git_bash, path).is_ok() {
                    return Ok(());
                }
            }
            launch_cmd(path_str)
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
fn launch_wt(path: &str) -> Result<(), String> {
    let mut cmd = Command::new("wt.exe");
    cmd.arg("-d").arg(path);
    spawn_visible(cmd)
}

#[cfg(windows)]
fn launch_git_bash(path: &Path) -> Result<(), String> {
    let default = std::path::PathBuf::from(r"C:\Program Files\Git\git-bash.exe");
    launch_git_bash_at(&default, path)
}

#[cfg(windows)]
fn launch_git_bash_at(exe: &Path, path: &Path) -> Result<(), String> {
    if !exe.exists() {
        return Err(format!("{} not found", exe.display()));
    }
    let mut cmd = Command::new(exe);
    cmd.arg(format!("--cd={}", path.display()));
    spawn_visible(cmd)
}

#[cfg(windows)]
fn launch_cmd(path: &str) -> Result<(), String> {
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
    let mut cmd = Command::new("cmd");
    cmd.args([
        "/c",
        "start",
        "cmd",
        "/K",
        &format!("cd /d \"{path}\""),
    ]);
    spawn_visible(cmd)
}

#[cfg(target_os = "macos")]
fn launch_terminal(pref: &str, path: &Path) -> Result<(), String> {
    let path_str = path
        .to_str()
        .ok_or_else(|| "path contains non-utf8 characters".to_string())?;

    match pref {
        "iterm2" => launch_macos_app("iTerm", path_str),
        "terminal" => launch_macos_app("Terminal", path_str),
        _ => {
            // auto — prefer iTerm when installed, otherwise Terminal.
            if std::path::Path::new("/Applications/iTerm.app").exists() {
                if launch_macos_app("iTerm", path_str).is_ok() {
                    return Ok(());
                }
            }
            launch_macos_app("Terminal", path_str)
        }
    }
}

#[cfg(target_os = "macos")]
fn launch_macos_app(app_name: &str, path: &str) -> Result<(), String> {
    // `open -a <app> <path>` opens <path> in <app>. For Terminal/iTerm
    // this opens a new window with the working directory set to <path>.
    let mut cmd = Command::new("open");
    cmd.args(["-a", app_name, path]);
    spawn_visible(cmd)
}

#[cfg(target_os = "linux")]
fn launch_terminal(pref: &str, path: &Path) -> Result<(), String> {
    let path_str = path
        .to_str()
        .ok_or_else(|| "path contains non-utf8 characters".to_string())?;

    match pref {
        "gnome-terminal" => launch_linux_terminal("gnome-terminal", path_str),
        "konsole" => launch_linux_terminal("konsole", path_str),
        "alacritty" => launch_linux_terminal("alacritty", path_str),
        "kitty" => launch_linux_terminal("kitty", path_str),
        "xterm" => launch_linux_terminal("xterm", path_str),
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
                    if launch_linux_terminal(candidate, path_str).is_ok() {
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
fn launch_linux_terminal(name: &str, path: &str) -> Result<(), String> {
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
