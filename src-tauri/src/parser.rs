use crate::errors::AppError;
use crate::models::{ParseResult, PlayerInfo};
use source2_demo::prelude::*;
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static PARSED_PLAYERS: Mutex<Option<HashMap<String, PlayerInfo>>> = Mutex::new(None);

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
    println!(
        "[Rust Backend] parse_demo_players called for path: {}",
        demo_path
    );
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

            let file = File::open(&resolved_path_clone)
                .map_err(|e| AppError::Io(format!("Failed to open demo file: {}", e)))?;
            let input = BufReader::new(file);
            let mut parser = Parser::from_reader(input)
                .map_err(|e| AppError::Parser(format!("Failed to create parser: {}", e)))?;

            parser.register_observer::<PlayerCollector>();

            // Parse up to tick 5000 (sufficient to initialize player controllers)
            // If run_to_tick errors out (e.g. EOF because the demo is shorter), we still proceed
            println!("[Rust Backend] Running parser to tick 5000...");
            let res = parser.run_to_tick(5000);
            println!(
                "[Rust Backend] Parser run_to_tick completed. Result: {:?}",
                res
            );

            if let Ok(mut guard) = PARSED_PLAYERS.lock() {
                if let Some(map) = guard.take() {
                    let mut list: Vec<PlayerInfo> = map.into_values().collect();
                    list.sort_by(|a, b| a.slot.cmp(&b.slot));
                    println!("[Rust Backend] Successfully parsed {} players:", list.len());
                    for player in &list {
                        println!(
                            "  -> Slot {}: {} (SteamID: {}, Team: {})",
                            player.slot, player.name, player.steam_id, player.team
                        );
                    }
                    return Ok(ParseResult {
                        players: list,
                        uncompressed_path: resolved_path_clone.to_string_lossy().into_owned(),
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
