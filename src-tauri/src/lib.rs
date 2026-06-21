mod errors;
mod models;
mod steam;
mod parser;
mod launcher;

use errors::AppError;
use models::{SteamUser, PlayerInfo, ParseResult};

#[tauri::command]
fn get_steam_user_info() -> Result<Vec<SteamUser>, AppError> {
    steam::get_steam_user_info_internal()
}

#[tauri::command]
fn detect_cs2_path() -> Result<Option<String>, AppError> {
    steam::detect_cs2_path_internal()
}

#[tauri::command]
fn parse_demo_players(demo_path: String) -> Result<ParseResult, AppError> {
    parser::parse_demo_players_internal(demo_path)
}

#[tauri::command]
fn launch_cs2_demo(
    demo_path: String,
    voice_mode: String,
    self_team: u8,
    cs2_path: String,
    players: Vec<PlayerInfo>,
) -> Result<String, AppError> {
    launcher::launch_cs2_demo_internal(demo_path, voice_mode, self_team, cs2_path, players)
}

#[tauri::command]
fn resolve_steam_name(steam_id: String) -> Result<String, AppError> {
    steam::resolve_steam_name_internal(&steam_id)
}

#[tauri::command]
fn select_demo_file() -> Result<Option<String>, AppError> {
    let file = rfd::FileDialog::new()
        .add_filter("CS2 Demo (.dem, .zst)", &["dem", "zst"])
        .pick_file();

    Ok(file.map(|p| p.to_string_lossy().into_owned()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_steam_user_info,
            detect_cs2_path,
            parse_demo_players,
            launch_cs2_demo,
            resolve_steam_name,
            select_demo_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
