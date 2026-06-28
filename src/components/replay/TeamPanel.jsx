import PlayerCard from './PlayerCard';

export default function TeamPanel({ teamName, teamId, chunkData, currentTickIndex }) {
  const tickFloor = Math.floor(currentTickIndex);
  const dataStart = chunkData?.ticks?.[tickFloor];
  
  if (!dataStart || !chunkData?.initial_teams) return null;

  // Find players whose initial team matches teamId (2 = T, 3 = CT)
  const teamPlayers = dataStart.players.filter(p => chunkData.initial_teams[p.steam_id] === teamId);
  
  // Get the current team (handle halftime swaps and disconnected players)
  const activePlayer = teamPlayers.find(p => p.team === 2 || p.team === 3);
  const currentTeamId = activePlayer ? activePlayer.team : teamId;

  return (
    <div className="team-panel">
      <h3 className={`team-panel-title ${currentTeamId === 3 ? 'team-ct' : 'team-t'}`}>
        {teamName}
      </h3>
      {teamPlayers.map(p => (
          <PlayerCard key={p.steam_id} p={p} />
      ))}
    </div>
  );
}
