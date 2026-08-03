import { h } from 'preact';
import { CrosshairIcon, HelpIcon } from './Icons';

export default function CameraLockControl({
  demoPlayers,
  ctPlayers,
  tPlayers,
  targetPlayerName,
  onSelectTargetPlayer
}) {
  const targetPlayer = demoPlayers.find((p) => p.name === targetPlayerName);
  const targetTeam = targetPlayer ? targetPlayer.team : null;
  const teamClass = targetTeam === 3 ? 'ct' : targetTeam === 2 ? 't' : '';
  const activeColor = targetTeam === 3 ? 'var(--ct-color)' : targetTeam === 2 ? 'var(--t-color)' : 'var(--text-dark)';

  return (
    <div class="player-lock-box">
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <CrosshairIcon style={{ width: '15px', height: '15px', color: targetPlayerName ? activeColor : 'var(--text-dark)' }} />
        <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-main)' }}>
          Camera Target Lock:
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <select
          id="target-player-select"
          class={`target-player-select ${teamClass}`}
          value={targetPlayerName || ''}
          onChange={(e) => onSelectTargetPlayer(e.target.value)}
        >
          <option value="">None (Free Spectate)</option>

          {ctPlayers.length > 0 && (
            <optgroup label="COUNTER-TERRORISTS" style={{ color: 'var(--ct-color)', fontWeight: '600' }}>
              {ctPlayers.map((p) => (
                <option key={p.steam_id} value={p.name} style={{ color: 'var(--ct-color)', fontWeight: 'normal' }}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}

          {tPlayers.length > 0 && (
            <optgroup label="TERRORISTS" style={{ color: 'var(--t-color)', fontWeight: '600' }}>
              {tPlayers.map((p) => (
                <option key={p.steam_id} value={p.name} style={{ color: 'var(--t-color)', fontWeight: 'normal' }}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        <div
          class="help-tooltip-icon"
          title="The camera will spectate this player. If the view switches at the start of a round or after death, press F1 in-game to switch back to spectating this player."
        >
          <HelpIcon style={{ width: '12px', height: '12px' }} />
        </div>
      </div>
    </div>
  );
}
