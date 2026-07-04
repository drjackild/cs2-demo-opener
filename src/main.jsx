import { h, render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './styles.css';

import SettingsOverlay from './components/SettingsOverlay';
import Dropzone from './components/Dropzone';
import DemoPanel from './components/DemoPanel';
import VoiceCardGrid from './components/VoiceCardGrid';
import ReplayViewer from './components/ReplayViewer';
import { SettingsIcon, PlayIcon, CheckIcon } from './components/Icons';

function MainApp() {
  const [cs2Path, setCs2Path] = useState('');
  const [localSteamUsers, setLocalSteamUsers] = useState([]);
  const [selectedVoiceMode, setSelectedVoiceMode] = useState('all');
  const [loadedDemoPath, setLoadedDemoPath] = useState('');
  const [demoPlayers, setDemoPlayers] = useState([]);
  const [mapName, setMapName] = useState('');
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchSuccess, setLaunchSuccess] = useState(false);
  const [demoStatus, setDemoStatus] = useState('');
  const [appVersion, setAppVersion] = useState('');
  const [latestVersion, setLatestVersion] = useState('');
  const [viewing2D, setViewing2D] = useState(false);
  const [hasMapAsset, setHasMapAsset] = useState(false);
  const [downloadingAsset, setDownloadingAsset] = useState(false);

  useEffect(() => {
    async function checkAsset() {
      if (!mapName || mapName === 'unknown') {
        setHasMapAsset(false);
        return;
      }
      try {
        const exists = await invoke('check_map_assets', { mapName });
        setHasMapAsset(exists);
        if (exists) {
          // Silently trigger ETag update check in background to verify asset freshness
          invoke('download_map_assets', { mapName }).catch(err => {
            console.error('Background map update check failed:', err);
          });
        }
      } catch (err) {
        console.error('Failed to check map asset:', err);
        setHasMapAsset(false);
      }
    }
    checkAsset();
  }, [mapName]);

  const handleDownloadAsset = async () => {
    if (!mapName || mapName === 'unknown') return;
    setDownloadingAsset(true);
    try {
      await invoke('download_map_assets', { mapName });
      setHasMapAsset(true);
      handleView2D();
    } catch (err) {
      console.error('Failed to download map asset:', err);
      alert('Failed to download map asset: ' + formatError(err));
    } finally {
      setDownloadingAsset(false);
    }
  };

  const handleView2D = () => {
    invoke('open_2d_viewer_window', { demoPath: loadedDemoPath, mapName });
    setViewing2D(true);
  };

  // Initial load
  useEffect(() => {
    async function loadSettings() {
      // 1. App Version & Update Check
      let currentVersion = '';
      try {
        currentVersion = await invoke('get_app_version');
        setAppVersion(currentVersion);
      } catch (e) {
        console.error('Failed to get app version:', e);
      }

      // 2. CS2 Path
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

      // 3. Steam Accounts
      try {
        const users = await invoke('get_steam_user_info');
        setLocalSteamUsers(users);
      } catch (e) {
        console.error('Failed to read Steam accounts:', e);
      }

      // 4. Voice Mode
      const savedVoice = localStorage.getItem('voice_mode');
      if (savedVoice) {
        setSelectedVoiceMode(savedVoice);
      }

      // 5. Asynchronous Update Check (does not block loading settings)
      if (currentVersion) {
        try {
          const res = await fetch('https://api.github.com/repos/drjackild/cs2-demo-opener/releases/latest');
          if (res.ok) {
            const data = await res.json();
            if (data && data.tag_name) {
              const tag = data.tag_name.replace(/^v/, '').trim();
              if (tag && tag !== currentVersion) {
                setLatestVersion(tag);
              }
            }
          }
        } catch (err) {
          console.warn('Failed to check for updates:', err);
        }
      }
    }

    loadSettings();
  }, []);

  useEffect(() => {
    let unlisten;
    async function setupDestroyListener() {
      try {
        unlisten = await listen('2d_viewer_destroyed', () => {
          setViewing2D(false);
        });
      } catch (err) {
        console.error('Failed to register 2d_viewer_destroyed listener:', err);
      }
    }
    setupDestroyListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleFileSelected = async (path) => {
    setLoadedDemoPath(path);
    setDemoStatus('Parsing demo players...');
    setDemoPlayers([]);
    setMapName('');
    setSelectedTeam(null);

    try {
      const result = await invoke('parse_demo_players', { demoPath: path });
      const players = result.players;
      setDemoPlayers(players);
      console.log('Map name from rust:', result.map_name);
      setMapName(result.map_name || '');
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
    setMapName('');
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

  const handleOpenReleases = async () => {
    try {
      await openUrl('https://github.com/drjackild/cs2-demo-opener/releases/latest');
    } catch (err) {
      console.error('Failed to open releases URL:', err);
    }
  };

  const handleOpenIssue = async () => {
    try {
      await openUrl('https://github.com/drjackild/cs2-demo-opener/issues/new');
    } catch (err) {
      console.error('Failed to open issues URL:', err);
    }
  };

  const isLaunchDisabled = !loadedDemoPath || 
    launching || 
    launchSuccess || 
    (selectedVoiceMode !== 'all' && selectedVoiceMode !== 'none' && selectedTeam === null);

  const is2DDisabled = !loadedDemoPath || !mapName || mapName === 'unknown' || downloadingAsset || viewing2D;

  const handle2DClick = () => {
    if (hasMapAsset) {
      handleView2D();
    } else {
      handleDownloadAsset();
    }
  };

  const get2DButtonTitle = () => {
    if (viewing2D) return "2D Replay Viewer is already open.";
    if (!loadedDemoPath) return "No demo loaded. Please drag and drop a demo first.";
    if (!mapName || mapName === 'unknown') return "Map is unknown, 2D replay is unavailable.";
    if (downloadingAsset) return "Downloading map assets...";
    if (hasMapAsset) return "Open 2D Replay Viewer";
    return "Download 2D Map Asset";
  };

  const getLaunchButtonTitle = () => {
    if (!loadedDemoPath) return "No demo loaded. Please drag and drop a demo first.";
    if (launching) return "Demo is launching...";
    if (launchSuccess) return "Demo launched successfully!";
    if (selectedVoiceMode !== 'all' && selectedVoiceMode !== 'none' && selectedTeam === null) {
      return "Please select a team in the dropdown first to launch voice filtering.";
    }
    return "Launch CS2 Demo";
  };

  return (
    <>
      {/* Header */}
      <header>
        <div class="title-container">
          <h1>CS2 DEMO OPENER</h1>
          <p>Start replays with custom voice bitmasks</p>
        </div>
        <button
          class="settings-btn"
          style={{ position: 'relative' }}
          onClick={() => setSettingsOpen(true)}
          title="Settings"
        >
          <SettingsIcon />
          {latestVersion && latestVersion !== appVersion && (
            <span
              style={{
                position: 'absolute',
                top: '-2px',
                right: '-2px',
                width: '8px',
                height: '8px',
                backgroundColor: '#10b981',
                borderRadius: '50%',
                boxShadow: '0 0 8px #10b981'
              }}
            />
          )}
        </button>
      </header>

      {/* Main Section */}
      <main>
        {loadedDemoPath ? (
          <DemoPanel
            demoPath={loadedDemoPath}
            demoStatus={demoStatus}
            demoPlayers={demoPlayers}
            mapName={mapName}
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
      <div id="launch-status-msg" class={`launch-status-msg ${launchSuccess ? 'show' : ''}`}>
        <CheckIcon style={{ marginRight: '6px', flexShrink: 0 }} />
        <span>demo launched</span>
      </div>
      <footer class="launch-container" style={{ display: 'flex', gap: '8px', width: '100%', alignItems: 'center' }}>
        <button
          class="view-2d-btn"
          disabled={is2DDisabled}
          onClick={handle2DClick}
          title={get2DButtonTitle()}
        >
          {downloadingAsset ? (
            <svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px' }}>
              <line x1="12" y1="2" x2="12" y2="6"/>
              <line x1="12" y1="18" x2="12" y2="22"/>
              <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
              <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
              <line x1="2" y1="12" x2="6" y2="12"/>
              <line x1="18" y1="12" x2="22" y2="12"/>
              <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
              <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
            </svg>
          ) : hasMapAsset ? (
            <span style={{ fontWeight: '850', fontSize: '0.85rem', border: '2px solid currentColor', borderRadius: '6px', padding: '2px 5px', display: 'inline-block', lineHeight: 1 }}>2D</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px' }}>
              <span style={{ fontWeight: '850', fontSize: '0.65rem', border: '1.5px solid currentColor', borderRadius: '4px', padding: '1px 3.5px', lineHeight: 1 }}>2D</span>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: '10px', height: '10px' }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </div>
          )}
        </button>
        <button
          class={`launch-btn ${isLaunchDisabled ? 'disabled' : ''}`}
          id="launch-btn"
          onClick={isLaunchDisabled ? null : handleLaunch}
          title={getLaunchButtonTitle()}
          style={{ flex: 1 }}
        >
          <PlayIcon style={{ marginRight: '6px' }} />
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
        appVersion={appVersion}
        latestVersion={latestVersion}
        onOpenReleases={handleOpenReleases}
        onOpenIssue={handleOpenIssue}
      />
    </>
  );
}

function App() {
  const [isViewer, setIsViewer] = useState(false);
  const [viewerProps, setViewerProps] = useState({});

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#/viewer')) {
      const qs = hash.split('?')[1] || '';
      const params = new URLSearchParams(qs);
      setIsViewer(true);
      setViewerProps({
        demoPath: params.get('demoPath'),
        mapName: params.get('mapName'),
      });
    }
  }, []);

  if (isViewer) {
    return <ReplayViewer 
        demoPath={viewerProps.demoPath} 
        mapName={viewerProps.mapName} 
        onClose={() => {
            getCurrentWindow().close();
        }}
    />;
  }

  return <MainApp />;
}

render(<App />, document.getElementById('app'));
