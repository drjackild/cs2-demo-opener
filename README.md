<img src="./screenshots/icon.png?v=1" alt="CS2 Demo Voice Opener Icon" width="128" height="128">

# CS2 Demo Voice Opener

[![Build Status](https://github.com/drjackild/cs2-demo-opener/actions/workflows/release.yml/badge.svg)](https://github.com/drjackild/cs2-demo-opener/actions/workflows/release.yml)
[![Latest Release](https://img.shields.io/github/v/release/drjackild/cs2-demo-opener)](https://github.com/drjackild/cs2-demo-opener/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/drjackild/cs2-demo-opener/total)](https://github.com/drjackild/cs2-demo-opener/releases)

A desktop application for Counter-Strike 2 players and analysts to isolate and listen to specific team or player voice communications in match demos. Built with **Tauri v2**, **Rust**, **Preact**, and **Vite**.

![App Interface](./screenshots/main.jpg?v=1)

---

## Features

*   **Rust Demo Parser:** Parses player information and metadata directly from binary `.dem` files or compressed `.zst` files (automatically decompressed on the fly) using a multi-threaded Rust backend (`source2-demo` crate).
*   **Steam Profile Auto-Detection:** Scans the Windows Registry to identify logged-in Steam accounts and matches them with players in the demo.
*   **Automated Team Matching:** Auto-selects your team when a player matching your active Steam account is found in the demo.
*   **Steam Name Resolution:** Queries the Steam Web API to resolve original Steam usernames, bypassing in-game name changes.
*   **Voice Isolation Options:**
    *   **All Voices:** Hear both teams.
    *   **Only Team:** Hear only your selected team's voice communications.
    *   **Only Enemy:** Hear only the opposing team's voice communications.
    *   **No Voices:** Mute all voice communications.
*   **CS2 Integration:**
    *   Detects CS2 path across Steam libraries.
    *   Copies demo files to the game directory automatically.
    *   Generates a custom configuration file (`voice_demo.cfg`) with calculated player voice masks.
    *   Launches CS2 or copies the config for a running game.

---

## Interface Preview

### Initial State
![Initial drag and drop screen](./screenshots/main_empty.jpg?v=1)

### Team Selection
Choose between Counter-Terrorists (CT) and Terrorists (T) with complete lineup previews:
![Team dropdown selector](./screenshots/main_select_team.jpg?v=1)

### Auto-Selection & Lineup Verification
Auto-selects your team based on local Steam accounts, showing a lineup preview with resolved Steam profile names:
![Lineup preview](./screenshots/main_profile_autoselection.jpg?v=1)

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

### 5. Architecture Overview
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

## License

MIT License. Contributions are welcome!


