use crate::errors::AppError;
use crate::models::{ParseResult, PlayerInfo};
use source2_demo::prelude::*;
use source2_demo_protobufs::{CDemoFileHeader, EDemoCommands};
use prost::Message;
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

static PARSED_PLAYERS: Mutex<Option<HashMap<String, PlayerInfo>>> = Mutex::new(None);
static MAP_NAME: Mutex<Option<String>> = Mutex::new(None);

#[derive(Default)]
struct PlayerCollector;

#[observer]
#[uses_entities]
impl PlayerCollector {
    #[on_entity("CCSPlayerController")]
    fn on_player_controller(&mut self, entity: &Entity) -> ObserverResult {
        let name: String = match try_property!(entity, "m_iszPlayerName") {
            Some(n) => n,
            None => return Ok(()),
        };
        let steam_id: u64 = match try_property!(entity, "m_steamID") {
            Some(id) => id,
            None => return Ok(()),
        };
        let team_num: u8 = match try_property!(entity, "m_iTeamNum") {
            Some(t) => t,
            None => return Ok(()),
        };

        let slot = (entity.index() as u32).saturating_sub(1);

        if steam_id != 0 {
            let steam_id_str = steam_id.to_string();
            if let Ok(mut guard) = PARSED_PLAYERS.lock() {
                if let Some(map) = guard.as_mut() {
                    map.insert(
                        steam_id_str.clone(),
                        PlayerInfo {
                            steam_id: steam_id_str,
                            name,
                            team: team_num,
                            slot,
                        },
                    );
                }
            }
        }
        Ok(())
    }
}

#[derive(Default)]
struct MapNameCollector;

impl Observer for MapNameCollector {
    fn interests(&self) -> Interests {
        Interests::DEMO_MESSAGE
    }

    fn on_demo_command(
        &mut self,
        _ctx: &Context,
        msg_type: EDemoCommands,
        msg: &[u8],
    ) -> ObserverResult {
        if msg_type == EDemoCommands::DemFileHeader {
            if let Ok(header) = CDemoFileHeader::decode(msg) {
                let map = header.map_name.clone().unwrap_or_default();
                let srv = header.server_name.clone().unwrap_or_default();
                
                if let Ok(mut guard) = MAP_NAME.lock() {
                    if !map.is_empty() {
                        *guard = Some(map);
                    } else if !srv.is_empty() {
                        *guard = Some(srv); // Sometimes map is embedded in server_name
                    }
                }
            }
        }
        Ok(())
    }
}

pub fn decompress_zst_to_temp(zst_path: &Path) -> Result<PathBuf, AppError> {
    let temp_dir = std::env::temp_dir().join("cs2_demo_opener");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| AppError::Io(format!("Failed to create temp directory: {}", e)))?;

    let file_name = zst_path
        .file_name()
        .ok_or_else(|| AppError::Parser("Invalid filename".to_string()))?
        .to_string_lossy();

    let target_name = if file_name.to_lowercase().ends_with(".dem.zst") {
        file_name[..file_name.len() - 4].to_string()
    } else if file_name.to_lowercase().ends_with(".zst") {
        format!("{}.dem", &file_name[..file_name.len() - 4])
    } else {
        return Err(AppError::Parser("File is not a .zst file".to_string()));
    };

    let target_path = temp_dir.join(target_name);

    let zst_file = File::open(zst_path)
        .map_err(|e| AppError::Io(format!("Failed to open zst file: {}", e)))?;
    let mut decoder = zstd::stream::read::Decoder::new(zst_file)
        .map_err(|e| AppError::Parser(format!("Failed to initialize zstd decoder: {}", e)))?;

    let mut target_file = File::create(&target_path).map_err(|e| {
        AppError::Io(format!(
            "Failed to create decompressed file at '{}': {}",
            target_path.display(),
            e
        ))
    })?;

    std::io::copy(&mut decoder, &mut target_file).map_err(|e| {
        AppError::Io(format!(
            "Failed to decompress zst to '{}': {}",
            target_path.display(),
            e
        ))
    })?;

    Ok(target_path)
}

pub fn prepare_demo_path(demo_path: &str) -> Result<PathBuf, AppError> {
    let path = Path::new(demo_path);
    if demo_path.to_lowercase().ends_with(".zst") {
        decompress_zst_to_temp(path)
    } else {
        Ok(path.to_path_buf())
    }
}

pub fn parse_demo_players_internal(demo_path: String) -> Result<ParseResult, AppError> {
    let resolved_path = prepare_demo_path(&demo_path)?;
    let resolved_path_clone = resolved_path.clone();

    // Run the parser in a separate thread with a larger stack size to prevent stack overflows
    // (especially common in Windows debug builds due to deep parser recursion).
    let handle = std::thread::Builder::new()
        .name("demo_parser".to_string())
        .stack_size(8 * 1024 * 1024) // 8 MB stack size
        .spawn(move || {
            // Clear and initialize parsed players cache
            if let Ok(mut guard) = PARSED_PLAYERS.lock() {
                *guard = Some(HashMap::new());
            }
            if let Ok(mut guard) = MAP_NAME.lock() {
                *guard = None;
            }

            let file = File::open(&resolved_path_clone)
                .map_err(|e| AppError::Io(format!("Failed to open demo file: {}", e)))?;
            let input = BufReader::new(file);
            let mut parser = Parser::from_reader(input)
                .map_err(|e| AppError::Parser(format!("Failed to create parser: {}", e)))?;

            parser.register_observer::<PlayerCollector>();
            parser.register_observer::<MapNameCollector>();

            // Parse up to tick 5000 (sufficient to initialize player controllers)
            // If run_to_tick errors out (e.g. EOF because the demo is shorter), we still proceed
            let _ = parser.run_to_tick(5000);

            if let Ok(mut guard) = PARSED_PLAYERS.lock() {
                if let Some(map) = guard.take() {
                    let mut list: Vec<PlayerInfo> = map.into_values().collect();
                    list.sort_by(|a, b| a.slot.cmp(&b.slot));
                    
                    let header_map_name = {
                        let guard = MAP_NAME.lock().unwrap();
                        guard.clone().unwrap_or_else(|| String::new())
                    };
                    
                    return Ok(ParseResult {
                        players: list,
                        uncompressed_path: resolved_path_clone.to_string_lossy().into_owned(),
                        map_name: header_map_name,
                    });
                }
            }
            Err(AppError::Parser(
                "Failed to parse players from demo".to_string(),
            ))
        })
        .map_err(|e| AppError::Parser(format!("Failed to spawn parser thread: {}", e)))?;

    handle
        .join()
        .map_err(|_| AppError::Parser("Parser thread panicked".to_string()))?
}

pub fn generate_2d_data_internal(app: &tauri::AppHandle, demo_path: String) -> Result<(), AppError> {
    use crate::parser_2d::Parser2D;
    
    let resolved_path = prepare_demo_path(&demo_path)?;
    let app_data_dir = app.path().app_data_dir().map_err(|e| AppError::Io(format!("Could not resolve app data dir: {}", e)))?;
    let mut save_dir = app_data_dir.clone();
    save_dir.push("chunks");
    std::fs::create_dir_all(&save_dir).map_err(|e| AppError::Io(format!("Failed to create chunks dir: {}", e)))?;
    
    let demo_name = Path::new(&demo_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let app_clone = app.clone();

    let _handle = std::thread::Builder::new()
        .name("demo_parser_2d".to_string())
        .stack_size(8 * 1024 * 1024)
        .spawn(move || {
            let demo_bytes = match std::fs::read(&resolved_path) {
                Ok(b) => {
                    b
                },
                Err(e) => {
                    use tauri::Emitter;
                    let _ = app_clone.emit("parse_error", format!("Failed to read demo for 2D parsing: {}", e));
                    return;
                }
            };

            let mut parser = match Parser::new(&demo_bytes) {
                Ok(p) => {
                    p
                },
                Err(e) => {
                    use tauri::Emitter;
                    let _ = app_clone.emit("parse_error", format!("Failed to create 2D parser: {}", e));
                    return;
                }
            };

            let observer = parser.register_observer::<Parser2D>();
            {
                let mut obs = observer.borrow_mut();
                obs.save_dir = save_dir.clone();
                obs.demo_name = demo_name.clone();
                obs.current_round = 1;
                let app_clone = app_clone.clone();
                use tauri::Emitter;
                obs.progress_callback = Some(Box::new(move |tick| {
                    let _ = app_clone.emit("parse_progress", tick);
                }));
            }

            let total_ticks = parser.replay_info().playback_ticks();
            use tauri::Emitter;
            let _ = app_clone.emit("parse_init", total_ticks);
            let _ = app_clone.emit("parse_progress", 0); // Send a starting signal
            
            if let Err(e) = parser.run_to_end() {
                use tauri::Emitter;
                let _ = app_clone.emit("parse_error", format!("Parser crashed during run_to_end: {:?}", e));
                return;
            }
            
            if crate::parser_2d::CANCEL_PARSING.load(std::sync::atomic::Ordering::Relaxed) {
                use tauri::Emitter;
                #[derive(serde::Serialize, Clone)]
                struct ParseCompletePayload {
                    message: String,
                    total_rounds: usize,
                }
                let _ = app_clone.emit("parse_complete", ParseCompletePayload {
                    message: "Parsing cancelled by user.".to_string(),
                    total_rounds: 0,
                });
            } else {
                let mut obs = observer.borrow_mut();
                obs.force_flush();
                let total = obs.chunks.len();
                
                let match_info_path = save_dir.join(format!("{}_match_info.json", demo_name));
                if let Ok(info_json) = serde_json::to_string(&obs.round_results) {
                    let _ = std::fs::write(&match_info_path, info_json);
                }

                use tauri::Emitter;
                #[derive(serde::Serialize, Clone)]
                struct ParseCompletePayload {
                    message: String,
                    total_rounds: usize,
                }
                let _ = app_clone.emit("parse_complete", ParseCompletePayload {
                    message: format!("Demo completely parsed! Total chunks: {}", total),
                    total_rounds: total,
                });
            }
        })
        .map_err(|e| AppError::Parser(format!("Failed to spawn 2D parser thread: {}", e)))?;

    // Return immediately while parser runs in background
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decompress_zst_non_existent_file() {
        let path = Path::new("non_existent_file_with_invalid_name.zst");
        let result = decompress_zst_to_temp(path);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Io(_) => {} // Expected IO error
            _ => panic!("Expected IO error"),
        }
    }

    #[test]
    fn test_decompress_zst_invalid_extension() {
        let path = Path::new("test_file.dem");
        let result = decompress_zst_to_temp(path);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Parser(msg) => {
                assert_eq!(msg, "File is not a .zst file");
            }
            _ => panic!("Expected Parser error"),
        }
    }
}
