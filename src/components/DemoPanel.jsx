import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { TrashIcon, ArrowDownIcon } from './Icons';

export default function DemoPanel({
  demoPath,
  demoStatus,
  demoPlayers,
  localSteamUsers,
  selectedTeam,
  onSelectTeam,
  onRemoveDemo
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const filename = demoPath.split(/[/\\]/).pop();

  const ctPlayers = demoPlayers.filter((p) => p.team === 3);
  const tPlayers = demoPlayers.filter((p) => p.team === 2);

  const getTeamName = (teamId) => {
    if (teamId === 3) return 'Counter-Terrorists';
    if (teamId === 2) return 'Terrorists';
    return 'Select team...';
  };

  const getBadgeClass = (teamId) => {
    if (teamId === 3) return 'ct';
    if (teamId === 2) return 't';
    return '';
  };

  const isLocalUser = (steamId) => {
    return localSteamUsers.some((u) => u.steam_id === steamId.toString());
  };

  return (
    <div id="loaded-demo-panel" class="loaded-demo-panel glass-panel" style={{ padding: '15px' }}>
      <div class="demo-file-badge">
        <div class="demo-info">
          <span class="demo-name" id="demo-name-label">{filename}</span>
          <span class="demo-status" id="demo-status-label">{demoStatus}</span>
        </div>
        <button class="btn-remove" onClick={onRemoveDemo} title="Remove Demo">
          <TrashIcon />
        </button>
      </div>

      <div class="player-selector-box">
        <span class="player-selector-label">Select your team:</span>
        <div class="custom-select-container" ref={dropdownRef}>
          <button
            class="player-select-btn"
            id="player-select-btn"
            onClick={(e) => {
              e.stopPropagation();
              setDropdownOpen(!dropdownOpen);
            }}
          >
            <span id="player-select-label">
              {selectedTeam === null ? (
                <span style={{ color: '#e5a93b', fontWeight: 500 }}>Select team... (none matched)</span>
              ) : (
                <span>
                  {getTeamName(selectedTeam)}
                  <span class={`tag-badge ${getBadgeClass(selectedTeam)}`}>
                    {selectedTeam === 3 ? 'CT' : 'T'}
                  </span>
                </span>
              )}
            </span>
            <ArrowDownIcon />
          </button>

          <div class={`player-dropdown ${dropdownOpen ? 'open' : ''}`} id="player-dropdown">
            {/* COUNTER-TERRORISTS */}
            <div
              class={`team-select-section ${selectedTeam === 3 ? 'selected' : ''}`}
              data-team-id="3"
              onClick={() => {
                onSelectTeam(3);
                setDropdownOpen(false);
              }}
            >
              <div class="team-header team-ct">COUNTER-TERRORISTS</div>
              <div class="team-players-list">
                {ctPlayers.length === 0 ? (
                  <div class="player-entry" style={{ fontStyle: 'italic' }}>No players</div>
                ) : (
                  ctPlayers.map((player) => (
                    <div class="player-entry" key={player.steam_id} data-steam-id={player.steam_id}>
                      {player.name}
                      {player.realName && (
                        <span class="tag-badge" style={{ background: 'rgba(255,255,255,0.05)', color: '#64748b', fontSize: '0.65rem', border: '1px solid rgba(255,255,255,0.1)', marginLeft: '4px' }}>
                          Steam: {player.realName}
                        </span>
                      )}
                      {isLocalUser(player.steam_id) && <span class="tag-badge self">Local</span>}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* TERRORISTS */}
            <div
              class={`team-select-section ${selectedTeam === 2 ? 'selected' : ''}`}
              data-team-id="2"
              onClick={() => {
                onSelectTeam(2);
                setDropdownOpen(false);
              }}
            >
              <div class="team-header team-t">TERRORISTS</div>
              <div class="team-players-list">
                {tPlayers.length === 0 ? (
                  <div class="player-entry" style={{ fontStyle: 'italic' }}>No players</div>
                ) : (
                  tPlayers.map((player) => (
                    <div class="player-entry" key={player.steam_id} data-steam-id={player.steam_id}>
                      {player.name}
                      {player.realName && (
                        <span class="tag-badge" style={{ background: 'rgba(255,255,255,0.05)', color: '#64748b', fontSize: '0.65rem', border: '1px solid rgba(255,255,255,0.1)', marginLeft: '4px' }}>
                          Steam: {player.realName}
                        </span>
                      )}
                      {isLocalUser(player.steam_id) && <span class="tag-badge self">Local</span>}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Selected team lineup preview */}
        {selectedTeam !== null && (
          <div class="selected-team-players-preview" id="selected-team-players-preview" style={{ display: 'flex' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-dark)', marginRight: '6px' }}>
              LINEUP:
            </span>
            {(selectedTeam === 3 ? ctPlayers : tPlayers).map((player) => (
              <span class={`player-preview-badge ${getBadgeClass(selectedTeam)}`} key={player.steam_id} data-steam-id={player.steam_id}>
                {player.name}
                {player.realName && (
                  <span style={{ fontSize: '0.8rem', opacity: 0.8, fontWeight: 'normal', marginLeft: '2px' }}>
                    (Steam: {player.realName})
                  </span>
                )}
                {isLocalUser(player.steam_id) && <span class="tag-badge self">Local</span>}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
