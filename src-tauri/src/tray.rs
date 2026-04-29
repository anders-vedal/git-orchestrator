//! System tray icon: minimise-to-tray, quick "Fetch all" action, live status tooltip.
//!
//! Tray mechanics intentionally stay in this file — lib.rs wires setup/events,
//! everything else (menu items, click handling, tooltip updates) lives here.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, WindowEvent,
};

pub const TRAY_ID: &str = "main";

/// Menu event IDs emitted by the tray.
pub const MENU_SHOW: &str = "show_window";
pub const MENU_FETCH_ALL: &str = "fetch_all";
pub const MENU_QUIT: &str = "quit";

/// Event names emitted to the frontend from the tray.
pub const EVENT_FETCH_ALL: &str = "tray:fetch-all";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, MENU_SHOW, "Show window", true, None::<&str>)?;
    let fetch_all = MenuItem::with_id(app, MENU_FETCH_ALL, "Fetch all", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &fetch_all, &sep, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default_window_icon".into()))?;

    TrayIconBuilder::<R>::with_id(TRAY_ID)
        .tooltip("Git Repo Dashboard")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_SHOW => show_and_focus(app),
            MENU_FETCH_ALL => {
                show_and_focus(app);
                // Frontend owns the fetch-all UI (progress, summary dialog, refresh).
                // Tray just pokes it.
                let _ = app.emit(EVENT_FETCH_ALL, ());
            }
            MENU_QUIT => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn show_and_focus<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(w) = app.get_webview_window("main") else {
        return;
    };
    match w.is_visible() {
        Ok(true) => {
            // If visible but not focused, bring it forward instead of hiding.
            let focused = w.is_focused().unwrap_or(false);
            if focused {
                let _ = w.hide();
            } else {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }
        _ => show_and_focus(app),
    }
}

/// Intercept the main window's close button: hide to tray instead of exiting.
pub fn on_window_event<R: Runtime>(window: &tauri::Window<R>, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}

/// Push a new tooltip onto the tray. Called from `set_tray_tooltip` command.
pub fn set_tooltip<R: Runtime>(app: &AppHandle<R>, text: &str) -> Result<(), String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "tray not initialised".to_string())?;
    tray.set_tooltip(Some(text)).map_err(|e| e.to_string())
}
