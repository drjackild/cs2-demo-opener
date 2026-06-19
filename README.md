<img src="./screenshots/icon.png?v=1" alt="CS2 Demo Voice Opener Icon" width="128" height="128">

# CS2 Demo Voice Opener

A desktop application for Counter-Strike 2 players and analysts to isolate and listen to specific team or player voice communications in match demos. Built with **Tauri v2**, **Rust**, and HTML/CSS/JS.

![App Interface](./screenshots/main.jpg?v=1)

---

## Features

*   **Rust Demo Parser:** Parses player information and metadata directly from binary `.dem` files using a multi-threaded Rust backend (`source2-demo` crate).
*   **Steam Profile Auto-Detection:** Scans the Windows Registry to identify logged-in Steam accounts and matches them with players in the demo.
*   **Automated Identity Matching:** Auto-selects your active Steam account when a matching player is found in the demo.
*   **Steam Name Resolution:** Queries the Steam Web API to resolve original Steam usernames, bypassing in-game name changes.
*   **Voice Isolation Options:**
    *   **All Voices:** Hear both teammates and opponents.
    *   **Only Team:** Hear only your team's voice communications.
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

### Player List Selection
Grouped by team (CT/T/Spectator) with local profiles tagged:
![Player dropdown selector](./screenshots/main_select_player.jpg?v=1)

### Auto-Profile Selection
Matches the user and resolves real Steam names in the background:
![Auto-profile selection](./screenshots/main_profile_autoselection.jpg?v=1)

---

## How It Works

CS2 controls demo voice playback via two 32-bit bitmask console variables: `tv_listen_voice_indices` and `tv_listen_voice_indices_h` (representing the 64 available player slots). Setting a slot's bit to `1` unmutes that player, and `0` mutes them.

### 1. Registry Scanner & Steam ID Parsing
At startup, the Rust backend reads:
```rust
HKEY_CURRENT_USER\Software\Valve\Steam
```
It reads `SteamPath` and parses `config/loginusers.vdf` to retrieve local Steam IDs and usernames.

### 2. Multi-threaded Demo Parsing
The backend processes the `.dem` file up to tick 15000 in a dedicated thread with an 8MB stack size to extract player names, slots, teams, and Steam IDs.

### 3. Voice Mask Bitwise Calculations
The bitwise masks are calculated as follows:
*   If slot $s < 32$: `mask_low |= (1 << s)`
*   If slot $32 \le s < 64$: `mask_high |= (1 << (s - 32))`

### 4. Launching the Demo
1. Copies the `.dem` file to `<CS2_Path>/game/csgo/demos/`.
2. Creates `<CS2_Path>/game/csgo/cfg/voice_demo.cfg` containing the calculated masks, status logs, and `playdemo demos/<name>.dem`.
3. Spawns `cs2.exe +exec voice_demo.cfg` or alerts you to run `exec voice_demo` in the game console if CS2 is already running.

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


