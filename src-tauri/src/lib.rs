pub mod errors;
pub mod models;
pub mod steam;
pub mod parser;
pub mod parser_2d;
mod launcher;
mod asset_manager;

use errors::AppError;
use models::{SteamUser, PlayerInfo, ParseResult};
use tauri::Manager;

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
async fn open_2d_viewer_window(app: tauri::AppHandle, demo_path: String, map_name: String) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;
    
    // Construct the URL string with query params
    let url = format!("index.html#/viewer?demoPath={}&mapName={}", urlencoding::encode(&demo_path), urlencoding::encode(&map_name));
    
    let window_label = "2d_viewer";
    
    // Close existing viewer if any
    if let Some(existing_window) = app.get_webview_window(window_label) {
        let _ = existing_window.close();
    }
    
    let window = WebviewWindowBuilder::new(&app, window_label, tauri::WebviewUrl::App(url.into()))
        .title(format!("2D Replay - {}", map_name))
        .inner_size(1750.0, 1100.0)
        .min_inner_size(1750.0, 1100.0)
        .build()
        .map_err(|e| e.to_string())?;

    let app_clone = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            crate::parser_2d::CANCEL_PARSING.store(true, std::sync::atomic::Ordering::Relaxed);
            println!("[Rust Backend] 2D Viewer window destroyed. Set cancellation flag.");
            use tauri::Emitter;
            let _ = app_clone.emit("2d_viewer_destroyed", ());
        }
    });

    Ok(())
}

#[tauri::command]
fn generate_2d_data(app: tauri::AppHandle, demo_path: String) -> Result<(), AppError> {
    crate::parser_2d::CANCEL_PARSING.store(false, std::sync::atomic::Ordering::Relaxed);
    parser::generate_2d_data_internal(&app, demo_path)
}

#[tauri::command]
fn cancel_2d_parsing() -> Result<(), AppError> {
    crate::parser_2d::CANCEL_PARSING.store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn get_round_chunk(app: tauri::AppHandle, demo_path: String, round: u32) -> Result<Vec<u8>, AppError> {
    use std::path::Path;
    let app_data_dir = app.path().app_data_dir().map_err(|e| AppError::Io(format!("Could not resolve app data dir: {}", e)))?;
    let demo_name = Path::new(&demo_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    
    let chunk_path = app_data_dir.join("chunks").join(format!("{}_round_{}.pb", demo_name, round));
    if chunk_path.exists() {
        std::fs::read(chunk_path).map_err(|e| AppError::Io(format!("Failed to read chunk: {}", e)))
    } else {
        Err(AppError::Parser(format!("Chunk not yet generated for round {}", round)))
    }
}

#[tauri::command]
fn check_map_assets(app: tauri::AppHandle, map_name: String) -> Result<bool, AppError> {
    asset_manager::check_map_assets_internal(&app, &map_name)
}

#[tauri::command]
fn get_map_radar_base64(app: tauri::AppHandle, map_name: String) -> Result<String, AppError> {
    asset_manager::get_map_radar_base64_internal(&app, &map_name)
}

#[tauri::command]
fn get_lower_map_radar_base64(app: tauri::AppHandle, map_name: String) -> Result<String, AppError> {
    asset_manager::get_lower_map_radar_base64_internal(&app, &map_name)
}

#[tauri::command]
fn download_map_assets(app: tauri::AppHandle, map_name: String) -> Result<(), AppError> {
    asset_manager::download_map_assets_internal(&app, &map_name)
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

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn get_match_info(app: tauri::AppHandle, demo_path: String) -> Result<String, AppError> {
    use std::path::Path;
    use tauri::Manager;
    let app_data_dir = app.path().app_data_dir().map_err(|e| AppError::Io(format!("Could not resolve app data dir: {}", e)))?;
    let demo_name = Path::new(&demo_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    
    let info_path = app_data_dir.join("chunks").join(format!("{}_match_info.json", demo_name));
    if info_path.exists() {
        std::fs::read_to_string(info_path).map_err(|e| AppError::Io(format!("Failed to read match info: {}", e)))
    } else {
        Err(AppError::Parser("Match info not yet generated".to_string()))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_steam_user_info,
            detect_cs2_path,
            parse_demo_players,
            open_2d_viewer_window,
            generate_2d_data,
            cancel_2d_parsing,
            get_round_chunk,
            get_match_info,
            get_map_radar_base64,
            get_lower_map_radar_base64,
            launch_cs2_demo,
            resolve_steam_name,
            select_demo_file,
            get_app_version,
            check_map_assets,
            download_map_assets
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

