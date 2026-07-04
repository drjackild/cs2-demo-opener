use crate::errors::AppError;
use std::fs::File;
use tauri::{AppHandle, Manager};

const BASE_URL: &str = "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/radars";

fn get_cached_etags(app: &AppHandle) -> serde_json::Value {
    let mut path = match app.path().app_data_dir() {
        Ok(p) => p,
        Err(_) => return serde_json::json!({}),
    };
    path.push("radars");
    path.push("metadata.json");

    if !path.exists() {
        return serde_json::json!({});
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return serde_json::json!({}),
    };

    serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
}

fn save_etag(app: &AppHandle, map_name: &str, etag: &str) {
    let mut path = match app.path().app_data_dir() {
        Ok(p) => p,
        Err(_) => return,
    };
    path.push("radars");

    // Create radars directory if it doesn't exist
    if let Err(_) = std::fs::create_dir_all(&path) {
        return;
    }

    path.push("metadata.json");

    let mut etags = get_cached_etags(app);
    if let Some(obj) = etags.as_object_mut() {
        obj.insert(map_name.to_string(), serde_json::json!(etag));
        if let Ok(content) = serde_json::to_string_pretty(&etags) {
            let _ = std::fs::write(&path, content);
        }
    }
}

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

    let cached_etags = get_cached_etags(app);
    let cached_etag = cached_etags.get(map_name).and_then(|v| v.as_str());

    let suffixes = ["_radar_psd", "_radar", "_radar_tga", ""];
    let mut map_url = None;
    let mut remote_etag = None;

    // 1. Check HEAD request to verify ETag of the main map
    for suffix in suffixes.iter() {
        let url = format!("{}/{}{}.png", BASE_URL, map_name, suffix);
        match ureq::head(&url).call() {
            Ok(response) => {
                if response.status() == 200 {
                    let etag = response.header("etag").unwrap_or_default().to_string();
                    map_url = Some(url);
                    if !etag.is_empty() {
                        remote_etag = Some(etag);
                    }
                    break;
                }
            }
            Err(ureq::Error::Status(404, _)) => {
                // Try next suffix
            }
            Err(e) => {
                println!("[Rust Backend] HEAD request failed for {}: {:?}", url, e);
                // On offline/connection error, continue or fall back
            }
        }
    }

    let mut skip_download = false;
    if data_dir.exists() {
        if map_url.is_none() {
            // Offline fallback: Use cached local map if we can't check online status
            println!("[Rust Backend] Offline fallback: Using cached radar for {}", map_name);
            skip_download = true;
        } else if let (Some(ref r_etag), Some(c_etag)) = (&remote_etag, cached_etag) {
            if r_etag == c_etag {
                println!("[Rust Backend] Radar for {} is up to date (ETag matches)", map_name);
                skip_download = true;
            }
        }
    }

    if !skip_download {
        if let Some(url) = &map_url {
            println!("[Rust Backend] Downloading fresh map asset from {}", url);
            match ureq::get(url).call() {
                Ok(response) => {
                    if response.status() == 200 {
                        let mut reader = response.into_reader();
                        let mut file = File::create(&data_dir)
                            .map_err(|e| AppError::Io(format!("Failed to create file: {}", e)))?;
                        std::io::copy(&mut reader, &mut file)
                            .map_err(|e| AppError::Io(format!("Failed to save radar: {}", e)))?;
                        
                        if let Some(etag) = &remote_etag {
                            save_etag(app, map_name, etag);
                        }
                    }
                }
                Err(e) => {
                    println!("[Rust Backend] Download failed for {}: {:?}", url, e);
                }
            }
        }
    }

    if !data_dir.exists() {
        return Err(AppError::Io("Failed to download map assets: network connection error or map not found on server.".to_string()));
    }

    // 2. Attempt to download/update the _lower map (e.g. de_nuke_lower)
    let lower_map_name = format!("{}_lower", map_name);
    let mut lower_data_dir = app.path().app_data_dir().unwrap();
    lower_data_dir.push("radars");
    lower_data_dir.push(format!("{}.png", lower_map_name));

    let lower_cached_etag = cached_etags.get(&lower_map_name).and_then(|v| v.as_str());
    let mut lower_url = None;
    let mut lower_remote_etag = None;

    for suffix in suffixes.iter() {
        let url = format!("{}/{}{}.png", BASE_URL, lower_map_name, suffix);
        match ureq::head(&url).call() {
            Ok(response) => {
                if response.status() == 200 {
                    let etag = response.header("etag").unwrap_or_default().to_string();
                    lower_url = Some(url);
                    if !etag.is_empty() {
                        lower_remote_etag = Some(etag);
                    }
                    break;
                }
            }
            Err(ureq::Error::Status(404, _)) => {}
            Err(_) => {}
        }
    }

    let mut skip_lower_download = false;
    if lower_data_dir.exists() {
        if lower_url.is_none() {
            // Offline fallback
            skip_lower_download = true;
        } else if let (Some(ref r_etag), Some(c_etag)) = (&lower_remote_etag, lower_cached_etag) {
            if r_etag == c_etag {
                println!("[Rust Backend] Lower radar for {} is up to date (ETag matches)", map_name);
                skip_lower_download = true;
            }
        }
    }

    if !skip_lower_download {
        if let Some(url) = &lower_url {
            println!("[Rust Backend] Downloading fresh lower map asset from {}", url);
            if let Ok(response) = ureq::get(url).call() {
                if response.status() == 200 {
                    let mut reader = response.into_reader();
                    if let Ok(mut file) = File::create(&lower_data_dir) {
                        let _ = std::io::copy(&mut reader, &mut file);
                        if let Some(etag) = &lower_remote_etag {
                            save_etag(app, &lower_map_name, etag);
                        }
                    }
                }
            }
        }
    }

    Ok(())
}
