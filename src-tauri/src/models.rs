use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct SteamUser {
    pub steam_id: String,
    pub persona_name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PlayerInfo {
    pub steam_id: String,
    pub name: String,
    pub team: u8,
    pub slot: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ParseResult {
    pub players: Vec<PlayerInfo>,
    pub uncompressed_path: String,
    pub map_name: String,
}
