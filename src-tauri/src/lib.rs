use serde::{Deserialize, Serialize};
use source2_demo::prelude::*;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use winreg::enums::*;
use winreg::RegKey;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SteamUser {
    pub steam_id: String,
    pub persona_name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlayerInfo {
    pub steam_id: String,
    pub name: String,
    pub team: u8,
    pub slot: u32,
}

// Global thread-safe storage for parsed players since tauri's observer registration is type-based
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

#[tauri::command]
fn get_steam_user_info() -> Result<Vec<SteamUser>, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let steam_key = hkcu
        .open_subkey(r"Software\Valve\Steam")
        .map_err(|e| format!("Steam registry key not found: {}", e))?;
    let steam_path: String = steam_key
        .get_value("SteamPath")
        .map_err(|e| format!("SteamPath value not found in registry: {}", e))?;

    let path = Path::new(&steam_path).join("config").join("loginusers.vdf");
    let file = File::open(&path).map_err(|e| format!("Failed to open loginusers.vdf: {}", e))?;
    let reader = BufReader::new(file);

    let mut users = Vec::new();
    let mut current_id = None;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l.trim().to_string(),
            Err(_) => continue,
        };

        if line.starts_with('"') && line.ends_with('"') && line.len() == 19 {
            let id = &line[1..18];
            if id.starts_with("7656119") && id.chars().all(|c| c.is_ascii_digit()) {
                current_id = Some(id.to_string());
                continue;
            }
        }

        if let Some(id) = &current_id {
            if line.starts_with("\"PersonaName\"") {
                let parts: Vec<&str> = line.split('"').collect();
                if parts.len() >= 4 {
                    users.push(SteamUser {
                        steam_id: id.clone(),
                        persona_name: parts[3].to_string(),
                    });
                }
                current_id = None;
            }
        }
    }
    Ok(users)
}

#[tauri::command]
fn detect_cs2_path() -> Result<Option<String>, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let steam_key = hkcu
        .open_subkey(r"Software\Valve\Steam")
        .map_err(|e| format!("Steam registry key not found: {}", e))?;
    let steam_path: String = steam_key
        .get_value("SteamPath")
        .map_err(|e| format!("SteamPath value not found in registry: {}", e))?;

    let mut libraries = vec![steam_path.clone()];
    let lib_vdf = Path::new(&steam_path)
        .join("steamapps")
        .join("libraryfolders.vdf");
    if lib_vdf.exists() {
        if let Ok(file) = File::open(&lib_vdf) {
            let reader = BufReader::new(file);
            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l.trim().to_string(),
                    Err(_) => continue,
                };
                if line.starts_with("\"path\"") {
                    let parts: Vec<&str> = line.split('"').collect();
                    if parts.len() >= 4 {
                        libraries.push(parts[3].to_string());
                    }
                }
            }
        }
    }

    for lib in libraries {
        // CS2 on Windows is stored in common/Counter-Strike Global Offensive/game
        let cs2_path = Path::new(&lib)
            .join("steamapps")
            .join("common")
            .join("Counter-Strike Global Offensive")
            .join("game");
        if cs2_path.exists() {
            return Ok(Some(cs2_path.to_string_lossy().into_owned()));
        }
    }
    Ok(None)
}

#[tauri::command]
fn parse_demo_players(demo_path: String) -> Result<Vec<PlayerInfo>, String> {
    println!(
        "[Rust Backend] parse_demo_players called for path: {}",
        demo_path
    );
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

            let file =
                File::open(&demo_path).map_err(|e| format!("Failed to open demo file: {}", e))?;
            let input = BufReader::new(file);
            let mut parser = Parser::from_reader(input)
                .map_err(|e| format!("Failed to create parser: {}", e))?;

            parser.register_observer::<PlayerCollector>();

            // Parse up to tick 15000 (usually enough to initialize player controllers)
            // If run_to_tick errors out (e.g. EOF because the demo is shorter), we still proceed
            println!("[Rust Backend] Running parser to tick 15000...");
            let res = parser.run_to_tick(15000);
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
                    return Ok(list);
                }
            }
            Err("Failed to parse players from demo".to_string())
        })
        .map_err(|e| format!("Failed to spawn parser thread: {}", e))?;

    handle
        .join()
        .map_err(|_| "Parser thread panicked".to_string())?
}

fn copy_file_with_retry(source: &Path, target: &Path) -> std::io::Result<u64> {
    let mut last_error = None;
    for attempt in 1..=5 {
        match std::fs::copy(source, target) {
            Ok(bytes) => return Ok(bytes),
            Err(e) => {
                if e.raw_os_error() == Some(32) {
                    last_error = Some(e);
                    // Exponential backoff: 50ms, 100ms, 150ms, 200ms, 250ms
                    std::thread::sleep(std::time::Duration::from_millis(50 * attempt));
                } else {
                    return Err(e);
                }
            }
        }
    }
    Err(last_error
        .unwrap_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "Unknown copy error")))
}

fn calculate_voice_masks(
    voice_mode: &str,
    self_steam_id: &str,
    players: &[PlayerInfo],
) -> Result<(i32, i32, Vec<PlayerInfo>), String> {
    let self_player = players.iter().find(|p| p.steam_id == self_steam_id);

    let mut mask_low: i32 = 0;
    let mut mask_high: i32 = 0;
    let mut unmuted_players = Vec::new();

    let set_bit = |slot: u32, mask_l: &mut i32, mask_h: &mut i32| {
        if slot < 32 {
            *mask_l |= 1 << slot;
        } else if slot < 64 {
            *mask_h |= 1 << (slot - 32);
        }
    };

    match voice_mode {
        "all" => {
            mask_low = -1;
            mask_high = -1;
            unmuted_players = players.to_vec();
        }
        "none" => {
            mask_low = 0;
            mask_high = 0;
        }
        "team" => {
            if let Some(me) = self_player {
                for p in players {
                    if p.team == me.team {
                        set_bit(p.slot, &mut mask_low, &mut mask_high);
                        unmuted_players.push(p.clone());
                    }
                }
            } else {
                mask_low = -1;
                mask_high = -1;
                unmuted_players = players.to_vec();
            }
        }
        "opponent" => {
            if let Some(me) = self_player {
                for p in players {
                    if p.team != me.team {
                        set_bit(p.slot, &mut mask_low, &mut mask_high);
                        unmuted_players.push(p.clone());
                    }
                }
            } else {
                mask_low = -1;
                mask_high = -1;
                unmuted_players = players.to_vec();
            }
        }
        _ => return Err("Invalid voice mode".to_string()),
    }

    Ok((mask_low, mask_high, unmuted_players))
}

fn write_voice_demo_cfg(
    cs2_game_dir: &Path,
    demo_filename: &str,
    voice_mode: &str,
    self_player: Option<&PlayerInfo>,
    mask_low: i32,
    mask_high: i32,
    unmuted_players: &[PlayerInfo],
) -> Result<(), String> {
    let cfg_dir = cs2_game_dir.join("csgo").join("cfg");
    std::fs::create_dir_all(&cfg_dir)
        .map_err(|e| format!("Failed to create cfg directory: {}", e))?;

    let cfg_path = cfg_dir.join("voice_demo.cfg");
    let mut cfg_file =
        File::create(&cfg_path).map_err(|e| format!("Failed to create cfg file: {}", e))?;

    let self_player_info = match self_player {
        Some(p) => format!(
            "{} (Slot {}, Team {})",
            p.name.replace('"', ""),
            p.slot,
            p.team
        ),
        None => "None Selected (Fallback: Hearing All)".to_string(),
    };

    let mut unmuted_players_text = String::new();
    if unmuted_players.is_empty() {
        unmuted_players_text.push_str("echo \"   - NONE (Muted all voices)\"\n");
    } else {
        for p in unmuted_players {
            let team_name = if p.team == 3 {
                "CT"
            } else if p.team == 2 {
                "T"
            } else {
                "Other"
            };
            unmuted_players_text.push_str(&format!(
                "echo \"   - Slot {:2}: {:<16} [Team: {}]\"\n",
                p.slot,
                p.name.replace('"', ""),
                team_name
            ));
        }
    }

    let content = format!(
        r#"echo ""
echo "=================================================="
echo "   CS2 DEMO VOICE OPENER - CONFIG LOADED"
echo "=================================================="
echo " Voice Mode: {}"
echo " Profile (Me): {}"
echo "--------------------------------------------------"
echo " Unmuted Players:"
{}echo "=================================================="
echo ""
tv_listen_voice_indices {}
tv_listen_voice_indices_h {}
playdemo "demos/{}"
"#,
        voice_mode.to_uppercase(),
        self_player_info,
        unmuted_players_text,
        mask_low,
        mask_high,
        demo_filename
    );

    cfg_file
        .write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write cfg file content: {}", e))?;

    Ok(())
}

fn execute_cs2_launch(cs2_game_dir: &Path) -> Result<(), String> {
    let cs2_exe = cs2_game_dir.join("bin").join("win64").join("cs2.exe");
    if !cs2_exe.exists() {
        return Err("cs2.exe not found".to_string());
    }

    // Get SteamPath from registry to construct steam.exe path
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let steam_key = hkcu.open_subkey(r"Software\Valve\Steam").ok();
    let steam_path: Option<String> = steam_key.and_then(|k| k.get_value("SteamPath").ok());

    let launched_via_steam = if let Some(path_str) = steam_path {
        let steam_exe = Path::new(&path_str).join("steam.exe");
        if steam_exe.exists() {
            Command::new(steam_exe)
                .arg("-applaunch")
                .arg("730")
                .arg("+exec")
                .arg("voice_demo.cfg")
                .spawn()
                .is_ok()
        } else {
            false
        }
    } else {
        false
    };

    if !launched_via_steam {
        // Fallback: Launch directly via cs2.exe if Steam is not found
        Command::new(cs2_exe)
            .arg("+exec")
            .arg("voice_demo.cfg")
            .spawn()
            .map_err(|e| format!("Failed to start CS2 directly: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
fn launch_cs2_demo(
    demo_path: String,
    voice_mode: String,
    self_steam_id: String,
    cs2_path: String,
    players: Vec<PlayerInfo>,
) -> Result<String, String> {
    let demo_file_path = Path::new(&demo_path);
    if !demo_file_path.exists() {
        return Err("Demo file does not exist".to_string());
    }

    let cs2_game_dir = Path::new(&cs2_path);
    if !cs2_game_dir.exists() {
        return Err("CS2 game directory does not exist".to_string());
    }

    // 1. Copy the demo to game/csgo/demos/
    let demos_dir = cs2_game_dir.join("csgo").join("demos");
    std::fs::create_dir_all(&demos_dir)
        .map_err(|e| format!("Failed to create demos directory: {}", e))?;

    let filename = demo_file_path
        .file_name()
        .ok_or_else(|| "Invalid demo path filename".to_string())?;
    let target_demo_path = demos_dir.join(filename);

    // Normalize and canonicalize paths to check if they are the same file
    let source_canonical = demo_file_path.canonicalize().ok();
    let target_canonical = target_demo_path.canonicalize().ok();

    let is_same_file = match (source_canonical, target_canonical) {
        (Some(s), Some(t)) => s == t,
        _ => {
            let s_abs = std::path::absolute(&demo_file_path).ok();
            let t_abs = std::path::absolute(&target_demo_path).ok();
            s_abs == t_abs
        }
    };

    if !is_same_file {
        copy_file_with_retry(&demo_file_path, &target_demo_path).map_err(|e| {
            format!(
                "Failed to copy demo file from '{}' to '{}': {}",
                demo_file_path.display(),
                target_demo_path.display(),
                e
            )
        })?;
    }

    // 2. Identify self player and compute voice masks
    let self_player = players.iter().find(|p| p.steam_id == self_steam_id);
    let (mask_low, mask_high, unmuted_players) =
        calculate_voice_masks(&voice_mode, &self_steam_id, &players)?;

    // 3. Write cfg file inside game/csgo/cfg/voice_demo.cfg
    let filename_str = filename.to_string_lossy();
    write_voice_demo_cfg(
        cs2_game_dir,
        &filename_str,
        &voice_mode,
        self_player,
        mask_low,
        mask_high,
        &unmuted_players,
    )?;

    // Check if CS2 is already running
    use std::os::windows::process::CommandExt;
    let cs2_running = Command::new("tasklist.exe")
        .creation_flags(0x08000000) // CREATE_NO_WINDOW to avoid spawning a cmd window
        .args(&["/FI", "IMAGENAME eq cs2.exe"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("cs2.exe"))
        .unwrap_or(false);

    if cs2_running {
        return Ok("already_running".to_string());
    }

    // 4. Launch CS2
    execute_cs2_launch(cs2_game_dir)?;

    Ok("launched".to_string())
}

#[tauri::command]
fn resolve_steam_name(steam_id: String) -> Result<String, String> {
    let url = format!("https://steamcommunity.com/profiles/{}/?xml=1", steam_id);
    let response = ureq::get(&url)
        .call()
        .map_err(|e| format!("Request failed: {}", e))?
        .into_string()
        .map_err(|e| format!("Failed to read response: {}", e))?;

    if let Some(start_idx) = response.find("<steamID><![CDATA[") {
        let after_start = &response[start_idx + "<steamID><![CDATA[".len()..];
        if let Some(end_idx) = after_start.find("]]></steamID>") {
            let name = &after_start[..end_idx];
            return Ok(name.to_string());
        }
    }

    Err("Steam ID not found in profile".to_string())
}

#[tauri::command]
fn select_demo_file() -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("CS2 Demo", &["dem"])
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

#[cfg(test)]
mod tests {
    use super::*;

    struct TestScenario {
        name: &'static str,
        players: Vec<PlayerInfo>,
        voice_mode: &'static str,
        self_steam_id: &'static str,
        expected_mask_low: i32,
        expected_mask_high: i32,
        expected_unmuted_count: usize,
    }

    #[test]
    fn test_calculate_voice_masks_parametrized() {
        let scenarios = vec![
            TestScenario {
                name: "Hear all voices (5v5)",
                players: vec![
                    PlayerInfo { steam_id: "1".to_string(), name: "T1".to_string(), team: 2, slot: 0 },
                    PlayerInfo { steam_id: "2".to_string(), name: "T2".to_string(), team: 2, slot: 1 },
                    PlayerInfo { steam_id: "3".to_string(), name: "T3".to_string(), team: 2, slot: 2 },
                    PlayerInfo { steam_id: "4".to_string(), name: "T4".to_string(), team: 2, slot: 3 },
                    PlayerInfo { steam_id: "5".to_string(), name: "T5".to_string(), team: 2, slot: 32 },
                    PlayerInfo { steam_id: "6".to_string(), name: "CT1".to_string(), team: 3, slot: 4 },
                    PlayerInfo { steam_id: "7".to_string(), name: "CT2".to_string(), team: 3, slot: 5 },
                    PlayerInfo { steam_id: "8".to_string(), name: "CT3".to_string(), team: 3, slot: 6 },
                    PlayerInfo { steam_id: "9".to_string(), name: "CT4".to_string(), team: 3, slot: 7 },
                    PlayerInfo { steam_id: "10".to_string(), name: "CT5".to_string(), team: 3, slot: 33 },
                ],
                voice_mode: "all",
                self_steam_id: "1",
                expected_mask_low: -1,
                expected_mask_high: -1,
                expected_unmuted_count: 10,
            },
            TestScenario {
                name: "Hear no voices (5v5)",
                players: vec![
                    PlayerInfo { steam_id: "1".to_string(), name: "T1".to_string(), team: 2, slot: 0 },
                    PlayerInfo { steam_id: "2".to_string(), name: "T2".to_string(), team: 2, slot: 1 },
                ],
                voice_mode: "none",
                self_steam_id: "1",
                expected_mask_low: 0,
                expected_mask_high: 0,
                expected_unmuted_count: 0,
            },
            TestScenario {
                name: "Hear only team (Self is T in 5v5)",
                players: vec![
                    // Team 2 (T)
                    PlayerInfo { steam_id: "1".to_string(), name: "T1".to_string(), team: 2, slot: 0 },
                    PlayerInfo { steam_id: "2".to_string(), name: "T2".to_string(), team: 2, slot: 1 },
                    PlayerInfo { steam_id: "3".to_string(), name: "T3".to_string(), team: 2, slot: 2 },
                    PlayerInfo { steam_id: "4".to_string(), name: "T4".to_string(), team: 2, slot: 3 },
                    PlayerInfo { steam_id: "5".to_string(), name: "T5".to_string(), team: 2, slot: 32 },
                    // Team 3 (CT)
                    PlayerInfo { steam_id: "6".to_string(), name: "CT1".to_string(), team: 3, slot: 4 },
                    PlayerInfo { steam_id: "7".to_string(), name: "CT2".to_string(), team: 3, slot: 5 },
                    PlayerInfo { steam_id: "8".to_string(), name: "CT3".to_string(), team: 3, slot: 6 },
                    PlayerInfo { steam_id: "9".to_string(), name: "CT4".to_string(), team: 3, slot: 7 },
                    PlayerInfo { steam_id: "10".to_string(), name: "CT5".to_string(), team: 3, slot: 33 },
                ],
                voice_mode: "team",
                self_steam_id: "1", // T1 (Team 2)
                // Expected slots: 0, 1, 2, 3 (low mask) and 32 (high mask)
                // expected_mask_low: (1<<0) | (1<<1) | (1<<2) | (1<<3) = 1 + 2 + 4 + 8 = 15
                // expected_mask_high: 1<<(32-32) = 1
                expected_mask_low: 15,
                expected_mask_high: 1,
                expected_unmuted_count: 5,
            },
            TestScenario {
                name: "Hear only opponents (Self is T in 5v5)",
                players: vec![
                    // Team 2 (T)
                    PlayerInfo { steam_id: "1".to_string(), name: "T1".to_string(), team: 2, slot: 0 },
                    PlayerInfo { steam_id: "2".to_string(), name: "T2".to_string(), team: 2, slot: 1 },
                    PlayerInfo { steam_id: "3".to_string(), name: "T3".to_string(), team: 2, slot: 2 },
                    PlayerInfo { steam_id: "4".to_string(), name: "T4".to_string(), team: 2, slot: 3 },
                    PlayerInfo { steam_id: "5".to_string(), name: "T5".to_string(), team: 2, slot: 32 },
                    // Team 3 (CT)
                    PlayerInfo { steam_id: "6".to_string(), name: "CT1".to_string(), team: 3, slot: 4 },
                    PlayerInfo { steam_id: "7".to_string(), name: "CT2".to_string(), team: 3, slot: 5 },
                    PlayerInfo { steam_id: "8".to_string(), name: "CT3".to_string(), team: 3, slot: 6 },
                    PlayerInfo { steam_id: "9".to_string(), name: "CT4".to_string(), team: 3, slot: 7 },
                    PlayerInfo { steam_id: "10".to_string(), name: "CT5".to_string(), team: 3, slot: 33 },
                ],
                voice_mode: "opponent",
                self_steam_id: "1", // T1 (Team 2) -> hears Team 3 (CT)
                // Expected CT slots: 4, 5, 6, 7 (low mask) and 33 (high mask)
                // expected_mask_low: (1<<4) | (1<<5) | (1<<6) | (1<<7) = 16 + 32 + 64 + 128 = 240
                // expected_mask_high: 1<<(33-32) = 2
                expected_mask_low: 240,
                expected_mask_high: 2,
                expected_unmuted_count: 5,
            },
            TestScenario {
                name: "Boundary slots check (0, 31, 32, 63)",
                players: vec![
                    PlayerInfo { steam_id: "1".to_string(), name: "Me".to_string(), team: 2, slot: 0 },
                    PlayerInfo { steam_id: "2".to_string(), name: "Teammate1".to_string(), team: 2, slot: 31 }, // Upper bound low mask
                    PlayerInfo { steam_id: "3".to_string(), name: "Teammate2".to_string(), team: 2, slot: 32 }, // Lower bound high mask
                    PlayerInfo { steam_id: "4".to_string(), name: "Teammate3".to_string(), team: 2, slot: 63 }, // Upper bound high mask
                    PlayerInfo { steam_id: "5".to_string(), name: "Enemy".to_string(), team: 3, slot: 5 },
                ],
                voice_mode: "team",
                self_steam_id: "1",
                // Expected slots: 0, 31 (low mask) and 32, 63 (high mask)
                // expected_mask_low: (1<<0) | (1<<31) = 1 | 0x80000000 = -2147483647 (signed i32)
                // expected_mask_high: (1<<0) | (1<<31) = -2147483647
                expected_mask_low: -2147483647,
                expected_mask_high: -2147483647,
                expected_unmuted_count: 4,
            },
            TestScenario {
                name: "Uneven team sizes (7 vs 3)",
                players: vec![
                    // Team 2 (T) - 7 players
                    PlayerInfo { steam_id: "1".to_string(), name: "T1".to_string(), team: 2, slot: 0 },
                    PlayerInfo { steam_id: "2".to_string(), name: "T2".to_string(), team: 2, slot: 1 },
                    PlayerInfo { steam_id: "3".to_string(), name: "T3".to_string(), team: 2, slot: 2 },
                    PlayerInfo { steam_id: "4".to_string(), name: "T4".to_string(), team: 2, slot: 3 },
                    PlayerInfo { steam_id: "5".to_string(), name: "T5".to_string(), team: 2, slot: 4 },
                    PlayerInfo { steam_id: "6".to_string(), name: "T6".to_string(), team: 2, slot: 10 },
                    PlayerInfo { steam_id: "7".to_string(), name: "T7".to_string(), team: 2, slot: 11 },
                    // Team 3 (CT) - 3 players
                    PlayerInfo { steam_id: "8".to_string(), name: "CT1".to_string(), team: 3, slot: 5 },
                    PlayerInfo { steam_id: "9".to_string(), name: "CT2".to_string(), team: 3, slot: 6 },
                    PlayerInfo { steam_id: "10".to_string(), name: "CT3".to_string(), team: 3, slot: 7 },
                ],
                voice_mode: "team",
                self_steam_id: "8", // CT1 (Team 3)
                // Expected CT slots: 5, 6, 7
                // expected_mask_low: (1<<5) | (1<<6) | (1<<7) = 32 + 64 + 128 = 224
                expected_mask_low: 224,
                expected_mask_high: 0,
                expected_unmuted_count: 3,
            },
            TestScenario {
                name: "Spectator and unassigned team filtering",
                players: vec![
                    PlayerInfo { steam_id: "1".to_string(), name: "Me".to_string(), team: 2, slot: 0 },
                    PlayerInfo { steam_id: "2".to_string(), name: "Teammate".to_string(), team: 2, slot: 1 },
                    PlayerInfo { steam_id: "3".to_string(), name: "Spec".to_string(), team: 1, slot: 2 }, // Spectator
                    PlayerInfo { steam_id: "4".to_string(), name: "Unassigned".to_string(), team: 0, slot: 3 }, // Unassigned
                ],
                voice_mode: "team",
                self_steam_id: "1",
                // Only Team 2 slots should be unmuted (0, 1)
                // expected_mask_low: (1<<0) | (1<<1) = 3
                expected_mask_low: 3,
                expected_mask_high: 0,
                expected_unmuted_count: 2,
            },
            TestScenario {
                name: "Non-sequential (sparse) slots check",
                players: vec![
                    PlayerInfo { steam_id: "1".to_string(), name: "T_Sparse1".to_string(), team: 2, slot: 0 },
                    PlayerInfo { steam_id: "2".to_string(), name: "T_Sparse2".to_string(), team: 2, slot: 12 }, // Non-sequential gap
                    PlayerInfo { steam_id: "3".to_string(), name: "T_Sparse3".to_string(), team: 2, slot: 33 }, // Non-sequential gap, high mask
                    PlayerInfo { steam_id: "4".to_string(), name: "CT_Sparse1".to_string(), team: 3, slot: 5 },
                    PlayerInfo { steam_id: "5".to_string(), name: "CT_Sparse2".to_string(), team: 3, slot: 45 }, // Non-sequential gap, high mask
                ],
                voice_mode: "team",
                self_steam_id: "1", // T_Sparse1 (Team 2)
                // Expected unmuted slots: 0, 12 (low mask) and 33 (high mask)
                // expected_mask_low: (1<<0) | (1<<12) = 1 + 4096 = 4097
                // expected_mask_high: 1<<(33-32) = 1<<1 = 2
                expected_mask_low: 4097,
                expected_mask_high: 2,
                expected_unmuted_count: 3,
            },
        ];

        for scenario in scenarios {
            let result = calculate_voice_masks(
                scenario.voice_mode,
                scenario.self_steam_id,
                &scenario.players,
            );
            assert!(
                result.is_ok(),
                "Scenario '{}' failed to compute: {:?}",
                scenario.name,
                result.err()
            );

            let (mask_low, mask_high, unmuted) = result.unwrap();
            assert_eq!(
                mask_low,
                scenario.expected_mask_low,
                "Scenario '{}' failed on low mask",
                scenario.name
            );
            assert_eq!(
                mask_high,
                scenario.expected_mask_high,
                "Scenario '{}' failed on high mask",
                scenario.name
            );
            assert_eq!(
                unmuted.len(),
                scenario.expected_unmuted_count,
                "Scenario '{}' failed on unmuted count",
                scenario.name
            );
        }
    }
}
