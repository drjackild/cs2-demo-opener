use crate::errors::AppError;
use crate::models::SteamUser;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use winreg::enums::*;
use winreg::RegKey;

const STEAM_ID64_INDIVIDUAL_PREFIX: &str = "7656119";

pub fn get_steam_path() -> Result<PathBuf, AppError> {
    static STEAM_PATH_CACHE: std::sync::OnceLock<Result<String, String>> =
        std::sync::OnceLock::new();
    let res = STEAM_PATH_CACHE.get_or_init(|| {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let steam_key = hkcu
            .open_subkey(r"Software\Valve\Steam")
            .map_err(|e| format!("Steam registry key not found: {}", e))?;
        let path: String = steam_key
            .get_value("SteamPath")
            .map_err(|e| format!("SteamPath value not found in registry: {}", e))?;
        Ok(path)
    });

    match res {
        Ok(s) => Ok(PathBuf::from(s)),
        Err(e) => Err(AppError::Registry(e.clone())),
    }
}

pub fn parse_loginusers_vdf_path(path: &Path) -> Result<Vec<SteamUser>, AppError> {
    let file = File::open(path)
        .map_err(|e| AppError::Io(format!("Failed to open loginusers.vdf: {}", e)))?;
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
            if id.starts_with(STEAM_ID64_INDIVIDUAL_PREFIX)
                && id.chars().all(|c| c.is_ascii_digit())
            {
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

pub fn get_steam_user_info_internal() -> Result<Vec<SteamUser>, AppError> {
    let steam_path = get_steam_path()?;
    let path = steam_path.join("config").join("loginusers.vdf");
    parse_loginusers_vdf_path(&path)
}

pub fn detect_cs2_path_internal() -> Result<Option<String>, AppError> {
    let steam_path = get_steam_path()?;

    let mut libraries = vec![steam_path.to_string_lossy().into_owned()];
    let lib_vdf = steam_path.join("steamapps").join("libraryfolders.vdf");
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
                        libraries.push(parts[3].replace("\\\\", "\\"));
                    }
                }
            }
        }
    }

    for lib in libraries {
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

pub fn resolve_steam_name_internal(steam_id: &str) -> Result<String, AppError> {
    let url = format!("https://steamcommunity.com/profiles/{}/?xml=1", steam_id);
    let response = ureq::get(&url)
        .call()
        .map_err(|e| AppError::Launch(format!("Request failed: {}", e)))?
        .into_string()
        .map_err(|e| AppError::Launch(format!("Failed to read response: {}", e)))?;

    if let Some(start_idx) = response.find("<steamID><![CDATA[") {
        let after_start = &response[start_idx + "<steamID><![CDATA[".len()..];
        if let Some(end_idx) = after_start.find("]]></steamID>") {
            let name = &after_start[..end_idx];
            return Ok(name.to_string());
        }
    }

    Err(AppError::Parser(
        "Steam ID not found in profile".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_parse_loginusers_vdf_mocked() {
        let vdf_content = r#"
"users"
{
	"76561198000000001"
	{
		"AccountName"		"test_user1"
		"PersonaName"		"Test Persona 1"
		"RememberPassword"		"1"
		"MostRecent"		"1"
		"Timestamp"		"1700000000"
	}
	"76561198000000002"
	{
		"AccountName"		"test_user2"
		"PersonaName"		"Test Persona 2"
		"RememberPassword"		"1"
		"MostRecent"		"0"
		"Timestamp"		"1700000001"
	}
}
"#;
        let temp_dir = std::env::temp_dir().join("cs2_demo_opener_test_steam");
        std::fs::create_dir_all(&temp_dir).unwrap();
        let config_dir = temp_dir.join("config");
        std::fs::create_dir_all(&config_dir).unwrap();
        let vdf_path = config_dir.join("loginusers.vdf");

        let mut file = File::create(&vdf_path).unwrap();
        file.write_all(vdf_content.as_bytes()).unwrap();

        let users = parse_loginusers_vdf_path(&vdf_path).unwrap();
        assert_eq!(users.len(), 2);
        assert_eq!(users[0].steam_id, "76561198000000001");
        assert_eq!(users[0].persona_name, "Test Persona 1");
        assert_eq!(users[1].steam_id, "76561198000000002");
        assert_eq!(users[1].persona_name, "Test Persona 2");

        // Clean up
        let _ = std::fs::remove_file(vdf_path);
        let _ = std::fs::remove_dir_all(temp_dir);
    }
}
