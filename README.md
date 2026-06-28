<img src="./screenshots/icon.png?v=1" alt="CS2 Demo Voice Opener Icon" width="128" height="128">

# CS2 Demo Voice Opener

[![Build Status](https://github.com/drjackild/cs2-demo-opener/actions/workflows/release.yml/badge.svg)](https://github.com/drjackild/cs2-demo-opener/actions/workflows/release.yml)
[![Latest Release](https://img.shields.io/github/v/release/drjackild/cs2-demo-opener)](https://github.com/drjackild/cs2-demo-opener/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/drjackild/cs2-demo-opener/total)](https://github.com/drjackild/cs2-demo-opener/releases)

A desktop application for Counter-Strike 2 players and analysts to isolate and listen to specific team or player voice communications in match demos. Built with **Tauri v2**, **Rust**, **Preact**, and **Vite**.

![App Interface](./screenshots/main.jpg?v=1)

---

## Features

*   **Fast Demo Parser:** Drop a CS2 `.dem` file (or compressed `.zst` match file) to instantly scan players, Steam profiles, and match metadata.
*   **Steam Profile Auto-Detection:** Automatically matches demo players with local logged-in Steam accounts, auto-selecting your team context.
*   **Steam Name Resolution:** Resolves original Steam usernames dynamically in the background to bypass arbitrary in-game nickname changes.
*   **Interactive 2D Replay Viewer:** Watch your matches directly inside the app with a modern 2D tactical map interface:
    *   **Multilayer Radar Support:** Toggles upper/lower map radar layouts automatically based on player heights (perfect for maps like `de_nuke`).
    *   **Grenades and Equipment Tracker:** Shows real-time smoke clouds, HE blast circles, flashbang blinds, and molotov/incendiary fires.
    *   **Live Scoreboard & HALFTIME Side-swapping:** Renders the total round score, automatically swapping side positions and matching team colors on halftime/overtimes.
    *   **Live Kill Feed:** Tracks all round events including kills, assists, headshot icons, and flash/blind assists.
    *   **Player Indicators:** Shows real-time weapon icons, health bars, defusal/planting progress circles, and live C4/defuse kit badges next to name tags.
*   **Voice Isolation Convars:** Configure and isolate voice logs with options like *All Voices*, *Only Team*, *Only Enemy*, or *No Voices*.
*   **CS2 Launch Integration:** Detects CS2 paths, sets up configuration files automatically, and launches CS2 ready to execute your isolated playback.


## Interface Preview

### Initial State
![Initial drag and drop screen](./screenshots/main_empty.jpg?v=1)

### Team Selection
Choose between Counter-Terrorists (CT) and Terrorists (T) with complete lineup previews:
![Team dropdown selector](./screenshots/main_select_team.jpg?v=1)

### Auto-Selection & Lineup Verification
Auto-selects your team based on local Steam accounts, showing a lineup preview with resolved Steam profile names:
![Lineup preview](./screenshots/main_profile_autoselection.jpg?v=1)

### 2D Replay Viewer
An interactive, high-performance 2D replay canvas showing player movements, grenade trajectories, live kill feeds, and HUD score widgets:

#### Parse and Load Chunks
Asynchronously parses demo matches into Protocol Buffer (`.pb`) binary chunks and caches them:
![2D Replay Viewer Loading State](./screenshots/2d_demo_loading.jpg?v=1)

#### Interactive Replay Playback
Watch rounds with live kill feeds, floor selectors, dynamic scores, and player indicators:
![2D Replay Viewer Playback](./screenshots/2d_demo_playing.jpg?v=1)

---

## How It Works

CS2 controls demo voice playback via two 32-bit bitmask console variables: `tv_listen_voice_indices` and `tv_listen_voice_indices_h` (representing the 64 available player slots). Setting a slot's bit to `1` unmutes that player, and `0` mutes them.

### 1. Registry Scanning, Steam Profile Detection & Name Resolution
At startup, the Rust backend scans the Windows Registry to locate the active Steam installation:
```rust
HKEY_CURRENT_USER\Software\Valve\Steam
```
It reads `SteamPath` and parses `config/loginusers.vdf` to retrieve local Steam IDs and usernames. 

To bypass in-game name changes, the application asynchronously resolves original Steam usernames. For each detected player, the backend queries the Steam Community XML interface (`https://steamcommunity.com/profiles/<steam_id>/?xml=1`) and streams the resolved names back to the frontend.

### 2. Multi-threaded Replay Decompression & Parsing
If a compressed `.zst` file is dropped or selected, the backend automatically decompresses it into a temporary directory. The parser executes inside a dedicated thread with an **8 MB stack size** (preventing recursion stack overflows common in Windows builds) using the `source2-demo` crate. 

The parser scans the demo up to tick 5000 to instantly extract the slot indices, player names, team assignments, and Steam IDs.

> [!NOTE]
> Parsing is limited to tick 5000 (approx. 1 minute of 64-tick gameplay) to ensure scanning completes instantly. If a player connects/reconnects later in the match (e.g. after Round 1), they may not be detected during this initial scan. In such cases, you can select their team to configure the team-based filters, but the late-joining player's own voice will remain muted since their slot index was not captured in the scan. As this is a very rare occasion, the app avoids slow dynamic parsing to keep scan times minimal.

### 3. Voice Mask Bitwise Calculations
The voice bitmasks are calculated dynamically based on your selected team. Slots are mapped across two 32-bit registers representing the 64 player slots:
*   If slot $s < 32$: `mask_low |= (1 << s)`
*   If slot $32 \le s < 64$: `mask_high |= (1 << (s - 32))`

### 4. Launching the Demo & CFG Execution
Once a voice mode is selected, the application:
1. Copies the `.dem` file to the game directory (`<CS2_Path>/game/csgo/demos/`).
2. Generates `<CS2_Path>/game/csgo/cfg/voice_demo.cfg` containing the calculated masks, UI logging commands, and the `playdemo demos/<name>.dem` playback launch convar.
3. Spawns Steam (`steam.exe -applaunch 730 +exec voice_demo.cfg`) to launch CS2 (falling back to spawning `cs2.exe` directly if Steam cannot be found) or alerts you to run `exec voice_demo` in the game console if CS2 is already running.

### 5. High-Performance 2D Replay Chunking (Protobuf & Caching)
To achieve instant seeks and high-performance playback within the 2D viewer:
1. **Binary Protobuf Chunking:** The Rust parser splits tick logs into per-round segments and compiles them to highly compressed binary `.pb` files (Protocol Buffers) using `prost`. This results in a 90% file size reduction compared to traditional JSON layouts.
2. **Dynamic Client Decoding:** The frontend fetches and decodes `.pb` binary chunks on the fly using `protobufjs` with `keepCase` mapping.
3. **Background Preloading & Caching:** The frontend keeps a dynamic round cache. While you are watching the current round, it preloads the subsequent round's `.pb` file in the background, making seeks and round changes instantaneous and eliminating network/IO stutters.

### 6. Architecture Overview
The application is structured into two main layers:
*   **Rust Backend (Tauri):** Handles OS registry scans, asynchronous Steam ID parsing, transparent Zstd decompression of compressed `.zst` matches, multi-threaded demo parsing, and game launch execution.
*   **Preact Frontend (Vite):** A lightweight single-page application built with Preact. It coordinates asynchronously with the Rust backend via Tauri IPC to display interactive lineups, settings overlays, and voice card states. All icons are rendered directly as raw vector SVGs to keep the application 100% offline-compatible with zero runtime asset overhead.

---

## Setup & Development

### Prerequisites
*   [Node.js](https://nodejs.org/)
*   [Rust](https://www.rust-lang.org/)
*   [Tauri CLI](https://tauri.app/v1/guides/developer-tooling/cli/)
*   Windows OS (for Registry scanning and CS2 path resolution)

### Install Dependencies
```bash
npm install
```

### Run in Development
```bash
npm run tauri dev
```

### Build Production Release
```bash
npm run tauri build
```

---

## License & Disclaimer

### Source Code License
This project's source code is licensed under the [MIT License](LICENSE). Feel free to use, modify, and distribute the code under its terms.

### Third-Party Assets & Attributions
This application relies on external, open-source repositories to fetch game assets. These third-party assets are **not** covered by our MIT License and are owned by their respective authors and/or Valve Corporation:
*   **Weapon Vector & Killfeed Icons:** Sourced and dynamically downloaded from the [ChetdeJong/cs2-killfeed-generator](https://github.com/ChetdeJong/cs2-killfeed-generator) repository.
*   **Tactical Map Radars:** Sourced and dynamically downloaded from the [MurkyYT/cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons) repository.

### Legal Disclaimer
*   **CS2 Demo Voice Opener** is a free, third-party companion application and is not affiliated with, authorized, maintained, or endorsed by Valve Corporation.
*   All Counter-Strike 2 (CS2) assets, weapon vector icons (`public/weapons/`), game map graphics, logos, and trademarks are the intellectual property of **Valve Corporation**. They are used strictly for non-commercial, educational, and analytical purposes under fair use guidelines.
