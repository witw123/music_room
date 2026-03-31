use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;
use url::Url;

const DEV_ORIGIN: &str = "http://localhost:3000";
const PROD_ORIGIN: &str = "https://witw.top";
const AUDIO_EXTENSIONS: &[&str] = &["mp3", "wav", "flac", "m4a", "aac", "ogg"];

#[derive(Serialize)]
struct DesktopPickedFile {
  name: String,
  path: String,
}

#[derive(Serialize)]
struct DesktopLoadedFile {
  name: String,
  path: String,
  #[serde(rename = "type")]
  mime_type: String,
  data: Vec<u8>,
}

fn infer_mime_type(file_path: &Path) -> &'static str {
  match file_path
    .extension()
    .and_then(|extension| extension.to_str())
    .map(|extension| extension.to_ascii_lowercase())
    .as_deref()
  {
    Some("mp3") => "audio/mpeg",
    Some("wav") => "audio/wav",
    Some("flac") => "audio/flac",
    Some("m4a") => "audio/mp4",
    Some("aac") => "audio/aac",
    Some("ogg") => "audio/ogg",
    _ => "application/octet-stream",
  }
}

fn normalize_external_url(raw_url: &str) -> Result<String, String> {
  let parsed = Url::parse(raw_url).map_err(|error| error.to_string())?;
  match parsed.scheme() {
    "http" | "https" | "mailto" => Ok(parsed.to_string()),
    _ => Err("Only http(s) and mailto links are allowed.".to_string()),
  }
}

fn reveal_item_in_folder(file_path: &Path) -> Result<(), String> {
  let normalized = file_path
    .canonicalize()
    .map_err(|error| format!("Failed to resolve path: {error}"))?;

  #[cfg(target_os = "windows")]
  {
    Command::new("explorer")
      .arg("/select,")
      .arg(&normalized)
      .spawn()
      .map_err(|error| format!("Failed to reveal file in Explorer: {error}"))?;
  }

  #[cfg(target_os = "macos")]
  {
    Command::new("open")
      .arg("-R")
      .arg(&normalized)
      .spawn()
      .map_err(|error| format!("Failed to reveal file in Finder: {error}"))?;
  }

  #[cfg(target_os = "linux")]
  {
    let parent = normalized
      .parent()
      .ok_or_else(|| "Failed to resolve the parent folder.".to_string())?;

    Command::new("xdg-open")
      .arg(parent)
      .spawn()
      .map_err(|error| format!("Failed to open the parent folder: {error}"))?;
  }

  Ok(())
}

#[tauri::command]
fn pick_audio_files() -> Vec<DesktopPickedFile> {
  rfd::FileDialog::new()
    .add_filter("Audio", AUDIO_EXTENSIONS)
    .pick_files()
    .unwrap_or_default()
    .into_iter()
    .map(|file_path| DesktopPickedFile {
      name: file_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string(),
      path: file_path.to_string_lossy().into_owned(),
    })
    .collect()
}

#[tauri::command]
fn read_audio_file(file_path: String) -> Result<DesktopLoadedFile, String> {
  let normalized = PathBuf::from(file_path);
  let bytes = fs::read(&normalized).map_err(|error| format!("Failed to read file: {error}"))?;

  Ok(DesktopLoadedFile {
    name: normalized
      .file_name()
      .and_then(|value| value.to_str())
      .unwrap_or_default()
      .to_string(),
    path: normalized.to_string_lossy().into_owned(),
    mime_type: infer_mime_type(&normalized).to_string(),
    data: bytes,
  })
}

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
  app.package_info().version.to_string()
}

#[tauri::command]
fn open_external(raw_url: String) -> Result<(), String> {
  let normalized = normalize_external_url(&raw_url)?;
  open::that_detached(normalized).map_err(|error| format!("Failed to open external URL: {error}"))
}

#[tauri::command]
fn show_item_in_folder(file_path: String) -> Result<(), String> {
  reveal_item_in_folder(Path::new(&file_path))
}

#[tauri::command]
fn write_desktop_log(level: String, message: String) {
  match level.as_str() {
    "error" => eprintln!("[desktop] {message}"),
    "warn" => eprintln!("[desktop] {message}"),
    _ => println!("[desktop] {message}"),
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
      }
    }))
    .invoke_handler(tauri::generate_handler![
      pick_audio_files,
      read_audio_file,
      get_app_version,
      open_external,
      show_item_in_folder,
      write_desktop_log
    ])
    .on_page_load(|window, _| {
      let script = format!(
        r#"
(() => {{
  const internalOrigins = new Set({origins});
  const invokeOpenExternal = (url) => {{
    const tauriCore = window.__TAURI__?.core;
    if (!tauriCore?.invoke) {{
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }}
    tauriCore.invoke("open_external", {{ rawUrl: url }}).catch(() => {{
      window.open(url, "_blank", "noopener,noreferrer");
    }});
  }};

  document.addEventListener("click", (event) => {{
    const target = event.target;
    const anchor = target instanceof Element ? target.closest("a[href]") : null;
    if (!(anchor instanceof HTMLAnchorElement)) {{
      return;
    }}

    let nextUrl;
    try {{
      nextUrl = new URL(anchor.href, window.location.href);
    }} catch {{
      return;
    }}

    if (internalOrigins.has(nextUrl.origin)) {{
      return;
    }}

    if (!["http:", "https:", "mailto:"].includes(nextUrl.protocol)) {{
      return;
    }}

    event.preventDefault();
    invokeOpenExternal(nextUrl.toString());
  }}, true);

  const originalOpen = window.open.bind(window);
  window.open = (url, target, features) => {{
    if (typeof url === "string") {{
      try {{
        const nextUrl = new URL(url, window.location.href);
        if (!internalOrigins.has(nextUrl.origin) && ["http:", "https:", "mailto:"].includes(nextUrl.protocol)) {{
          invokeOpenExternal(nextUrl.toString());
          return null;
        }}
      }} catch {{
        // Fall back to the native implementation below.
      }}
    }}

    return originalOpen(url, target, features);
  }};
}})();
"#,
        origins = serde_json::to_string(&[DEV_ORIGIN, PROD_ORIGIN]).unwrap()
      );

      let _ = window.eval(&script);
      let _ = window.show();
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
