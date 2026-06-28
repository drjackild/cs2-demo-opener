use crate::errors::AppError;
use std::fs::File;
use tauri::{AppHandle, Manager};

const BASE_URL: &str = "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/radars";

pub fn check_map_assets_internal(app: &AppHandle, map_name: &str) -> Result<bool, AppError> {
    let mut data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(format!("Could not resolve app data dir: {}", e)))?;
    data_dir.push("radars");
    data_dir.push(format!("{}.png", map_name));

    Ok(data_dir.exists())
}

pub fn get_map_radar_base64_internal(app: &AppHandle, map_name: &str) -> Result<String, AppError> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let mut data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(format!("Could not resolve app data dir: {}", e)))?;
    data_dir.push("radars");
    data_dir.push(format!("{}.png", map_name));

    if !data_dir.exists() {
        return Err(AppError::Io(format!(
            "Radar image not found for map: {}",
            map_name
        )));
    }

    let bytes = std::fs::read(&data_dir)
        .map_err(|e| AppError::Io(format!("Failed to read radar image: {}", e)))?;
    let b64 = STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

pub fn get_lower_map_radar_base64_internal(
    app: &AppHandle,
    map_name: &str,
) -> Result<String, AppError> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let mut data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(format!("Could not resolve app data dir: {}", e)))?;
    data_dir.push("radars");
    data_dir.push(format!("{}_lower.png", map_name));

    if !data_dir.exists() {
        return Err(AppError::Io(format!(
            "Lower radar image not found for map: {}",
            map_name
        )));
    }

    let bytes = std::fs::read(&data_dir)
        .map_err(|e| AppError::Io(format!("Failed to read radar image: {}", e)))?;
    let b64 = STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

pub fn download_map_assets_internal(app: &AppHandle, map_name: &str) -> Result<(), AppError> {
    let mut data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(format!("Could not resolve app data dir: {}", e)))?;
    data_dir.push("radars");
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| AppError::Io(format!("Failed to create radars dir: {}", e)))?;

    data_dir.push(format!("{}.png", map_name));

    // Fast-path if already exists
    if data_dir.exists() {
        return Ok(());
    }

    let suffixes = ["_radar_psd", "_radar", "_radar_tga", ""];
    
    // 1. Download the main map
    for suffix in suffixes.iter() {
        let url = format!("{}/{}{}.png", BASE_URL, map_name, suffix);
        println!("[Rust Backend] Trying map asset from {}", url);

        match ureq::get(&url).call() {
            Ok(response) => {
                if response.status() == 200 {
                    let mut reader = response.into_reader();
                    let mut file = File::create(&data_dir)
                        .map_err(|e| AppError::Io(format!("Failed to create file: {}", e)))?;
                    std::io::copy(&mut reader, &mut file)
                        .map_err(|e| AppError::Io(format!("Failed to save radar: {}", e)))?;
                    break;
                }
            },
            Err(ureq::Error::Status(_, _)) => {
            },
            Err(e) => {
                println!("[Rust Backend] Download failed {}: {:?}", url, e);
            }
        }
    }

    if !data_dir.exists() {
        return Err(AppError::Io("Failed to download map assets: network connection error or map not found on server.".to_string()));
    }

    // Attempt to download the _lower map (e.g. de_nuke_lower)
    let lower_map_name = format!("{}_lower", map_name);
    let mut lower_data_dir = app.path().app_data_dir().unwrap();
    lower_data_dir.push("radars");
    lower_data_dir.push(format!("{}.png", lower_map_name));

    if !lower_data_dir.exists() {
        for suffix in suffixes.iter() {
            let url = format!("{}/{}{}.png", BASE_URL, lower_map_name, suffix);
            println!("[Rust Backend] Trying lower map asset from {}", url);

            if let Ok(response) = ureq::get(&url).call() {
                if response.status() == 200 {
                    let mut reader = response.into_reader();
                    if let Ok(mut file) = File::create(&lower_data_dir) {
                        let _ = std::io::copy(&mut reader, &mut file);
                        println!("[Rust Backend] Successfully downloaded lower map variant!");
                    }
                    break;
                }
            }
        }
    }

    Ok(())
}
