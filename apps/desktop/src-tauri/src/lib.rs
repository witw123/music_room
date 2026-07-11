use serde::Serialize;
use std::fs;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::process::Child;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::Manager;
use url::Url;

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "wav", "flac", "m4a", "aac", "ogg"];

#[derive(Serialize)]
struct DesktopPickedFile {
  name: String,
  #[serde(rename = "grantId")]
  grant_id: String,
}

#[derive(Serialize)]
struct DesktopLoadedFile {
  name: String,
  #[serde(rename = "type")]
  mime_type: String,
  data: Vec<u8>,
}

#[derive(Default)]
struct FileGrantStore(Mutex<HashMap<String, PathBuf>>);

#[derive(Default)]
struct SidecarProcess(Mutex<Option<Child>>);

impl Drop for SidecarProcess {
  fn drop(&mut self) {
    if let Ok(process) = self.0.get_mut() {
      if let Some(child) = process.as_mut() {
        let _ = child.kill();
      }
    }
  }
}

fn wait_for_sidecar(nonce: &str) -> Result<(), String> {
  let deadline = Instant::now() + Duration::from_secs(20);
  while Instant::now() < deadline {
    if let Ok(mut stream) = TcpStream::connect("127.0.0.1:37421") {
      let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
      let request = b"GET /api/desktop-health HTTP/1.1\r\nHost: 127.0.0.1:37421\r\nConnection: close\r\n\r\n";
      if stream.write_all(request).is_ok() {
        let mut response = String::new();
        if stream.read_to_string(&mut response).is_ok() && response.contains(nonce) {
          return Ok(());
        }
      }
    }
    thread::sleep(Duration::from_millis(200));
  }
  Err("Bundled web sidecar did not become ready.".to_string())
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

#[tauri::command]
fn pick_audio_files(grants: tauri::State<'_, FileGrantStore>) -> Vec<DesktopPickedFile> {
  let paths = rfd::FileDialog::new()
    .add_filter("Audio", AUDIO_EXTENSIONS)
    .pick_files()
    .unwrap_or_default();
  let mut store = grants.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  paths.into_iter()
    .map(|file_path| {
      let grant_id = uuid::Uuid::new_v4().to_string();
      store.insert(grant_id.clone(), file_path.clone());
      DesktopPickedFile {
      name: file_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string(),
      grant_id,
    }})
    .collect()
}

#[tauri::command]
fn read_audio_file(
  grant_id: String,
  grants: tauri::State<'_, FileGrantStore>
) -> Result<DesktopLoadedFile, String> {
  let normalized = grants.0
    .lock()
    .unwrap_or_else(|poisoned| poisoned.into_inner())
    .remove(&grant_id)
    .ok_or_else(|| "File authorization is missing or has expired.".to_string())?;
  let extension = normalized.extension().and_then(|value| value.to_str()).unwrap_or_default();
  if !AUDIO_EXTENSIONS.iter().any(|allowed| allowed.eq_ignore_ascii_case(extension)) {
    return Err("The selected file is not a supported audio file.".to_string());
  }
  let bytes = fs::read(&normalized).map_err(|error| format!("Failed to read file: {error}"))?;

  Ok(DesktopLoadedFile {
    name: normalized
      .file_name()
      .and_then(|value| value.to_str())
      .unwrap_or_default()
      .to_string(),
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
    .manage(FileGrantStore::default())
    .manage(SidecarProcess::default())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
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
      write_desktop_log
    ])
    .setup(|app| {
      let window = app.get_webview_window("main").ok_or("Main window is unavailable.")?;
      if cfg!(debug_assertions) {
        window.show()?;
        return Ok(());
      }

      let resource_dir = app.path().resource_dir()?;
      let node_name = if cfg!(target_os = "windows") { "node.exe" } else { "node" };
      let node_path = resource_dir.join("node").join(node_name);
      let web_dir = resource_dir.join("web");
      let server_path = web_dir.join("apps").join("web").join("server.js");
      let nonce = uuid::Uuid::new_v4().to_string();
      let child = Command::new(node_path)
        .arg(server_path)
        .current_dir(&web_dir)
        .env("NODE_ENV", "production")
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", "37421")
        .env("MUSIC_ROOM_DESKTOP_BUILD_NONCE", &nonce)
        .spawn()
        .map_err(|error| format!("Failed to launch bundled web sidecar: {error}"))?;
      *app.state::<SidecarProcess>().0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(child);
      wait_for_sidecar(&nonce)?;
      window.navigate(Url::parse("http://127.0.0.1:37421/app?client=desktop")?)?;
      window.show()?;
      Ok(())
    })
    .on_page_load(|window, _| {
      let script = r#"
(() => {{
  const internalOrigins = new Set([window.location.origin]);
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
"#;

      let _ = window.eval(script);
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
