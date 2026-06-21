import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './styles.css';

let cs2Path = "";
let localSteamUsers = [];
let selectedVoiceMode = "all";
let loadedDemoPath = "";
let demoPlayers = [];
let selectedTeam = null;

// DOM Elements
let dropzoneEl;
let loadedDemoPanelEl;
let demoNameLabelEl;
let demoStatusLabelEl;
let removeDemoBtnEl;
let playerSelectBtnEl;
let playerSelectLabelEl;
let playerDropdownEl;
let launchStatusMsgEl;
let launchBtnEl;
let openSettingsBtnEl;
let closeSettingsBtnEl;
let saveSettingsBtnEl;
let settingsOverlayEl;
let cs2PathInputEl;
let steamAccountsListEl;
let voiceCards;
let selectedTeamPlayersPreviewEl;

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
  selectedTeamPlayersPreviewEl = document.getElementById("selected-team-players-preview");
  launchBtnEl = document.getElementById("launch-btn");
  launchStatusMsgEl = document.getElementById("launch-status-msg");
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
      alert("Failed to open file picker: " + formatError(e));
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
      if (path.toLowerCase().endsWith(".dem") || path.toLowerCase().endsWith(".zst")) {
        await loadDemo(path);
      } else {
        alert("Please drop a valid .dem or .zst file!");
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
    const result = await invoke("parse_demo_players", { demoPath: path });
    demoPlayers = result.players;
    loadedDemoPath = result.uncompressed_path;
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

    renderTeamSelector(matchedUser);

    // Resolve streamer mode names in the background
    resolveStreamerNames();
  } catch (e) {
    console.error(e);
    demoStatusLabelEl.textContent = "Error parsing demo file";
    alert("Error parsing demo file: " + formatError(e));
    removeDemo();
  }
}

function renderTeamSelector(matchedUser) {
  playerDropdownEl.innerHTML = "";

  // Group players by team: CT (team 3) vs T (team 2)
  const ctPlayers = demoPlayers.filter(p => p.team === 3);
  const tPlayers = demoPlayers.filter(p => p.team === 2);

  const addTeamSection = (label, playersList, className, teamId) => {
    const section = document.createElement("div");
    section.className = "team-select-section";
    section.dataset.teamId = teamId;

    const header = document.createElement("div");
    header.className = `team-header ${className}`;
    header.textContent = label;
    section.appendChild(header);

    const playersListContainer = document.createElement("div");
    playersListContainer.className = "team-players-list";

    if (playersList.length === 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.className = "player-entry";
      emptyMsg.style.fontStyle = "italic";
      emptyMsg.textContent = "No players";
      playersListContainer.appendChild(emptyMsg);
    } else {
      playersList.forEach(player => {
        const pEntry = document.createElement("div");
        pEntry.className = "player-entry";
        pEntry.dataset.steamId = player.steam_id;

        const isLocal = localSteamUsers.some(u => u.steam_id === player.steam_id.toString());
        const selfTag = isLocal ? `<span class="tag-badge self">Local</span>` : "";

        pEntry.innerHTML = `${player.name}${selfTag}`;
        playersListContainer.appendChild(pEntry);
      });
    }

    section.appendChild(playersListContainer);

    section.addEventListener("click", (e) => {
      e.stopPropagation();
      selectTeam(teamId);
    });

    playerDropdownEl.appendChild(section);
  };

  addTeamSection("COUNTER-TERRORISTS", ctPlayers, "team-ct", 3);
  addTeamSection("TERRORISTS", tPlayers, "team-t", 2);

  if (matchedUser && (matchedUser.team === 2 || matchedUser.team === 3)) {
    selectTeam(matchedUser.team);
  } else {
    selectTeam(null);
  }
}

function selectTeam(teamId) {
  selectedTeam = teamId;

  // Update visual selected class inside the options list
  const sections = playerDropdownEl.querySelectorAll(".team-select-section");
  sections.forEach(section => {
    const secTeamId = parseInt(section.dataset.teamId, 10);
    if (selectedTeam !== null && selectedTeam === secTeamId) {
      section.classList.add("selected");
    } else {
      section.classList.remove("selected");
    }
  });

  playerDropdownEl.classList.remove("open");

  if (selectedTeam === null) {
    playerSelectLabelEl.innerHTML = `<span style="color: #e5a93b; font-weight: 500;">Select team... (none matched)</span>`;
    launchBtnEl.disabled = true;
    selectedTeamPlayersPreviewEl.style.display = "none";
    selectedTeamPlayersPreviewEl.innerHTML = "";
  } else {
    const teamName = selectedTeam === 3 ? "Counter-Terrorists" : "Terrorists";
    const badgeClass = selectedTeam === 3 ? "ct" : "t";
    const badgeText = selectedTeam === 3 ? "CT" : "T";

    playerSelectLabelEl.innerHTML = `
      <span>${teamName}</span>
      <span class="tag-badge ${badgeClass}">${badgeText}</span>
    `;
    launchBtnEl.disabled = false;

    // Render team lineup preview
    selectedTeamPlayersPreviewEl.style.display = "flex";
    selectedTeamPlayersPreviewEl.innerHTML = "";

    const label = document.createElement("span");
    label.style.fontSize = "0.75rem";
    label.style.fontWeight = "600";
    label.style.color = "var(--text-dark)";
    label.style.marginRight = "6px";
    label.textContent = "LINEUP:";
    selectedTeamPlayersPreviewEl.appendChild(label);

    const teamPlayers = demoPlayers.filter(p => p.team === selectedTeam);
    teamPlayers.forEach(player => {
      const badge = document.createElement("span");
      badge.className = `player-preview-badge ${badgeClass}`;
      badge.dataset.steamId = player.steam_id;

      const isLocal = localSteamUsers.some(u => u.steam_id === player.steam_id.toString());
      const selfTag = isLocal ? `<span class="tag-badge self">Local</span>` : "";
      const displayName = player.realName ? `${player.name} (Steam: ${player.realName})` : player.name;

      badge.innerHTML = `${displayName}${selfTag}`;
      selectedTeamPlayersPreviewEl.appendChild(badge);
    });
  }
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
        const playerEntryEl = playerDropdownEl.querySelector(`.player-entry[data-steam-id="${player.steam_id}"]`);
        if (playerEntryEl) {
          const isLocal = localSteamUsers.some(u => u.steam_id === player.steam_id.toString());
          const selfTag = isLocal ? `<span class="tag-badge self">Local</span>` : "";
          playerEntryEl.innerHTML = `${player.name} <span class="tag-badge" style="background: rgba(255,255,255,0.05); color: #64748b; font-size: 0.65rem; border: 1px solid rgba(255,255,255,0.1); margin-left: 4px;">Steam: ${realName}</span>${selfTag}`;
        }

        // Update in selected lineup preview if matches
        const previewBadgeEl = selectedTeamPlayersPreviewEl.querySelector(`.player-preview-badge[data-steam-id="${player.steam_id}"]`);
        if (previewBadgeEl) {
          const isLocal = localSteamUsers.some(u => u.steam_id === player.steam_id.toString());
          const selfTag = isLocal ? `<span class="tag-badge self">Local</span>` : "";
          previewBadgeEl.innerHTML = `${player.name} <span style="font-size: 0.8rem; opacity: 0.8; font-weight: normal; margin-left: 2px;">(Steam: ${realName})</span>${selfTag}`;
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
  selectedTeam = null;

  dropzoneEl.style.display = "flex";
  loadedDemoPanelEl.style.display = "none";
  launchBtnEl.disabled = true;
  launchStatusMsgEl.classList.remove("show");
  selectedTeamPlayersPreviewEl.style.display = "none";
  selectedTeamPlayersPreviewEl.innerHTML = "";
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
        selfTeam: selectedTeam,
        cs2Path: cs2Path,
        players: demoPlayers
      });

      if (status === "already_running") {
        alert("CS2 is already running!\n\nThe demo configuration has been written successfully.\n\nTo play the demo, open your CS2 console (~ key) and type:\nexec voice_demo\n\n(Note: Once loaded, the console will print a list of all unmuted players!)");
      }

      launchStatusMsgEl.classList.add("show");
      launchBtnEl.disabled = true;
      launchBtnEl.querySelector("span").textContent = "LAUNCH DEMO";

      setTimeout(() => {
        launchStatusMsgEl.classList.remove("show");
        if (loadedDemoPath) {
          launchBtnEl.disabled = false;
        }
      }, 10000);
    } catch (e) {
      console.error(e);
      alert("Failed to launch CS2: " + formatError(e));
      launchBtnEl.disabled = false;
      launchBtnEl.querySelector("span").textContent = "LAUNCH DEMO";
    }
  });
}

function formatError(e) {
  if (e && typeof e === 'object') {
    if (e.type && e.message) {
      return `[${e.type}] ${e.message}`;
    }
    if (e.message) {
      return e.message;
    }
  }
  return e;
}
