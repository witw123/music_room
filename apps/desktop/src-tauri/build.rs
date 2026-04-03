fn main() {
  println!("cargo:rerun-if-env-changed=MUSIC_ROOM_PUBLIC_ORIGIN");
  tauri_build::build()
}
