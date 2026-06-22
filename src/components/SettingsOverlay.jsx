import { h } from 'preact';
import { CloseIcon } from './Icons';

export default function SettingsOverlay({
  isOpen,
  onClose,
  cs2Path,
  onPathChange,
  steamUsers,
  appVersion,
  latestVersion,
  onOpenReleases
}) {
  return (
    <div class={`settings-overlay glass-panel ${isOpen ? 'open' : ''}`} id="settings-overlay">
      <div>
        <div class="settings-header">
          <h2>SETTINGS</h2>
          <button
            class="close-btn"
            onClick={onClose}
            id="close-settings-btn"
            aria-label="Close Settings"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <CloseIcon width="18" height="18" />
          </button>
        </div>

        <div class="settings-body">
          <div class="settings-group">
            <label for="cs2-path-input">CS2 Game Path</label>
            <div class="settings-input-row">
              <input
                type="text"
                class="settings-input"
                id="cs2-path-input"
                placeholder="Auto-detecting CS2 path..."
                value={cs2Path}
                onInput={(e) => onPathChange(e.target.value)}
              />
            </div>
            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '4px 0 0 0' }}>
              Must point to the folder containing 'bin' and 'csgo' (e.g. '...\common\Counter-Strike Global Offensive\game')
            </p>
          </div>

          <div class="settings-group">
            <label>Local Steam Accounts</label>
            <div class="steam-accounts-list" id="steam-accounts-list">
              {steamUsers.length === 0 ? (
                <div style={{ padding: '10px', color: '#64748b', fontSize: '0.8rem', textAlign: 'center' }}>
                  No local accounts found
                </div>
              ) : (
                steamUsers.map((user) => (
                  <div class="steam-account-item" key={user.steam_id}>
                    <span>{user.persona_name}</span>
                    <span class="steam-id">{user.steam_id}</span>
                  </div>
                ))
              )}
            </div>
            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '4px 0 0 0' }}>
              These profiles will be automatically matched to the player list inside dropped demos.
            </p>
          </div>
        </div>
      </div>

      <div class="settings-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <div class="settings-version-info" style={{ fontSize: '0.8rem', color: '#64748b' }}>
          Version {appVersion || '0.2.3'}
          {latestVersion && latestVersion !== appVersion && (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onOpenReleases();
              }}
              style={{ marginLeft: '10px', color: '#10b981', textDecoration: 'none', fontWeight: 600 }}
            >
              Update Available (v{latestVersion})
            </a>
          )}
        </div>
        <button class="btn-secondary" onClick={onClose} id="save-settings-btn">Save & Close</button>
      </div>
    </div>
  );
}
