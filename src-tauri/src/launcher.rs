use crate::errors::AppError;
use crate::models::PlayerInfo;
use crate::parser::prepare_demo_path;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::process::Command;

fn copy_file_with_retry(source: &Path, target: &Path) -> std::io::Result<u64> {
    let mut last_error = None;
    for attempt in 1..=5 {
        match std::fs::copy(source, target) {
            Ok(bytes) => return Ok(bytes),
            Err(e) => {
                if e.raw_os_error() == Some(32) {
                    last_error = Some(e);
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

pub fn calculate_voice_masks(
    voice_mode: &str,
    self_team: u8,
    players: &[PlayerInfo],
) -> Result<(i32, i32, Vec<PlayerInfo>), AppError> {
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
            for p in players {
                if p.team == self_team {
                    set_bit(p.slot, &mut mask_low, &mut mask_high);
                    unmuted_players.push(p.clone());
                }
            }
        }
        "opponent" => {
            for p in players {
                if p.team != self_team {
                    set_bit(p.slot, &mut mask_low, &mut mask_high);
                    unmuted_players.push(p.clone());
                }
            }
        }
        _ => return Err(AppError::Parser("Invalid voice mode".to_string())),
    }

    Ok((mask_low, mask_high, unmuted_players))
}

pub fn write_voice_demo_cfg(
    cs2_game_dir: &Path,
    demo_filename: &str,
    voice_mode: &str,
    self_team: u8,
    mask_low: i32,
    mask_high: i32,
    unmuted_players: &[PlayerInfo],
) -> Result<(), AppError> {
    let cfg_dir = cs2_game_dir.join("csgo").join("cfg");
    std::fs::create_dir_all(&cfg_dir)
        .map_err(|e| AppError::Io(format!("Failed to create cfg directory: {}", e)))?;

    let cfg_path = cfg_dir.join("voice_demo.cfg");
    let mut cfg_file =
        File::create(&cfg_path).map_err(|e| AppError::Io(format!("Failed to create cfg file: {}", e)))?;

    let self_team_info = match self_team {
        2 => "Terrorists (T)",
        3 => "Counter-Terrorists (CT)",
        1 => "Spectators (Spec)",
        0 => "Unassigned",
        _ => "Spectators / Others",
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
echo " Team (Me): {}"
echo "--------------------------------------------------"
echo " Unmuted Players:"
{}echo "=================================================="
echo ""
tv_listen_voice_indices {}
tv_listen_voice_indices_h {}
playdemo "demos/{}"
"#,
        voice_mode.to_uppercase(),
        self_team_info,
        unmuted_players_text,
        mask_low,
        mask_high,
        demo_filename
    );

    cfg_file
        .write_all(content.as_bytes())
        .map_err(|e| AppError::Io(format!("Failed to write cfg file content: {}", e)))?;

    Ok(())
}

fn execute_cs2_launch(cs2_game_dir: &Path) -> Result<(), AppError> {
    let cs2_exe = cs2_game_dir.join("bin").join("win64").join("cs2.exe");
    if !cs2_exe.exists() {
        return Err(AppError::Launch("cs2.exe not found".to_string()));
    }

    let steam_path = crate::steam::get_steam_path().ok();

    let launched_via_steam = if let Some(path_buf) = steam_path {
        let steam_exe = path_buf.join("steam.exe");
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
        Command::new(cs2_exe)
            .arg("+exec")
            .arg("voice_demo.cfg")
            .spawn()
            .map_err(|e| AppError::Launch(format!("Failed to start CS2 directly: {}", e)))?;
    }

    Ok(())
}

pub fn launch_cs2_demo_internal(
    demo_path: String,
    voice_mode: String,
    self_team: u8,
    cs2_path: String,
    players: Vec<PlayerInfo>,
) -> Result<String, AppError> {
    let resolved_path = prepare_demo_path(&demo_path)?;
    let demo_file_path = Path::new(&resolved_path);
    if !demo_file_path.exists() {
        return Err(AppError::Launch("Demo file does not exist".to_string()));
    }

    let cs2_game_dir = Path::new(&cs2_path);
    if !cs2_game_dir.exists() {
        return Err(AppError::Launch("CS2 game directory does not exist".to_string()));
    }

    let demos_dir = cs2_game_dir.join("csgo").join("demos");
    std::fs::create_dir_all(&demos_dir)
        .map_err(|e| AppError::Io(format!("Failed to create demos directory: {}", e)))?;

    let filename = demo_file_path
        .file_name()
        .ok_or_else(|| AppError::Launch("Invalid demo path filename".to_string()))?;
    let target_demo_path = demos_dir.join(filename);

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
            AppError::Io(format!(
                "Failed to copy demo file from '{}' to '{}': {}",
                demo_file_path.display(),
                target_demo_path.display(),
                e
            ))
        })?;
    }

    let (mask_low, mask_high, unmuted_players) =
        calculate_voice_masks(&voice_mode, self_team, &players)?;

    let filename_str = filename.to_string_lossy();
    write_voice_demo_cfg(
        cs2_game_dir,
        &filename_str,
        &voice_mode,
        self_team,
        mask_low,
        mask_high,
        &unmuted_players,
    )?;

    use std::os::windows::process::CommandExt;
    let cs2_running = Command::new("tasklist.exe")
        .creation_flags(0x08000000)
        .args(&["/FI", "IMAGENAME eq cs2.exe"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("cs2.exe"))
        .unwrap_or(false);

    if cs2_running {
        return Ok("already_running".to_string());
    }

    execute_cs2_launch(cs2_game_dir)?;

    Ok("launched".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestScenario {
        name: &'static str,
        players: Vec<PlayerInfo>,
        voice_mode: &'static str,
        self_team: u8,
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
                    PlayerInfo {
                        steam_id: "1".to_string(),
                        name: "T1".to_string(),
                        team: 2,
                        slot: 0,
                    },
                    PlayerInfo {
                        steam_id: "2".to_string(),
                        name: "T2".to_string(),
                        team: 2,
                        slot: 1,
                    },
                    PlayerInfo {
                        steam_id: "3".to_string(),
                        name: "T3".to_string(),
                        team: 2,
                        slot: 2,
                    },
                    PlayerInfo {
                        steam_id: "4".to_string(),
                        name: "T4".to_string(),
                        team: 2,
                        slot: 3,
                    },
                    PlayerInfo {
                        steam_id: "5".to_string(),
                        name: "T5".to_string(),
                        team: 2,
                        slot: 32,
                    },
                    PlayerInfo {
                        steam_id: "6".to_string(),
                        name: "CT1".to_string(),
                        team: 3,
                        slot: 4,
                    },
                    PlayerInfo {
                        steam_id: "7".to_string(),
                        name: "CT2".to_string(),
                        team: 3,
                        slot: 5,
                    },
                    PlayerInfo {
                        steam_id: "8".to_string(),
                        name: "CT3".to_string(),
                        team: 3,
                        slot: 6,
                    },
                    PlayerInfo {
                        steam_id: "9".to_string(),
                        name: "CT4".to_string(),
                        team: 3,
                        slot: 7,
                    },
                    PlayerInfo {
                        steam_id: "10".to_string(),
                        name: "CT5".to_string(),
                        team: 3,
                        slot: 33,
                    },
                ],
                voice_mode: "all",
                self_team: 2,
                expected_mask_low: -1,
                expected_mask_high: -1,
                expected_unmuted_count: 10,
            },
            TestScenario {
                name: "Hear no voices (5v5)",
                players: vec![
                    PlayerInfo {
                        steam_id: "1".to_string(),
                        name: "T1".to_string(),
                        team: 2,
                        slot: 0,
                    },
                    PlayerInfo {
                        steam_id: "2".to_string(),
                        name: "T2".to_string(),
                        team: 2,
                        slot: 1,
                    },
                ],
                voice_mode: "none",
                self_team: 2,
                expected_mask_low: 0,
                expected_mask_high: 0,
                expected_unmuted_count: 0,
            },
            TestScenario {
                name: "Hear only team (Self is T in 5v5)",
                players: vec![
                    PlayerInfo {
                        steam_id: "1".to_string(),
                        name: "T1".to_string(),
                        team: 2,
                        slot: 0,
                    },
                    PlayerInfo {
                        steam_id: "2".to_string(),
                        name: "T2".to_string(),
                        team: 2,
                        slot: 1,
                    },
                    PlayerInfo {
                        steam_id: "3".to_string(),
                        name: "T3".to_string(),
                        team: 2,
                        slot: 2,
                    },
                    PlayerInfo {
                        steam_id: "4".to_string(),
                        name: "T4".to_string(),
                        team: 2,
                        slot: 3,
                    },
                    PlayerInfo {
                        steam_id: "5".to_string(),
                        name: "T5".to_string(),
                        team: 2,
                        slot: 32,
                    },
                    PlayerInfo {
                        steam_id: "6".to_string(),
                        name: "CT1".to_string(),
                        team: 3,
                        slot: 4,
                    },
                    PlayerInfo {
                        steam_id: "7".to_string(),
                        name: "CT2".to_string(),
                        team: 3,
                        slot: 5,
                    },
                    PlayerInfo {
                        steam_id: "8".to_string(),
                        name: "CT3".to_string(),
                        team: 3,
                        slot: 6,
                    },
                    PlayerInfo {
                        steam_id: "9".to_string(),
                        name: "CT4".to_string(),
                        team: 3,
                        slot: 7,
                    },
                    PlayerInfo {
                        steam_id: "10".to_string(),
                        name: "CT5".to_string(),
                        team: 3,
                        slot: 33,
                    },
                ],
                voice_mode: "team",
                self_team: 2,
                expected_mask_low: 15,
                expected_mask_high: 1,
                expected_unmuted_count: 5,
            },
            TestScenario {
                name: "Hear only opponents (Self is T in 5v5)",
                players: vec![
                    PlayerInfo {
                        steam_id: "1".to_string(),
                        name: "T1".to_string(),
                        team: 2,
                        slot: 0,
                    },
                    PlayerInfo {
                        steam_id: "2".to_string(),
                        name: "T2".to_string(),
                        team: 2,
                        slot: 1,
                    },
                    PlayerInfo {
                        steam_id: "3".to_string(),
                        name: "T3".to_string(),
                        team: 2,
                        slot: 2,
                    },
                    PlayerInfo {
                        steam_id: "4".to_string(),
                        name: "T4".to_string(),
                        team: 2,
                        slot: 3,
                    },
                    PlayerInfo {
                        steam_id: "5".to_string(),
                        name: "T5".to_string(),
                        team: 2,
                        slot: 32,
                    },
                    PlayerInfo {
                        steam_id: "6".to_string(),
                        name: "CT1".to_string(),
                        team: 3,
                        slot: 4,
                    },
                    PlayerInfo {
                        steam_id: "7".to_string(),
                        name: "CT2".to_string(),
                        team: 3,
                        slot: 5,
                    },
                    PlayerInfo {
                        steam_id: "8".to_string(),
                        name: "CT3".to_string(),
                        team: 3,
                        slot: 6,
                    },
                    PlayerInfo {
                        steam_id: "9".to_string(),
                        name: "CT4".to_string(),
                        team: 3,
                        slot: 7,
                    },
                    PlayerInfo {
                        steam_id: "10".to_string(),
                        name: "CT5".to_string(),
                        team: 3,
                        slot: 33,
                    },
                ],
                voice_mode: "opponent",
                self_team: 2,
                expected_mask_low: 240,
                expected_mask_high: 2,
                expected_unmuted_count: 5,
            },
            TestScenario {
                name: "Boundary slots check (0, 31, 32, 63)",
                players: vec![
                    PlayerInfo {
                        steam_id: "1".to_string(),
                        name: "Me".to_string(),
                        team: 2,
                        slot: 0,
                    },
                    PlayerInfo {
                        steam_id: "2".to_string(),
                        name: "Teammate1".to_string(),
                        team: 2,
                        slot: 31,
                    },
                    PlayerInfo {
                        steam_id: "3".to_string(),
                        name: "Teammate2".to_string(),
                        team: 2,
                        slot: 32,
                    },
                    PlayerInfo {
                        steam_id: "4".to_string(),
                        name: "Teammate3".to_string(),
                        team: 2,
                        slot: 63,
                    },
                    PlayerInfo {
                        steam_id: "5".to_string(),
                        name: "Enemy".to_string(),
                        team: 3,
                        slot: 5,
                    },
                ],
                voice_mode: "team",
                self_team: 2,
                expected_mask_low: -2147483647,
                expected_mask_high: -2147483647,
                expected_unmuted_count: 4,
            },
            TestScenario {
                name: "Uneven team sizes (7 vs 3)",
                players: vec![
                    PlayerInfo {
                        steam_id: "1".to_string(),
                        name: "T1".to_string(),
                        team: 2,
                        slot: 0,
                    },
                    PlayerInfo {
                        steam_id: "2".to_string(),
                        name: "T2".to_string(),
                        team: 2,
                        slot: 1,
                    },
                    PlayerInfo {
                        steam_id: "3".to_string(),
                        name: "T3".to_string(),
                        team: 2,
                        slot: 2,
                    },
                    PlayerInfo {
                        steam_id: "4".to_string(),
                        name: "T4".to_string(),
                        team: 2,
                        slot: 3,
                    },
                    PlayerInfo {
                        steam_id: "5".to_string(),
                        name: "T5".to_string(),
                        team: 2,
                        slot: 4,
                    },
                    PlayerInfo {
                        steam_id: "6".to_string(),
                        name: "T6".to_string(),
                        team: 2,
                        slot: 10,
                    },
                    PlayerInfo {
                        steam_id: "7".to_string(),
                        name: "T7".to_string(),
                        team: 2,
                        slot: 11,
                    },
                    PlayerInfo {
                        steam_id: "8".to_string(),
                        name: "CT1".to_string(),
                        team: 3,
                        slot: 5,
                    },
                    PlayerInfo {
                        steam_id: "9".to_string(),
                        name: "CT2".to_string(),
                        team: 3,
                        slot: 6,
                    },
                    PlayerInfo {
                        steam_id: "10".to_string(),
                        name: "CT3".to_string(),
                        team: 3,
                        slot: 7,
                    },
                ],
                voice_mode: "team",
                self_team: 3,
                expected_mask_low: 224,
                expected_mask_high: 0,
                expected_unmuted_count: 3,
            },
            TestScenario {
                name: "Spectator and unassigned team filtering",
                players: vec![
                    PlayerInfo {
                        steam_id: "1".to_string(),
                        name: "Me".to_string(),
                        team: 2,
                        slot: 0,
                    },
                    PlayerInfo {
                        steam_id: "2".to_string(),
                        name: "Teammate".to_string(),
                        team: 2,
                        slot: 1,
                    },
                    PlayerInfo {
                        steam_id: "3".to_string(),
                        name: "Spec".to_string(),
                        team: 1,
                        slot: 2,
                    },
                    PlayerInfo {
                        steam_id: "4".to_string(),
                        name: "Unassigned".to_string(),
                        team: 0,
                        slot: 3,
                    },
                ],
                voice_mode: "team",
                self_team: 2,
                expected_mask_low: 3,
                expected_mask_high: 0,
                expected_unmuted_count: 2,
            },
            TestScenario {
                name: "Non-sequential (sparse) slots check",
                players: vec![
                    PlayerInfo {
                        steam_id: "1".to_string(),
                        name: "T_Sparse1".to_string(),
                        team: 2,
                        slot: 0,
                    },
                    PlayerInfo {
                        steam_id: "2".to_string(),
                        name: "T_Sparse2".to_string(),
                        team: 2,
                        slot: 12,
                    },
                    PlayerInfo {
                        steam_id: "3".to_string(),
                        name: "T_Sparse3".to_string(),
                        team: 2,
                        slot: 33,
                    },
                    PlayerInfo {
                        steam_id: "4".to_string(),
                        name: "CT_Sparse1".to_string(),
                        team: 3,
                        slot: 5,
                    },
                    PlayerInfo {
                        steam_id: "5".to_string(),
                        name: "CT_Sparse2".to_string(),
                        team: 3,
                        slot: 45,
                    },
                ],
                voice_mode: "team",
                self_team: 2,
                expected_mask_low: 4097,
                expected_mask_high: 2,
                expected_unmuted_count: 3,
            },
        ];

        for scenario in scenarios {
            let result = calculate_voice_masks(
                scenario.voice_mode,
                scenario.self_team,
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
                mask_low, scenario.expected_mask_low,
                "Scenario '{}' failed on low mask",
                scenario.name
            );
            assert_eq!(
                mask_high, scenario.expected_mask_high,
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

    #[test]
    fn test_write_voice_demo_cfg_output() {
        let temp_dir = std::env::temp_dir().join("cs2_demo_opener_test_cfg");
        std::fs::create_dir_all(&temp_dir).unwrap();

        let players = vec![
            PlayerInfo {
                steam_id: "1".to_string(),
                name: "CT1".to_string(),
                team: 3,
                slot: 0,
            },
        ];

        let result = write_voice_demo_cfg(
            &temp_dir,
            "test_match.dem",
            "team",
            3,
            1,
            0,
            &players,
        );

        assert!(result.is_ok());

        let cfg_path = temp_dir.join("csgo").join("cfg").join("voice_demo.cfg");
        assert!(cfg_path.exists());

        let content = std::fs::read_to_string(&cfg_path).unwrap();
        assert!(content.contains("Voice Mode: TEAM"));
        assert!(content.contains("Team (Me): Counter-Terrorists (CT)"));
        assert!(content.contains("tv_listen_voice_indices 1"));
        assert!(content.contains("tv_listen_voice_indices_h 0"));
        assert!(content.contains("playdemo \"demos/test_match.dem\""));

        // Clean up
        let _ = std::fs::remove_dir_all(temp_dir);
    }
}
