import { h, render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { invoke } from '@tauri-apps/api/core';
import './styles.css';

import SettingsOverlay from './components/SettingsOverlay';
import Dropzone from './components/Dropzone';
import DemoPanel from './components/DemoPanel';
import VoiceCardGrid from './components/VoiceCardGrid';

function App() {
  const [cs2Path, setCs2Path] = useState('');
  const [localSteamUsers, setLocalSteamUsers] = useState([]);
  const [selectedVoiceMode, setSelectedVoiceMode] = useState('all');
  const [loadedDemoPath, setLoadedDemoPath] = useState('');
  const [demoPlayers, setDemoPlayers] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchSuccess, setLaunchSuccess] = useState(false);
  const [demoStatus, setDemoStatus] = useState('');

  // Initial load
  useEffect(() => {
    async function loadSettings() {
      // 1. CS2 Path
      const savedPath = localStorage.getItem('cs2_path');
      if (savedPath) {
        setCs2Path(savedPath);
      } else {
        try {
          const detected = await invoke('detect_cs2_path');
          if (detected) {
            setCs2Path(detected);
            localStorage.setItem('cs2_path', detected);
          }
        } catch (e) {
          console.error('Failed to detect CS2 path:', e);
        }
      }

      // 2. Steam Accounts
      try {
        const users = await invoke('get_steam_user_info');
        setLocalSteamUsers(users);
      } catch (e) {
        console.error('Failed to read Steam accounts:', e);
      }

      // 3. Voice Mode
      const savedVoice = localStorage.getItem('voice_mode');
      if (savedVoice) {
        setSelectedVoiceMode(savedVoice);
      }
    }

    loadSettings();
  }, []);

  const handleFileSelected = async (path) => {
    setLoadedDemoPath(path);
    setDemoStatus('Parsing demo players...');
    setDemoPlayers([]);
    setSelectedTeam(null);

    try {
      const result = await invoke('parse_demo_players', { demoPath: path });
      const players = result.players;
      setDemoPlayers(players);
      setLoadedDemoPath(result.uncompressed_path);
      setDemoStatus(`Demo loaded (${players.length} players found)`);

      // Auto-select based on matching local SteamIDs
      let matchedUser = null;
      for (const player of players) {
        const match = localSteamUsers.find((u) => u.steam_id === player.steam_id.toString());
        if (match) {
          matchedUser = player;
          break;
        }
      }

      if (matchedUser && (matchedUser.team === 2 || matchedUser.team === 3)) {
        setSelectedTeam(matchedUser.team);
      } else {
        setSelectedTeam(null);
      }

      // Resolve streamer names in the background
      resolveStreamerNames(players);
    } catch (e) {
      console.error(e);
      setDemoStatus('Error parsing demo file');
      alert('Error parsing demo file: ' + formatError(e));
      handleRemoveDemo();
    }
  };

  const resolveStreamerNames = async (playersList) => {
    // We update the state as each name resolves
    for (let player of playersList) {
      // Skip bots or invalid Steam IDs
      if (player.steam_id === '0' || player.steam_id.length < 15) continue;

      try {
        const realName = await invoke('resolve_steam_name', { steamId: player.steam_id });
        if (realName && realName !== player.name) {
          setDemoPlayers((currentPlayers) =>
            currentPlayers.map((p) =>
              p.steam_id === player.steam_id ? { ...p, realName } : p
            )
          );
        }
      } catch (err) {
        console.warn(`Could not resolve Steam name for ${player.steam_id}:`, err);
      }
    }
  };

  const handleRemoveDemo = () => {
    setLoadedDemoPath('');
    setDemoPlayers([]);
    setSelectedTeam(null);
    setLaunchSuccess(false);
  };

  const handleVoiceModeChange = (mode) => {
    setSelectedVoiceMode(mode);
    localStorage.setItem('voice_mode', mode);
  };

  const handleSavePath = (newPath) => {
    setCs2Path(newPath);
    localStorage.setItem('cs2_path', newPath);
  };

  const handleLaunch = async () => {
    if (!loadedDemoPath) return;
    if (!cs2Path) {
      alert('Please configure your CS2 game directory path in Settings first!');
      setSettingsOpen(true);
      return;
    }

    setLaunching(true);

    try {
      const status = await invoke('launch_cs2_demo', {
        demoPath: loadedDemoPath,
        voiceMode: selectedVoiceMode,
        selfTeam: selectedTeam || 0,
        cs2Path: cs2Path,
        players: demoPlayers
      });

      if (status === 'already_running') {
        alert(
          'CS2 is already running!\n\nThe demo configuration has been written successfully.\n\nTo play the demo, open your CS2 console (~ key) and type:\nexec voice_demo\n\n(Note: Once loaded, the console will print a list of all unmuted players!)'
        );
      }

      setLaunchSuccess(true);
      setLaunching(false);

      setTimeout(() => {
        setLaunchSuccess(false);
      }, 10000);
    } catch (e) {
      console.error(e);
      alert('Failed to launch CS2: ' + formatError(e));
      setLaunching(false);
    }
  };

  const formatError = (e) => {
    if (e && typeof e === 'object') {
      if (e.type && e.message) {
        return `[${e.type}] ${e.message}`;
      }
      if (e.message) {
        return e.message;
      }
    }
    return e;
  };

  const isLaunchDisabled = !loadedDemoPath || selectedTeam === null || launching || launchSuccess;

  return (
    <>
      {/* Header */}
      <header>
        <div class="title-container">
          <h1>CS2 DEMO OPENER</h1>
          <p>Start replays with custom voice bitmasks</p>
        </div>
        <button class="settings-btn" onClick={() => setSettingsOpen(true)} title="Settings">
          <span class="material-symbols-outlined">settings</span>
        </button>
      </header>

      {/* Main Section */}
      <main>
        {loadedDemoPath ? (
          <DemoPanel
            demoPath={loadedDemoPath}
            demoStatus={demoStatus}
            demoPlayers={demoPlayers}
            localSteamUsers={localSteamUsers}
            selectedTeam={selectedTeam}
            onSelectTeam={setSelectedTeam}
            onRemoveDemo={handleRemoveDemo}
          />
        ) : (
          <Dropzone onFileSelected={handleFileSelected} />
        )}

        {/* Voice Selector Card Grid */}
        <VoiceCardGrid
          selectedMode={selectedVoiceMode}
          onSelectMode={handleVoiceModeChange}
        />
      </main>

      {/* Footer/Launch */}
      <footer class="launch-container">
        <div id="launch-status-msg" class={`launch-status-msg ${launchSuccess ? 'show' : ''}`}>
          <span class="material-symbols-outlined" style={{ color: '#10b981', marginRight: '6px', fontSize: '18px', fontWeight: 'bold' }}>
            check_circle
          </span>
          <span>demo launched</span>
        </div>
        <button
          class="launch-btn"
          id="launch-btn"
          disabled={isLaunchDisabled}
          onClick={handleLaunch}
        >
          <span class="material-symbols-outlined" style={{ fontSize: '18px', marginRight: '6px', verticalAlign: 'middle' }}>
            play_arrow
          </span>
          <span>{launching ? 'LAUNCHING...' : 'LAUNCH DEMO'}</span>
        </button>
      </footer>

      {/* Settings Overlay */}
      <SettingsOverlay
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        cs2Path={cs2Path}
        onSavePath={handleSavePath}
        onPathChange={handleSavePath}
        steamUsers={localSteamUsers}
      />
    </>
  );
}

render(<App />, document.getElementById('app'));
