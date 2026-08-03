import { h } from 'preact';
import { CrosshairIcon } from './Icons';

export default function LineupPreview({
  selectedTeam,
  ctPlayers,
  tPlayers,
  targetPlayerName,
  onSelectTargetPlayer,
  localSteamUsers
}) {
  if (selectedTeam === null) return null;

  const players = selectedTeam === 3 ? ctPlayers : tPlayers;
  const badgeClass = selectedTeam === 3 ? 'ct' : 't';
  const teamColor = selectedTeam === 3 ? 'var(--ct-color)' : 'var(--t-color)';

  return (
    <div class="selected-team-players-preview" id="selected-team-players-preview">
      <span style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-dark)', marginRight: '6px' }}>
        LINEUP:
      </span>
      {players.map((player) => {
        const isTargeted = targetPlayerName === player.name;
        const isLocal = localSteamUsers.some((u) => u.steam_id === player.steam_id.toString());
        return (
          <span
            class={`player-preview-badge ${badgeClass} ${isTargeted ? 'targeted' : ''}`}
            key={player.steam_id}
            data-steam-id={player.steam_id}
            onClick={() => onSelectTargetPlayer(isTargeted ? '' : player.name)}
            title={isTargeted ? 'Camera locked (Click to unlock)' : 'Click to lock camera to player'}
          >
            {isTargeted && <CrosshairIcon style={{ width: '12px', height: '12px', color: teamColor }} />}
            <span>{player.name}</span>
            {player.realName && (
              <span style={{ fontSize: '0.8rem', opacity: 0.8, fontWeight: 'normal' }}>
                (Steam: {player.realName})
              </span>
            )}
            {isLocal && <span class="tag-badge self">Local</span>}
          </span>
        );
      })}
    </div>
  );
}
