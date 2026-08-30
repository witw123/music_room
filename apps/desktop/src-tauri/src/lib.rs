use tauri::{
    command,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::WebviewWindowBuilder,
    AppHandle, Manager, PhysicalPosition, WebviewUrl, WindowEvent,
};

// The desktop lyrics window: a compact always-on-top bar that shows the
// player card (artwork, track info, transport) together with word-by-word
// karaoke lyrics. It loads the same web origin as the main window on a
// dedicated route so BroadcastChannel can bridge playback state between the
// two windows without any extra permissions.
const LYRICS_LABEL: &str = "lyrics";
const LYRICS_WIDTH: f64 = 860.0;
const LYRICS_HEIGHT: f64 = 96.0;
const LYRICS_MIN_WIDTH: f64 = 320.0;
const LYRICS_MIN_HEIGHT: f64 = 64.0;
const LYRICS_MAX_WIDTH: f64 = 2400.0;
const LYRICS_MAX_HEIGHT: f64 = 600.0;
// Keep the bar clear of the Windows taskbar / macOS dock.
const LYRICS_BOTTOM_INSET_LOGICAL: f64 = 96.0;

// NOTE: every command below is `async` on purpose. Sync commands execute on
// the main thread, and creating a webview window there dispatches back into
// the event loop it is blocking — the whole app deadlocks (no window, frozen
// UI, no quit). Async commands run on the async runtime, which is the
// supported path for cross-thread window creation.
/// Guarantee a visible storage root for the client: prefer a real folder
/// inside the installation directory; fall back to the per-user app data
/// directory when the install location is not writable (e.g. Program Files).
fn resolve_default_storage_root(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(install_dir) = exe.parent() {
            let root = install_dir.join("MusicRoomStorage");
            if std::fs::create_dir_all(&root).is_ok() {
                let probe = root.join(".write-probe");
                if std::fs::write(&probe, b"ok").is_ok() {
                    let _ = std::fs::remove_file(&probe);
                    return Ok(root);
                }
            }
        }
    }

    let data_dir = app.path().app_local_data_dir().map_err(|error| error.to_string())?;
    let root = data_dir.join("storage");
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

#[command]
async fn ensure_default_storage_root(app: AppHandle) -> Result<String, String> {
    let root = resolve_default_storage_root(&app)?;
    Ok(root.to_string_lossy().into_owned())
}

#[command]
async fn toggle_desktop_lyrics(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(LYRICS_LABEL) {
        if window.is_visible().unwrap_or(false) {
            window.hide().map_err(|error| error.to_string())?;
            return Ok(false);
        }
        position_lyrics_window(&window);
        window.show().map_err(|error| error.to_string())?;
        return Ok(true);
    }

    let Some(main) = app.get_webview_window("main") else {
        return Ok(false);
    };
    let Ok(mut url) = main.url() else {
        return Ok(false);
    };
    url.set_path("/desktop-lyrics");
    url.set_query(Some("window=desktop-lyrics"));
    url.set_fragment(None);

    let builder = WebviewWindowBuilder::new(&app, LYRICS_LABEL, WebviewUrl::External(url))
        .title("桌面歌词")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        // Freely resizable: the window host exposes edge dragging and the
        // content adapts its font to the window size.
        .resizable(true)
        .shadow(false)
        .focused(false)
        .inner_size(LYRICS_WIDTH, LYRICS_HEIGHT);
    // `transparent` is unavailable on macOS builds of tauri 2.11 (the builder
    // method is cfg'd out regardless of the macos-private-api feature), so the
    // lyrics page paints its own opaque dark surface there. Windows and Linux
    // get a true see-through bar.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);
    let window = builder.build().map_err(|error| error.to_string())?;
    position_lyrics_window(&window);
    window.show().map_err(|error| error.to_string())?;
    Ok(true)
}

#[command]
async fn hide_desktop_lyrics_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LYRICS_LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[command]
async fn drag_desktop_lyrics_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LYRICS_LABEL) {
        window.start_dragging().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[command]
async fn set_desktop_lyrics_size(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let Some(window) = app.get_webview_window(LYRICS_LABEL) else {
        return Ok(());
    };
    let width = width.clamp(LYRICS_MIN_WIDTH, LYRICS_MAX_WIDTH);
    let height = height.clamp(LYRICS_MIN_HEIGHT, LYRICS_MAX_HEIGHT);
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    position_lyrics_window(&window);
    Ok(())
}

fn position_lyrics_window(window: &tauri::WebviewWindow) {
    let Some(main) = window.app_handle().get_webview_window("main") else {
        return;
    };
    let Ok(scale) = main.scale_factor() else {
        return;
    };
    let Some(monitor) = main.current_monitor().ok().flatten() else {
        return;
    };
    let monitor_size = monitor.size();
    let monitor_position = monitor.position();
    let width_px = (LYRICS_WIDTH * scale).round() as i32;
    let height_px = (LYRICS_HEIGHT * scale).round() as i32;
    let inset_px = (LYRICS_BOTTOM_INSET_LOGICAL * scale).round() as i32;
    let x = monitor_position.x + (monitor_size.width as i32 - width_px) / 2;
    let y = monitor_position.y + monitor_size.height as i32 - height_px - inset_px;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            toggle_desktop_lyrics,
            hide_desktop_lyrics_window,
            drag_desktop_lyrics_window,
            set_desktop_lyrics_size,
            ensure_default_storage_root
        ])
        .setup(|app| {
            let quit_i = MenuItem::with_id(app, "quit", "退出 Music Room", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let mut builder = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
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
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }

            let _tray = builder.build(app)?;

            // The storage root must exist by default so cached playback works
            // on first launch without any manual directory selection.
            if let Err(error) = resolve_default_storage_root(app.handle()) {
                eprintln!("failed to initialize default storage root: {error}");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide window instead of closing to keep background music playback active
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
