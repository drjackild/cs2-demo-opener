use source2_demo::prelude::*;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

pub static CANCEL_PARSING: AtomicBool = AtomicBool::new(false);
use serde::{Deserialize, Serialize};

pub mod pb {
    include!("cs2_demo.rs");
}

static WEAPON_PROP_KEYS: OnceLock<Vec<String>> = OnceLock::new();

fn get_weapon_prop_keys() -> &'static [String] {
    WEAPON_PROP_KEYS.get_or_init(|| {
        (0..64)
            .map(|i| format!("m_pWeaponServices.m_hMyWeapons.{:04}", i))
            .collect()
    })
}

const ENT_INDEX_MASK: u32 = 0x3FFF;
const COORD_CELL_OFFSET: f32 = 32.0;
const COORD_CELL_SCALE: f32 = 512.0;
const TEAM_T: u8 = 2;
const TEAM_CT: u8 = 3;

fn resolve_entity_coords(ent: &source2_demo::prelude::Entity) -> (f32, f32, f32) {
    let cell_x: u64 =
        source2_demo::prelude::try_property!(ent, "CBodyComponent.m_cellX").unwrap_or(0);
    let vec_x: f32 =
        source2_demo::prelude::try_property!(ent, "CBodyComponent.m_vecX").unwrap_or(0.0);
    let cell_y: u64 =
        source2_demo::prelude::try_property!(ent, "CBodyComponent.m_cellY").unwrap_or(0);
    let vec_y: f32 =
        source2_demo::prelude::try_property!(ent, "CBodyComponent.m_vecY").unwrap_or(0.0);
    let cell_z: u64 =
        source2_demo::prelude::try_property!(ent, "CBodyComponent.m_cellZ").unwrap_or(0);
    let vec_z: f32 =
        source2_demo::prelude::try_property!(ent, "CBodyComponent.m_vecZ").unwrap_or(0.0);

    let x = ((cell_x as f32) - COORD_CELL_OFFSET) * COORD_CELL_SCALE + vec_x;
    let y = ((cell_y as f32) - COORD_CELL_OFFSET) * COORD_CELL_SCALE + vec_y;
    let z = ((cell_z as f32) - COORD_CELL_OFFSET) * COORD_CELL_SCALE + vec_z;
    (x, y, z)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlayerTickData {
    pub steam_id: String,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub yaw: f32,
    pub is_alive: bool,
    pub hp: i32,
    pub team: u8,
    pub name: String,
    pub armor: i32,
    pub has_helmet: bool,
    pub has_defuser: bool,
    pub parsed_first_frame: bool,
    pub active_weapon: String,
    pub inventory: Vec<String>,
    pub has_bomb: bool,
    pub is_defusing: bool,
    pub flash_duration: f32,
    pub flash_max_alpha: f32,
    pub kills: i32,
    pub deaths: i32,
    pub assists: i32,
    pub money: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GrenadeTickData {
    pub id: u32,
    pub class_name: String,
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GameEventTickData {
    pub event_type: String, // "weapon_fire", "hegrenade_detonate", "flashbang_detonate", "smokegrenade_detonate", "inferno_startburn", "player_blind", "player_death"
    pub user_id: u32,
    pub entityid: u32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub yaw: f32,
    pub weapon: String,
    pub blind_duration: f32,
    pub team: u8,
    pub steam_id: String,
    pub attacker_id: String,
    pub assister_id: String,
    pub headshot: bool,
    pub penetrated: i32,
    pub thrusmoke: bool,
    pub noscope: bool,
    pub attackerblind: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TickData {
    pub tick: u32,
    pub players: Vec<PlayerTickData>,
    pub grenades: Vec<GrenadeTickData>,
    pub events: Vec<GameEventTickData>,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct RoundChunk {
    pub round: u32,
    pub start_tick: u32,
    pub end_tick: u32,
    pub ticks: Vec<TickData>,
    pub initial_teams: HashMap<String, u8>,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct RoundResult {
    pub round_number: u32,
    pub start_tick: u32,
    pub end_tick: u32,
    pub winner: u8,
    pub reason: u8,
}

#[derive(Default)]
pub struct Parser2D {
    pub chunks: Vec<RoundChunk>,
    pub current_round: u32,
    pub current_ticks: Vec<TickData>,
    pub save_dir: PathBuf,
    pub demo_name: String,
    pub active_controllers: HashMap<usize, u32>,
    pub progress_callback: Option<Box<dyn Fn(u32) + Send + Sync>>, // For emitting progress
    pub total_ticks: u32,
    pub game_rules_idx: Option<u32>,
    pub last_total_rounds: i32,
    pub pending_round_save: bool,
    pub match_restarted: bool,
    pub last_freeze: bool,
    pub initial_teams: HashMap<String, u8>,
    pub pending_events: Vec<GameEventTickData>,
    pub last_thrown_inferno: HashMap<usize, String>,
    pub round_results: Vec<RoundResult>,
    pub match_ended: bool,
    pub dead_players_this_round: HashSet<String>,
}

impl Parser2D {
    fn save_current_chunk(&mut self, end_tick: u32) {
        if self.current_ticks.is_empty() {
            return;
        }
        let chunk = RoundChunk {
            round: self.current_round,
            start_tick: self.current_ticks.first().map(|t| t.tick).unwrap_or(0),
            end_tick,
            ticks: self.current_ticks.clone(),
            initial_teams: self.initial_teams.clone(),
        };

        // Construct player metadata mapping
        let mut players_metadata = Vec::new();
        let mut steam_id_to_id = HashMap::new();
        let mut next_id = 0;

        for tick in &chunk.ticks {
            for p in &tick.players {
                if !steam_id_to_id.contains_key(&p.steam_id) {
                    steam_id_to_id.insert(p.steam_id.clone(), next_id);
                    players_metadata.push(pb::PlayerMetadata {
                        id: next_id as u32,
                        steam_id: p.steam_id.clone(),
                        name: p.name.clone(),
                        team: p.team as u32,
                    });
                    next_id += 1;
                }
            }
        }

        // Build serialized ticks using protobuf structs
        let mut serialized_ticks = Vec::new();
        for tick in &chunk.ticks {
            let mut serialized_players = Vec::new();
            for p in &tick.players {
                if let Some(&pid) = steam_id_to_id.get(&p.steam_id) {
                    serialized_players.push(pb::PlayerTickData {
                        player_id: pid as u32,
                        x: p.x,
                        y: p.y,
                        z: p.z,
                        yaw: p.yaw,
                        is_alive: p.is_alive,
                        hp: p.hp,
                        armor: p.armor,
                        has_helmet: p.has_helmet,
                        has_defuser: p.has_defuser,
                        parsed_first_frame: p.parsed_first_frame,
                        active_weapon: p.active_weapon.clone(),
                        inventory: p.inventory.clone(),
                        has_bomb: p.has_bomb,
                        is_defusing: p.is_defusing,
                        flash_duration: p.flash_duration,
                        flash_max_alpha: p.flash_max_alpha,
                        kills: p.kills,
                        deaths: p.deaths,
                        assists: p.assists,
                        money: p.money,
                    });
                }
            }

            let mut serialized_grenades = Vec::new();
            for g in &tick.grenades {
                serialized_grenades.push(pb::GrenadeTickData {
                    id: g.id,
                    class_name: g.class_name.clone(),
                    x: g.x,
                    y: g.y,
                    z: g.z,
                });
            }

            let mut serialized_events = Vec::new();
            for e in &tick.events {
                serialized_events.push(pb::GameEventTickData {
                    event_type: e.event_type.clone(),
                    user_id: e.user_id,
                    entityid: e.entityid,
                    x: e.x,
                    y: e.y,
                    z: e.z,
                    yaw: e.yaw,
                    weapon: e.weapon.clone(),
                    blind_duration: e.blind_duration,
                    team: e.team as u32,
                    steam_id: e.steam_id.clone(),
                    attacker_id: e.attacker_id.clone(),
                    assister_id: e.assister_id.clone(),
                    headshot: e.headshot,
                    penetrated: e.penetrated,
                    thrusmoke: e.thrusmoke,
                    noscope: e.noscope,
                    attackerblind: e.attackerblind,
                });
            }

            serialized_ticks.push(pb::TickData {
                tick: tick.tick,
                players: serialized_players,
                grenades: serialized_grenades,
                events: serialized_events,
            });
        }

        let serialized_chunk = pb::RoundChunk {
            round: chunk.round,
            start_tick: chunk.start_tick,
            end_tick: chunk.end_tick,
            ticks: serialized_ticks,
            initial_teams: chunk.initial_teams.iter().map(|(k, &v)| (k.clone(), v as u32)).collect(),
            players_metadata,
        };

        let chunk_path = self.save_dir.join(format!(
            "{}_round_{}.pb",
            self.demo_name, self.current_round
        ));

        use prost::Message;
        let mut buf = Vec::new();
        if serialized_chunk.encode(&mut buf).is_ok() {
            let _ = std::fs::write(chunk_path, buf);
        }

        self.chunks.push(chunk);
        self.current_ticks.clear();
        self.current_round += 1;
    }

    pub fn force_flush(&mut self) {
        if !self.current_ticks.is_empty() {
            let last_tick = self.current_ticks.last().map(|t| t.tick).unwrap_or(0);

            // If the demo cut off before the 'round_end' event was fired, the UI won't know this round exists.
            // We append a dummy result so the frontend timeline creates a button for it.
            if !self.match_ended {
                let last_round_in_results = self
                    .round_results
                    .last()
                    .map(|r| r.round_number)
                    .unwrap_or(0);
                if last_round_in_results != self.current_round {
                    let start_tick = self.current_ticks.first().map(|t| t.tick).unwrap_or(0);
                    self.round_results.push(RoundResult {
                        round_number: self.current_round,
                        start_tick,
                        end_tick: last_tick,
                        winner: 0,
                        reason: 0,
                    });
                }
            }

            self.save_current_chunk(last_tick);
        }
    }

    fn flush_latest_kda_to_last_tick(&mut self, ctx: &Context) {
        if let Some(last_tick) = self.current_ticks.last_mut() {
            for p in &mut last_tick.players {
                for idx in 1..2048 {
                    if let Ok(controller) = ctx.entities().get_by_index(idx) {
                        if controller.class().name() == "CCSPlayerController" {
                            let steam_id: u64 =
                                source2_demo::prelude::try_property!(controller, u64, "m_steamID")
                                    .unwrap_or(0);
                            let final_steam_id = if steam_id != 0 {
                                steam_id.to_string()
                            } else {
                                format!("player_{}", controller.index())
                            };
                            if final_steam_id == p.steam_id {
                                let mut kills = 0;
                                for prop in [
                                    "m_pActionTrackingServices.m_matchStats.m_iKills",
                                    "m_matchStats.m_iKills",
                                    "m_pActionTrackingServices.m_iKills",
                                    "m_iKills",
                                ] {
                                    if let Some(val) = try_get_int_property(&controller, prop) {
                                        kills = val;
                                        break;
                                    }
                                }
                                let mut deaths = 0;
                                for prop in [
                                    "m_pActionTrackingServices.m_matchStats.m_iDeaths",
                                    "m_matchStats.m_iDeaths",
                                    "m_pActionTrackingServices.m_iDeaths",
                                    "m_iDeaths",
                                ] {
                                    if let Some(val) = try_get_int_property(&controller, prop) {
                                        deaths = val;
                                        break;
                                    }
                                }
                                let mut assists = 0;
                                for prop in [
                                    "m_pActionTrackingServices.m_matchStats.m_iAssists",
                                    "m_matchStats.m_iAssists",
                                    "m_pActionTrackingServices.m_iAssists",
                                    "m_iAssists",
                                ] {
                                    if let Some(val) = try_get_int_property(&controller, prop) {
                                        assists = val;
                                        break;
                                    }
                                }
                                p.kills = kills;
                                p.deaths = deaths;
                                p.assists = assists;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
}
fn get_weapon_name(wep: &source2_demo::prelude::Entity) -> String {
    let name_raw = wep.class().name();
    let wep_name = if let Some(stripped) = name_raw.strip_prefix("CWeapon") {
        stripped.to_string()
    } else if let Some(stripped) = name_raw.strip_prefix('C') {
        stripped.to_string()
    } else {
        name_raw.to_string()
    };

    let mut item_val_opt = wep.get_property("m_AttributeManager.m_Item.m_iItemDefinitionIndex");
    if item_val_opt.is_err() {
        item_val_opt = wep.get_property("m_iItemDefinitionIndex");
    }

    if let Ok(item_val) = item_val_opt {
        let def_index = match item_val {
            source2_demo::prelude::FieldValue::Signed32(v) => *v as u32,
            source2_demo::prelude::FieldValue::Unsigned32(v) => *v,
            source2_demo::prelude::FieldValue::Signed16(v) => *v as u32,
            source2_demo::prelude::FieldValue::Unsigned16(v) => *v as u32,
            _ => 0,
        };

        match def_index {
            42 => return "knife".to_string(),
            59 => return "knife_t".to_string(),
            500 => return "knife_bayonet".to_string(),
            503 => return "knife_css".to_string(),
            505 => return "knife_flip".to_string(),
            506 => return "knife_gut".to_string(),
            507 => return "knife_karambit".to_string(),
            508 => return "knife_m9_bayonet".to_string(),
            509 => return "knife_tactical".to_string(),
            512 => return "knife_falchion".to_string(),
            514 => return "knife_survival_bowie".to_string(),
            515 => return "knife_butterfly".to_string(),
            516 => return "knife_push".to_string(),
            519 => return "knife_ursus".to_string(),
            520 => return "knife_gypsy_jackknife".to_string(),
            522 => return "knife_stiletto".to_string(),
            523 => return "knife_widowmaker".to_string(),
            525 => return "knife_skeleton".to_string(),
            526 => return "knife_outdoor".to_string(),
            527 => return "knife_canis".to_string(),
            528 => return "knife_cord".to_string(),
            529 => return "knife_kukri".to_string(),
            530 => return "knife_twinblade".to_string(),
            60 => return "m4a1_silencer".to_string(),
            61 => return "usp_silencer".to_string(),
            63 => return "cz75a".to_string(),
            64 => return "revolver".to_string(),
            _ => {}
        }
    }
    wep_name
}

fn get_int_property(ent: &source2_demo::prelude::Entity, prop: &str) -> i32 {
    if let Ok(val) = ent.get_property(prop) {
        match val {
            source2_demo::prelude::FieldValue::Signed32(v) => *v,
            source2_demo::prelude::FieldValue::Unsigned32(v) => *v as i32,
            source2_demo::prelude::FieldValue::Signed16(v) => *v as i32,
            source2_demo::prelude::FieldValue::Unsigned16(v) => *v as i32,
            source2_demo::prelude::FieldValue::Signed8(v) => *v as i32,
            source2_demo::prelude::FieldValue::Unsigned8(v) => *v as i32,
            source2_demo::prelude::FieldValue::Signed64(v) => *v as i32,
            source2_demo::prelude::FieldValue::Unsigned64(v) => *v as i32,
            _ => 0,
        }
    } else {
        0
    }
}

fn try_get_int_property(ent: &source2_demo::prelude::Entity, prop: &str) -> Option<i32> {
    if let Ok(val) = ent.get_property(prop) {
        match val {
            source2_demo::prelude::FieldValue::Signed32(v) => Some(*v),
            source2_demo::prelude::FieldValue::Unsigned32(v) => Some(*v as i32),
            source2_demo::prelude::FieldValue::Signed16(v) => Some(*v as i32),
            source2_demo::prelude::FieldValue::Unsigned16(v) => Some(*v as i32),
            source2_demo::prelude::FieldValue::Signed8(v) => Some(*v as i32),
            source2_demo::prelude::FieldValue::Unsigned8(v) => Some(*v as i32),
            source2_demo::prelude::FieldValue::Signed64(v) => Some(*v as i32),
            source2_demo::prelude::FieldValue::Unsigned64(v) => Some(*v as i32),
            _ => None,
        }
    } else {
        None
    }
}

fn get_steamid_from_userid(ctx: &source2_demo::prelude::Context, userid: u32) -> String {
    if let Ok(controller) = ctx.entities().get_by_index((userid + 1) as usize) {
        if controller.class().name() == "CCSPlayerController" {
            let steam_id: u64 =
                source2_demo::prelude::try_property!(controller, u64, "m_steamID").unwrap_or(0);
            let mut final_steam_id = steam_id.to_string();
            if final_steam_id == "0" {
                final_steam_id = format!("player_{}", controller.index());
            }
            return final_steam_id;
        }
    }
    String::new()
}

#[observer]
#[uses_entities]
#[uses_game_events]
impl Parser2D {
    #[on_tick_end]
    fn on_tick_end(&mut self, ctx: &Context) -> ObserverResult {
        if CANCEL_PARSING.load(Ordering::Relaxed) {
            println!(
                "[Rust Backend] Parser2D observer detected cancellation flag at tick {}.",
                ctx.tick()
            );
            return Err(crate::errors::AppError::Parser("Parsing cancelled".to_string()).into());
        }

        if self.match_restarted {
            self.match_restarted = false;

            for i in 1..self.current_round {
                let file_path = self
                    .save_dir
                    .join(format!("{}_round_{}.pb", self.demo_name, i));
                let _ = std::fs::remove_file(file_path);
            }
            self.chunks.clear();
            self.round_results.clear();
            self.current_round = 1;
            self.dead_players_this_round.clear();
            self.initial_teams.clear();
            self.current_ticks.clear();
            if let Some(cb) = &self.progress_callback {
                cb(u32::MAX);
            }
        }

        if self.pending_round_save {
            self.pending_round_save = false;

            if !self.match_ended {
                if !self.current_ticks.is_empty() {
                    self.flush_latest_kda_to_last_tick(ctx);
                    self.save_current_chunk(ctx.tick());
                }
                self.current_round = (self.last_total_rounds + 1) as u32;
                self.dead_players_this_round.clear();
            }
        }

        // Emit progress every 5000 ticks
        if ctx.tick() > 0 && ctx.tick() % 5000 == 0 {
            if let Some(cb) = &self.progress_callback {
                cb(ctx.tick());
            }
        }

        // Check for round boundaries by observing m_totalRoundsPlayed
        if self.game_rules_idx.is_none() {
            for idx in 1..2048 {
                if let Ok(ent) = ctx.entities().get_by_index(idx) {
                    if ent.class().name() == "CCSGameRulesProxy" {
                        self.game_rules_idx = Some(idx as u32);
                        break;
                    }
                }
            }
        }

        if let Some(idx) = self.game_rules_idx {
            if let Ok(rules) = ctx.entities().get_by_index(idx as usize) {
                let current_total_rounds: i32 =
                    source2_demo::prelude::try_property!(rules, "m_pGameRules.m_totalRoundsPlayed")
                        .unwrap_or(self.last_total_rounds);
                if current_total_rounds == 0 && self.last_total_rounds > 0 {
                    self.match_restarted = true;
                }
                self.last_total_rounds = current_total_rounds;

                let current_freeze: bool =
                    source2_demo::prelude::try_property!(rules, "m_pGameRules.m_bFreezePeriod")
                        .unwrap_or(false);

                if !current_freeze && self.last_freeze {
                    // Freeze time just ended. Discard all but the last 0.5s of freeze ticks.
                    // Since we record every 4 ticks, 8 records = 32 game ticks = 0.5s.
                    let keep_count = 8;
                    if self.current_ticks.len() > keep_count {
                        self.current_ticks
                            .drain(0..(self.current_ticks.len() - keep_count));
                    }
                }

                self.last_freeze = current_freeze;
            }
        }

        // Collect player data every 64 ticks (e.g. 1 frame per second on 64tick server, but we can do it more frequently, say every 8 ticks)
        if ctx.tick() % 4 == 0 {
            let mut grenades = Vec::new();
            let mut controllers = Vec::new();

            for ent in ctx.entities().iter() {
                let cls = ent.class().name();
                if cls == "CCSPlayerController" {
                    controllers.push(ent);
                } else if cls == "C_WeaponC4" || cls == "CC4" || cls == "CWeaponC4" {
                    let owner: u32 =
                        source2_demo::prelude::try_property!(ent, u32, "m_hOwnerEntity")
                            .unwrap_or(0);
                    if owner == 0 || owner == 0xFFFFFF || owner == 16777215 || owner == 0xFFFFFFFF {
                        // Bomb is dropped on the floor
                        let (x, y, z) = resolve_entity_coords(&ent);
                        grenades.push(GrenadeTickData {
                            id: ent.index(),
                            class_name: "C4".to_string(),
                            x,
                            y,
                            z,
                        });
                    }
                } else if cls.contains("Projectile") || cls == "CInferno" {
                    let (x, y, z) = resolve_entity_coords(&ent);

                    grenades.push(GrenadeTickData {
                        id: ent.index(),
                        class_name: cls.replace("C", "").replace("Projectile", ""),
                        x,
                        y,
                        z,
                    });
                }
            }

            let mut player_data = Vec::new();

            for controller in controllers {
                let steam_id: u64 =
                    source2_demo::prelude::try_property!(controller, u64, "m_steamID")
                        .unwrap_or(0);
                if steam_id == 0 {
                    continue;
                }

                let team_i32: i32 =
                    source2_demo::prelude::try_property!(controller, i32, "m_iTeamNum")
                        .unwrap_or(0);
                let team = team_i32 as u8;
                if team != TEAM_T && team != TEAM_CT {
                    continue;
                }

                let final_steam_id = steam_id.to_string();

                if !self.initial_teams.contains_key(&final_steam_id) {
                    self.initial_teams.insert(final_steam_id.clone(), team);
                }

                let name: String =
                    source2_demo::prelude::try_property!(controller, String, "m_iszPlayerName")
                        .unwrap_or_default();

                let mut kills = 0;
                for p in [
                    "m_pActionTrackingServices.m_matchStats.m_iKills",
                    "m_matchStats.m_iKills",
                    "m_pActionTrackingServices.m_iKills",
                    "m_iKills",
                ] {
                    if let Some(val) = try_get_int_property(controller, p) {
                        kills = val;
                        break;
                    }
                }

                let mut deaths = 0;
                for p in [
                    "m_pActionTrackingServices.m_matchStats.m_iDeaths",
                    "m_matchStats.m_iDeaths",
                    "m_pActionTrackingServices.m_iDeaths",
                    "m_iDeaths",
                ] {
                    if let Some(val) = try_get_int_property(controller, p) {
                        deaths = val;
                        break;
                    }
                }

                let mut assists = 0;
                for p in [
                    "m_pActionTrackingServices.m_matchStats.m_iAssists",
                    "m_matchStats.m_iAssists",
                    "m_pActionTrackingServices.m_iAssists",
                    "m_iAssists",
                ] {
                    if let Some(val) = try_get_int_property(controller, p) {
                        assists = val;
                        break;
                    }
                }

                let mut money = get_int_property(controller, "m_pInGameMoneyServices.m_iAccount");
                if money == 0 {
                    money = get_int_property(controller, "m_iAccount");
                }

                if let Some(pawn_handle) =
                    source2_demo::prelude::try_property!(controller, u32, "m_hPlayerPawn").or_else(
                        || source2_demo::prelude::try_property!(controller, u32, "m_hPawn"),
                    )
                {
                    let pawn_index = (pawn_handle & ENT_INDEX_MASK) as usize;
                    if let Ok(pawn) = ctx.entities().get_by_index(pawn_index) {
                        let (x, y, z) = resolve_entity_coords(&pawn);

                        let mut hp: i32 =
                            source2_demo::prelude::try_property!(pawn, "m_iHealth").unwrap_or(0);
                        let mut is_alive = hp > 0;
                        if self.dead_players_this_round.contains(&final_steam_id) {
                            is_alive = false;
                            hp = 0;
                        }

                        let armor = get_int_property(pawn, "m_ArmorValue");
                        let has_helmet: bool = source2_demo::prelude::try_property!(
                            pawn,
                            bool,
                            "m_pItemServices.m_bHasHelmet"
                        )
                        .unwrap_or(false);
                        let has_defuser: bool = source2_demo::prelude::try_property!(
                            pawn,
                            bool,
                            "m_pItemServices.m_bHasDefuser"
                        )
                        .unwrap_or(false);

                        let angles: [f32; 3] =
                            source2_demo::prelude::try_property!(pawn, [f32; 3], "m_angEyeAngles")
                                .unwrap_or([0.0, 0.0, 0.0]);
                        let yaw = angles[1];

                        let flash_duration: f32 =
                            source2_demo::prelude::try_property!(pawn, f32, "m_flFlashDuration")
                                .unwrap_or(0.0);
                        let flash_max_alpha: f32 =
                            source2_demo::prelude::try_property!(pawn, f32, "m_flFlashMaxAlpha")
                                .unwrap_or(0.0);

                        let mut active_weapon = String::new();
                        if let Some(wep_handle) = source2_demo::prelude::try_property!(
                            pawn,
                            u32,
                            "m_pWeaponServices.m_hActiveWeapon"
                        ) {
                            if let Ok(wep) =
                                ctx.entities().get_by_index((wep_handle & 0x3FFF) as usize)
                            {
                                active_weapon = get_weapon_name(wep);
                            }
                        }

                        let is_defusing: bool =
                            source2_demo::prelude::try_property!(pawn, bool, "m_bIsDefusing")
                                .unwrap_or(false);

                        let mut inventory = Vec::new();
                        let weapon_keys = get_weapon_prop_keys();
                        for i in 0..64 {
                            let prop_name = &weapon_keys[i];
                            if let Ok(val) = pawn.get_property(prop_name) {
                                let final_handle = match val {
                                    source2_demo::prelude::FieldValue::Unsigned32(v) => *v as u32,
                                    source2_demo::prelude::FieldValue::Unsigned64(v) => *v as u32,
                                    source2_demo::prelude::FieldValue::Signed32(v) => *v as u32,
                                    source2_demo::prelude::FieldValue::Signed64(v) => *v as u32,
                                    _ => 0,
                                };

                                if final_handle != 0
                                    && final_handle != 16777215
                                    && final_handle != 0xFFFFFF
                                    && final_handle != 0xFFFFFFFF
                                {
                                    if let Ok(wep) = ctx
                                        .entities()
                                        .get_by_index((final_handle & 0x3FFF) as usize)
                                    {
                                        let owner_handle = source2_demo::prelude::try_property!(
                                            wep,
                                            u32,
                                            "m_hOwnerEntity"
                                        )
                                        .unwrap_or(0);
                                        if (owner_handle & 0x3FFF) as usize == pawn_index as usize {
                                            let wname = get_weapon_name(wep);
                                            if !wname.contains("grenade")
                                                && !wname.contains("flashbang")
                                                && !wname.contains("molotov")
                                                && !wname.contains("decoy")
                                                && !wname.contains("c4")
                                            {
                                                if !inventory.contains(&wname) {
                                                    inventory.push(wname);
                                                }
                                            } else {
                                                inventory.push(wname);
                                            }
                                        }
                                    }
                                }
                            } else {
                                break;
                            }
                        }

                        let has_bomb = inventory.iter().any(|w| w.to_lowercase() == "c4")
                            || active_weapon.to_lowercase() == "c4";

                        player_data.push(PlayerTickData {
                            steam_id: final_steam_id.clone(),
                            x,
                            y,
                            z,
                            yaw,
                            is_alive,
                            hp,
                            team,
                            name: name.clone(),
                            armor,
                            has_helmet,
                            has_defuser,
                            parsed_first_frame: false,
                            active_weapon,
                            inventory,
                            has_bomb,
                            is_defusing,
                            flash_duration,
                            flash_max_alpha,
                            kills,
                            deaths,
                            assists,
                            money,
                        });
                        continue;
                    }
                }

                player_data.push(PlayerTickData {
                    steam_id: final_steam_id,
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                    yaw: 0.0,
                    is_alive: false,
                    hp: 0,
                    team,
                    name,
                    armor: 0,
                    has_helmet: false,
                    has_defuser: false,
                    parsed_first_frame: false,
                    active_weapon: String::new(),
                    inventory: Vec::new(),
                    has_bomb: false,
                    is_defusing: false,
                    flash_duration: 0.0,
                    flash_max_alpha: 0.0,
                    kills,
                    deaths,
                    assists,
                    money,
                });
            }
            if !player_data.is_empty() {
                let current_events = self.pending_events.drain(..).collect();
                self.current_ticks.push(TickData {
                    tick: ctx.tick(),
                    players: player_data,
                    grenades,
                    events: current_events,
                });
            }
        }
        Ok(())
    }

    #[on_game_event]
    fn on_any_event(&mut self, ctx: &Context, event: &GameEvent) -> ObserverResult {
        let name = event.name();

        // Skip irrelevant events to save performance
        if name != "player_death"
            && name != "weapon_fire"
            && name != "hegrenade_detonate"
            && name != "flashbang_detonate"
            && name != "smokegrenade_detonate"
            && name != "inferno_startburn"
            && name != "player_blind"
            && name != "smokegrenade_expired"
            && name != "inferno_expire"
            && name != "bomb_beginplant"
            && name != "bomb_abortplant"
            && name != "bomb_planted"
            && name != "bomb_begindefuse"
            && name != "bomb_abortdefuse"
            && name != "bomb_defused"
            && name != "bomb_exploded"
            && name != "round_end"
            && name != "round_officially_ended"
            && name != "cs_win_panel_match"
            && name != "round_start"
            && name != "round_announce_match_start"
        {
            return Ok(());
        }

        let mut event_data = GameEventTickData {
            event_type: name.to_string(),
            user_id: 0,
            entityid: 0,
            x: 0.0,
            y: 0.0,
            z: 0.0,
            yaw: 0.0,
            weapon: String::new(),
            blind_duration: 0.0,
            team: 0,
            steam_id: String::new(),
            attacker_id: String::new(),
            assister_id: String::new(),
            headshot: false,
            penetrated: 0,
            thrusmoke: false,
            noscope: false,
            attackerblind: false,
        };

        if let Ok(source2_demo::prelude::EventValue::Int(uid)) = event.get_value("userid") {
            event_data.user_id = *uid as u32;
        }
        if let Ok(source2_demo::prelude::EventValue::Int(eid)) = event.get_value("entityid") {
            event_data.entityid = *eid as u32;
        }
        if let Ok(source2_demo::prelude::EventValue::Float(v)) = event.get_value("x") {
            event_data.x = *v;
        }
        if let Ok(source2_demo::prelude::EventValue::Float(v)) = event.get_value("y") {
            event_data.y = *v;
        }
        if let Ok(source2_demo::prelude::EventValue::Float(v)) = event.get_value("z") {
            event_data.z = *v;
        }
        if let Ok(source2_demo::prelude::EventValue::String(s)) = event.get_value("weapon") {
            event_data.weapon = s.to_string();
        }
        if let Ok(source2_demo::prelude::EventValue::Float(bd)) = event.get_value("blind_duration")
        {
            event_data.blind_duration = *bd;
        }

        if name == "weapon_fire" {
            if let Ok(source2_demo::prelude::EventValue::Int(uid_pawn)) =
                event.get_value("userid_pawn")
            {
                let pawn_idx = (*uid_pawn & 0x3FFF) as usize;

                if event_data.weapon == "weapon_molotov" || event_data.weapon == "weapon_incgrenade"
                {
                    self.last_thrown_inferno
                        .insert(pawn_idx, event_data.weapon.clone());
                }

                // Get pawn coordinates and yaw
                if let Ok(pawn) = ctx.entities().get_by_index(pawn_idx) {
                    let cell_x: u64 =
                        source2_demo::prelude::try_property!(pawn, "CBodyComponent.m_cellX")
                            .unwrap_or(0);
                    let vec_x: f32 =
                        source2_demo::prelude::try_property!(pawn, "CBodyComponent.m_vecX")
                            .unwrap_or(0.0);
                    let cell_y: u64 =
                        source2_demo::prelude::try_property!(pawn, "CBodyComponent.m_cellY")
                            .unwrap_or(0);
                    let vec_y: f32 =
                        source2_demo::prelude::try_property!(pawn, "CBodyComponent.m_vecY")
                            .unwrap_or(0.0);
                    let cell_z: u64 =
                        source2_demo::prelude::try_property!(pawn, "CBodyComponent.m_cellZ")
                            .unwrap_or(0);
                    let vec_z: f32 =
                        source2_demo::prelude::try_property!(pawn, "CBodyComponent.m_vecZ")
                            .unwrap_or(0.0);

                    event_data.x = ((cell_x as f32) - 32.0) * 512.0 + vec_x;
                    event_data.y = ((cell_y as f32) - 32.0) * 512.0 + vec_y;
                    event_data.z = ((cell_z as f32) - 32.0) * 512.0 + vec_z;

                    let angles: [f32; 3] =
                        source2_demo::prelude::try_property!(pawn, [f32; 3], "m_angEyeAngles")
                            .unwrap_or([0.0, 0.0, 0.0]);
                    event_data.yaw = angles[1];
                }
            }
        }

        if name == "player_death" || name == "player_blind" || name.starts_with("bomb_") {
            // userid is the event userid.
            event_data.steam_id = get_steamid_from_userid(ctx, event_data.user_id);

            if name == "player_death" {
                self.dead_players_this_round
                    .insert(event_data.steam_id.clone());
            }

            if name == "player_blind" || name.starts_with("bomb_") {
                if let Ok(controller) = ctx
                    .entities()
                    .get_by_index((event_data.user_id + 1) as usize)
                {
                    if name.starts_with("bomb_") {
                        if let Some(pawn_handle) =
                            source2_demo::prelude::try_property!(controller, u32, "m_hPlayerPawn")
                                .or_else(|| {
                                    source2_demo::prelude::try_property!(controller, u32, "m_hPawn")
                                })
                        {
                            let pawn_idx = (pawn_handle & 0x3FFF) as usize;
                            if let Ok(pawn) = ctx.entities().get_by_index(pawn_idx) {
                                let (px, py, pz) = resolve_entity_coords(&pawn);
                                event_data.x = px;
                                event_data.y = py;
                                event_data.z = pz;
                            }
                        }
                    }
                }
            }
        }

        if name == "bomb_planted" || name == "bomb_defused" || name == "bomb_exploded" {
            // Try to find the actual PlantedC4 entity for exact coords, overriding player coords
            let mut found_valid = false;
            for ent in ctx.entities().iter() {
                let cls = ent.class().name();
                if cls == "C_PlantedC4" || cls == "CPlantedC4" {
                    let is_ticking: bool =
                        source2_demo::prelude::try_property!(ent, bool, "m_bBombTicking")
                            .unwrap_or(true);

                    if name == "bomb_planted" && !is_ticking {
                        continue;
                    }

                    let (cx, cy, cz) = resolve_entity_coords(&ent);
                    if cx != 0.0 || cy != 0.0 {
                        event_data.x = cx;
                        event_data.y = cy;
                        event_data.z = cz;
                        found_valid = true;
                    }

                    if found_valid {
                        break;
                    }
                }
            }
        }

        if name == "inferno_startburn" {
            if let Ok(ent) = ctx.entities().get_by_index(event_data.entityid as usize) {
                let owner_handle: u32 =
                    source2_demo::prelude::try_property!(ent, u32, "m_hOwnerEntity").unwrap_or(0);
                if owner_handle != 0 && owner_handle != 0xFFFFFF && owner_handle != 16777215 {
                    let owner_idx = (owner_handle & 0x3FFF) as usize;
                    if let Some(weapon_type) = self.last_thrown_inferno.get(&owner_idx) {
                        event_data.weapon = weapon_type.clone();
                    } else {
                        // Fallback to checking owner's team if we missed the weapon_fire somehow
                        if let Ok(owner_ent) = ctx.entities().get_by_index(owner_idx) {
                            let team: i32 =
                                source2_demo::prelude::try_property!(owner_ent, i32, "m_iTeamNum")
                                    .unwrap_or(0);
                            if team == 3 {
                                event_data.weapon = "weapon_incgrenade".to_string();
                            } else {
                                event_data.weapon = "weapon_molotov".to_string();
                            }
                        }
                    }
                }
            }
        }

        if name == "player_death" {
            if let Ok(source2_demo::prelude::EventValue::Int(attacker)) =
                event.get_value("attacker")
            {
                event_data.attacker_id = get_steamid_from_userid(ctx, *attacker as u32);
            }
            if let Ok(source2_demo::prelude::EventValue::Int(assister)) =
                event.get_value("assister")
            {
                event_data.assister_id = get_steamid_from_userid(ctx, *assister as u32);
            }
            if let Ok(source2_demo::prelude::EventValue::Bool(headshot)) =
                event.get_value("headshot")
            {
                event_data.headshot = *headshot;
            }
            if let Ok(source2_demo::prelude::EventValue::Int(penetrated)) =
                event.get_value("penetrated")
            {
                event_data.penetrated = *penetrated as i32;
            }
            if let Ok(source2_demo::prelude::EventValue::Bool(thrusmoke)) =
                event.get_value("thrusmoke")
            {
                event_data.thrusmoke = *thrusmoke;
            }
            if let Ok(source2_demo::prelude::EventValue::Bool(noscope)) = event.get_value("noscope")
            {
                event_data.noscope = *noscope;
            }
            if let Ok(source2_demo::prelude::EventValue::Bool(attackerblind)) =
                event.get_value("attackerblind")
            {
                event_data.attackerblind = *attackerblind;
            }
            if let Ok(source2_demo::prelude::EventValue::String(weapon)) = event.get_value("weapon")
            {
                event_data.weapon = weapon.to_string();
            }
        }

        if name == "round_start" || name == "round_announce_match_start" {
            self.dead_players_this_round.clear();
        }

        if name == "round_officially_ended" {
            self.pending_round_save = true;

            let mut winner: u8 = 0;
            let mut reason: u8 = 0;

            for idx in 1..2048 {
                if let Ok(ent) = ctx.entities().get_by_index(idx) {
                    if ent.class().name() == "CCSGameRulesProxy" {
                        let w: i32 = source2_demo::prelude::try_property!(
                            ent,
                            "m_pGameRules.m_iRoundWinStatus"
                        )
                        .unwrap_or(0);
                        let r: i32 = source2_demo::prelude::try_property!(
                            ent,
                            "m_pGameRules.m_eRoundWinReason"
                        )
                        .unwrap_or(0);
                        winner = w as u8;
                        reason = r as u8;
                        break;
                    }
                }
            }

            let start_tick = self.current_ticks.first().map(|t| t.tick).unwrap_or(0);

            if self.round_results.last().map(|r| r.round_number) != Some(self.current_round) {
                self.round_results.push(RoundResult {
                    round_number: self.current_round,
                    start_tick,
                    end_tick: ctx.tick(),
                    winner,
                    reason,
                });
            }
        }

        if name == "cs_win_panel_match" {
            self.match_ended = true;
            self.flush_latest_kda_to_last_tick(ctx);

            let final_round = if self.last_total_rounds > 0 {
                self.last_total_rounds as u32
            } else {
                self.current_round
            };

            // Final round might not trigger round_officially_ended. Push it now.
            if self.round_results.last().map(|r| r.round_number) != Some(final_round) {
                let mut winner: u8 = 0;
                let mut reason: u8 = 0;

                for idx in 1..2048 {
                    if let Ok(ent) = ctx.entities().get_by_index(idx) {
                        if ent.class().name() == "CCSGameRulesProxy" {
                            let w: i32 = source2_demo::prelude::try_property!(
                                ent,
                                "m_pGameRules.m_iRoundWinStatus"
                            )
                            .unwrap_or(0);
                            let r: i32 = source2_demo::prelude::try_property!(
                                ent,
                                "m_pGameRules.m_eRoundWinReason"
                            )
                            .unwrap_or(0);
                            winner = w as u8;
                            reason = r as u8;
                            break;
                        }
                    }
                }

                let start_tick = self.current_ticks.first().map(|t| t.tick).unwrap_or(0);
                self.round_results.push(RoundResult {
                    round_number: final_round,
                    start_tick,
                    end_tick: ctx.tick(),
                    winner,
                    reason,
                });
            }
        }

        self.pending_events.push(event_data);
        Ok(())
    }
}
