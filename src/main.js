import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './styles.css';

let cs2Path = "";
let localSteamUsers = [];
let selectedVoiceMode = "all";
let loadedDemoPath = "";
let demoPlayers = [];
let selectedPlayerSteamId = "";

// DOM Elements
let dropzoneEl;
let loadedDemoPanelEl;
let demoNameLabelEl;
let demoStatusLabelEl;
let removeDemoBtnEl;
let playerSelectBtnEl;
let playerSelectLabelEl;
let playerDropdownEl;
let launchBtnEl;
let openSettingsBtnEl;
let closeSettingsBtnEl;
let saveSettingsBtnEl;
let settingsOverlayEl;
let cs2PathInputEl;
let steamAccountsListEl;
let voiceCards;

window.addEventListener("DOMContentLoaded", async () => {
  // Query Elements
  dropzoneEl = document.getElementById("dropzone");
  loadedDemoPanelEl = document.getElementById("loaded-demo-panel");
  demoNameLabelEl = document.getElementById("demo-name-label");
  demoStatusLabelEl = document.getElementById("demo-status-label");
  removeDemoBtnEl = document.getElementById("remove-demo-btn");
  playerSelectBtnEl = document.getElementById("player-select-btn");
  playerSelectLabelEl = document.getElementById("player-select-label");
  playerDropdownEl = document.getElementById("player-dropdown");
  launchBtnEl = document.getElementById("launch-btn");
  openSettingsBtnEl = document.getElementById("open-settings-btn");
  closeSettingsBtnEl = document.getElementById("close-settings-btn");
  saveSettingsBtnEl = document.getElementById("save-settings-btn");
  settingsOverlayEl = document.getElementById("settings-overlay");
  cs2PathInputEl = document.getElementById("cs2-path-input");
  steamAccountsListEl = document.getElementById("steam-accounts-list");
  voiceCards = document.querySelectorAll(".voice-card");

  // Load Initial Settings
  await initSettings();

  // Listeners
  setupTauriDragDrop();
  setupVoiceSelector();
  setupPlayerSelector();
  setupSettingsHandlers();
  setupLaunchHandler();

  removeDemoBtnEl.addEventListener("click", removeDemo);
});

async function initSettings() {
  // Load saved path if exists
  const savedPath = localStorage.getItem("cs2_path");
  if (savedPath) {
    cs2Path = savedPath;
    cs2PathInputEl.value = cs2Path;
  } else {
    // Detect automatically
    try {
      const detected = await invoke("detect_cs2_path");
      if (detected) {
        cs2Path = detected;
        cs2PathInputEl.value = cs2Path;
      }
    } catch (e) {
      console.error("Failed to detect CS2 path:", e);
    }
  }

  // Load Steam accounts
  try {
    localSteamUsers = await invoke("get_steam_user_info");
    renderSteamAccounts();
  } catch (e) {
    console.error("Failed to read Steam accounts:", e);
  }

  // Load last voice mode
  const savedVoice = localStorage.getItem("voice_mode");
  if (savedVoice) {
    selectedVoiceMode = savedVoice;
    voiceCards.forEach(c => {
      if (c.dataset.mode === selectedVoiceMode) {
        c.classList.add("active");
      } else {
        c.classList.remove("active");
      }
    });
  }
}

function renderSteamAccounts() {
  steamAccountsListEl.innerHTML = "";
  if (localSteamUsers.length === 0) {
    steamAccountsListEl.innerHTML = `<div style="padding: 10px; color: #64748b; font-size: 0.8rem; text-align: center;">No local accounts found</div>`;
    return;
  }
  localSteamUsers.forEach(user => {
    const item = document.createElement("div");
    item.className = "steam-account-item";
    item.innerHTML = `
      <span>${user.persona_name}</span>
      <span class="steam-id">${user.steam_id}</span>
    `;
    steamAccountsListEl.appendChild(item);
  });
}

function setupTauriDragDrop() {
  // Click to open native file selector
  dropzoneEl.addEventListener("click", async () => {
    try {
      const path = await invoke("select_demo_file");
      if (path) {
        await loadDemo(path);
      }
    } catch (e) {
      console.error("Failed to select file:", e);
      alert("Failed to open file picker: " + e);
    }
  });

  // Drag over styling in Tauri v2
  listen("tauri://drag-over", () => {
    dropzoneEl.classList.add("dragover");
  });

  listen("tauri://drag-leave", () => {
    dropzoneEl.classList.remove("dragover");
  });

  listen("tauri://drag-drop", async (event) => {
    dropzoneEl.classList.remove("dragover");
    const payload = event.payload;
    let paths = [];
    if (payload) {
      if (Array.isArray(payload)) {
        paths = payload;
      } else if (Array.isArray(payload.paths)) {
        paths = payload.paths;
      }
    }

    if (paths && paths.length > 0) {
      const path = paths[0];
      if (path.toLowerCase().endsWith(".dem")) {
        await loadDemo(path);
      } else {
        alert("Please drop a valid .dem file!");
      }
    }
  });
}

async function loadDemo(path) {
  loadedDemoPath = path;

  // Show loaded demo name
  const filename = path.split(/[/\\]/).pop();
  demoNameLabelEl.textContent = filename;
  demoStatusLabelEl.textContent = "Parsing demo players...";

  // Switch UI panels
  dropzoneEl.style.display = "none";
  loadedDemoPanelEl.style.display = "block";
  launchBtnEl.disabled = true;

  try {
    demoPlayers = await invoke("parse_demo_players", { demoPath: path });
    demoStatusLabelEl.textContent = `Demo loaded (${demoPlayers.length} players found)`;

    // Auto-select based on matching local SteamIDs
    let matchedUser = null;
    for (const player of demoPlayers) {
      const match = localSteamUsers.find(u => u.steam_id === player.steam_id.toString());
      if (match) {
        matchedUser = player;
        break;
      }
    }

    renderPlayerSelector(matchedUser);
    launchBtnEl.disabled = false;

    // Resolve streamer mode names in the background
    resolveStreamerNames();
  } catch (e) {
    console.error(e);
    demoStatusLabelEl.textContent = "Error parsing demo file";
    alert("Error parsing demo file: " + e);
    removeDemo();
  }
}

function renderPlayerSelector(matchedUser) {
  playerDropdownEl.innerHTML = "";

  // Group players by team: CT (team 3) vs T (team 2)
  const ctPlayers = demoPlayers.filter(p => p.team === 3);
  const tPlayers = demoPlayers.filter(p => p.team === 2);
  const otherPlayers = demoPlayers.filter(p => p.team !== 2 && p.team !== 3);

  const addTeamSection = (label, playersList, className) => {
    if (playersList.length === 0) return;
    const header = document.createElement("div");
    header.className = `team-header ${className}`;
    header.textContent = label;
    playerDropdownEl.appendChild(header);

    playersList.forEach(player => {
      const opt = document.createElement("div");
      opt.className = "player-option";
      opt.dataset.steamId = player.steam_id;
      if (matchedUser && player.steam_id === matchedUser.steam_id) {
        opt.classList.add("selected");
      }

      const isLocal = localSteamUsers.some(u => u.steam_id === player.steam_id.toString());
      const selfTag = isLocal ? `<span class="tag-badge self">Local</span>` : "";

      opt.innerHTML = `
        <span class="player-option-name">${player.name}${selfTag}</span>
        <span class="player-option-id">Slot ${player.slot}</span>
      `;

      opt.addEventListener("click", () => {
        selectPlayer(player);
      });
      playerDropdownEl.appendChild(opt);
    });
  };

  addTeamSection("COUNTER-TERRORISTS", ctPlayers, "team-ct");
  addTeamSection("TERRORISTS", tPlayers, "team-t");
  addTeamSection("SPECTATORS & OTHERS", otherPlayers, "team-other");

  if (matchedUser) {
    selectPlayer(matchedUser);
  } else {
    selectedPlayerSteamId = "";
    playerSelectLabelEl.innerHTML = `<span style="color: #e5a93b; font-weight: 500;">Select profile... (none matched)</span>`;
  }
}

function selectPlayer(player) {
  selectedPlayerSteamId = player.steam_id.toString();

  // Update visual selected class inside the options list
  const options = playerDropdownEl.querySelectorAll(".player-option");
  options.forEach(opt => {
    if (opt.dataset.steamId === selectedPlayerSteamId) {
      opt.classList.add("selected");
    } else {
      opt.classList.remove("selected");
    }
  });

  playerDropdownEl.classList.remove("open");

  const teamName = player.team === 3 ? "CT" : player.team === 2 ? "T" : "Spec";
  const badgeClass = player.team === 3 ? "ct" : player.team === 2 ? "t" : "other";

  const displayName = player.realName ? `<span>${player.name} <span style="font-size: 0.8rem; color: #64748b; margin-left: 2px;">(Steam: ${player.realName})</span></span>` : `<span>${player.name}</span>`;

  playerSelectLabelEl.innerHTML = `
    ${displayName}
    <span class="tag-badge ${badgeClass}">${teamName}</span>
  `;
}

async function resolveStreamerNames() {
  for (let player of demoPlayers) {
    // Skip bots
    if (player.steam_id === "0" || player.steam_id.length < 15) continue;

    try {
      const realName = await invoke("resolve_steam_name", { steamId: player.steam_id });
      if (realName && realName !== player.name) {
        player.realName = realName;

        // Update in dropdown list
        const optNameEl = playerDropdownEl.querySelector(`.player-option[data-steam-id="${player.steam_id}"] .player-option-name`);
        if (optNameEl) {
          const isLocal = localSteamUsers.some(u => u.steam_id === player.steam_id.toString());
          const selfTag = isLocal ? `<span class="tag-badge self">Local</span>` : "";
          optNameEl.innerHTML = `${player.name} <span class="tag-badge" style="background: rgba(255,255,255,0.05); color: #64748b; font-size: 0.65rem; border: 1px solid rgba(255,255,255,0.1); margin-left: 4px;">Steam: ${realName}</span>${selfTag}`;
        }

        // Update select label if currently selected
        if (selectedPlayerSteamId === player.steam_id) {
          const teamName = player.team === 3 ? "CT" : player.team === 2 ? "T" : "Spec";
          const badgeClass = player.team === 3 ? "ct" : player.team === 2 ? "t" : "other";
          playerSelectLabelEl.innerHTML = `
            <span>${player.name} <span style="font-size: 0.8rem; color: #64748b; margin-left: 2px;">(Steam: ${realName})</span></span>
            <span class="tag-badge ${badgeClass}">${teamName}</span>
          `;
        }
      }
    } catch (err) {
      console.warn(`Could not resolve Steam name for ${player.steam_id}:`, err);
    }
  }
}

function removeDemo() {
  loadedDemoPath = "";
  demoPlayers = [];
  selectedPlayerSteamId = "";

  dropzoneEl.style.display = "flex";
  loadedDemoPanelEl.style.display = "none";
  launchBtnEl.disabled = true;
}

function setupVoiceSelector() {
  voiceCards.forEach(card => {
    card.addEventListener("click", () => {
      voiceCards.forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      selectedVoiceMode = card.dataset.mode;
      localStorage.setItem("voice_mode", selectedVoiceMode);
    });
  });
}

function setupPlayerSelector() {
  playerSelectBtnEl.addEventListener("click", (e) => {
    e.stopPropagation();
    playerDropdownEl.classList.toggle("open");
  });

  document.addEventListener("click", () => {
    playerDropdownEl.classList.remove("open");
  });
}

function setupSettingsHandlers() {
  openSettingsBtnEl.addEventListener("click", openSettings);
  closeSettingsBtnEl.addEventListener("click", closeSettings);
  saveSettingsBtnEl.addEventListener("click", saveSettings);
}

function openSettings() {
  settingsOverlayEl.classList.add("open");
}

function closeSettings() {
  settingsOverlayEl.classList.remove("open");
}

function saveSettings() {
  cs2Path = cs2PathInputEl.value.trim();
  localStorage.setItem("cs2_path", cs2Path);
  closeSettings();
}

function setupLaunchHandler() {
  launchBtnEl.addEventListener("click", async () => {
    if (!loadedDemoPath) return;
    if (!cs2Path) {
      alert("Please configure your CS2 game directory path in Settings first!");
      openSettings();
      return;
    }

    launchBtnEl.disabled = true;
    launchBtnEl.querySelector("span").textContent = "LAUNCHING...";

    try {
      const status = await invoke("launch_cs2_demo", {
        demoPath: loadedDemoPath,
        voiceMode: selectedVoiceMode,
        selfSteamId: selectedPlayerSteamId,
        cs2Path: cs2Path,
        players: demoPlayers
      });

      if (status === "already_running") {
        alert("CS2 is already running!\n\nThe demo configuration has been written successfully.\n\nTo play the demo, open your CS2 console (~ key) and type:\nexec voice_demo\n\n(Note: Once loaded, the console will print a list of all unmuted players!)");
      }

      setTimeout(() => {
        launchBtnEl.disabled = false;
        launchBtnEl.querySelector("span").textContent = "LAUNCH DEMO";
      }, 3000);
    } catch (e) {
      console.error(e);
      alert("Failed to launch CS2: " + e);
      launchBtnEl.disabled = false;
      launchBtnEl.querySelector("span").textContent = "LAUNCH DEMO";
    }
  });
}
