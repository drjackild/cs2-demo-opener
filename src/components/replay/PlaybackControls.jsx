import { useMemo } from 'preact/hooks';

export default function PlaybackControls({ 
  isPlaying, 
  setIsPlaying, 
  playbackSpeed, 
  setPlaybackSpeed, 
  currentTickIndex, 
  setCurrentTickIndex, 
  currentTickRef,
  isDraggingRef,
  chunkData 
}) {
  let timeDisplay = '0:00';
  if (chunkData && chunkData.ticks && chunkData.ticks[Math.floor(currentTickIndex)]) {
    const currentTick = chunkData.ticks[Math.floor(currentTickIndex)].tick;
    const relativeTick = Math.max(0, currentTick - chunkData.start_tick);
    const seconds = Math.floor(relativeTick / 64);
    const min = Math.floor(seconds / 60);
    const sec = (seconds % 60).toString().padStart(2, '0');
    timeDisplay = `${min}:${sec}`;
  }

  // Resolve player names for tooltips
  const playerNames = useMemo(() => {
    const names = {};
    if (chunkData && chunkData.players_metadata) {
      chunkData.players_metadata.forEach(p => {
        names[p.steam_id] = p.name;
      });
    }
    return names;
  }, [chunkData]);

  // Extract events for timeline marks
  const timelineMarks = useMemo(() => {
    if (!chunkData || !chunkData.ticks) return [];
    const marks = [];
    chunkData.ticks.forEach((tickData, index) => {
      if (tickData.events && tickData.events.length > 0) {
        tickData.events.forEach(evt => {
          if (
            evt.event_type === 'player_death' ||
            evt.event_type === 'bomb_planted' ||
            evt.event_type === 'bomb_defused' ||
            evt.event_type === 'bomb_exploded'
          ) {
            let label = '';
            if (evt.event_type === 'player_death') {
              const attackerName = playerNames[evt.attacker_id] || 'Unknown';
              const victimName = playerNames[evt.steam_id] || 'Unknown';
              label = `${attackerName} killed ${victimName}${evt.headshot ? ' (HS)' : ''}`;
            } else if (evt.event_type === 'bomb_planted') {
              const planterName = playerNames[evt.steam_id] || 'Someone';
              label = `Bomb Planted by ${planterName}`;
            } else if (evt.event_type === 'bomb_defused') {
              const defuserName = playerNames[evt.steam_id] || 'Someone';
              label = `Bomb Defused by ${defuserName}`;
            } else if (evt.event_type === 'bomb_exploded') {
              label = `Bomb Exploded`;
            }

            marks.push({
              index,
              type: evt.event_type,
              label,
              tick: tickData.tick
            });
          }
        });
      }
    });
    return marks;
  }, [chunkData, playerNames]);

  return (
    <div className="playback-controls">
      <button 
          onClick={() => setIsPlaying(!isPlaying)}
          className="playback-play-btn"
      >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
      </button>

      <div style={{ display: 'flex', gap: '8px' }}>
          {[0.5, 1, 2, 4].map(speed => (
              <button 
                  key={speed}
                  onClick={() => setPlaybackSpeed(speed)}
                  className={`playback-speed-btn ${playbackSpeed === speed ? 'active' : ''}`}
              >
                  {speed}x
              </button>
          ))}
      </div>

      <div className="playback-timeline-container">
        <input 
            type="range" 
            min="0" 
            max={chunkData ? chunkData.ticks.length - 1 : 100}
            value={Math.floor(currentTickIndex)}
            onMouseDown={() => {
                if (isDraggingRef) isDraggingRef.current = true;
            }}
            onMouseUp={() => {
                if (isDraggingRef) isDraggingRef.current = false;
            }}
            onChange={(e) => {
                const val = parseInt(e.target.value);
                setCurrentTickIndex(val);
                if (currentTickRef) {
                    currentTickRef.current = val;
                }
            }}
            onInput={(e) => {
                const val = parseInt(e.target.value);
                setCurrentTickIndex(val);
                if (currentTickRef) {
                    currentTickRef.current = val;
                }
            }}
            className="playback-timeline"
        />
        <div className="playback-timeline-marks">
          {timelineMarks.map((mark) => {
            const totalTicks = chunkData?.ticks?.length || 1;
            const maxIndex = totalTicks > 1 ? totalTicks - 1 : 1;
            const pct = (mark.index / maxIndex) * 100;
            return (
              <div 
                key={`${mark.type}-${mark.index}`}
                className={`timeline-mark ${mark.type}`}
                style={{ left: `${pct}%` }}
                title={mark.label}
                onClick={(e) => {
                  e.stopPropagation();
                  const targetIndex = Math.max(0, mark.index - 1);
                  setCurrentTickIndex(targetIndex);
                  if (currentTickRef) {
                      currentTickRef.current = targetIndex;
                  }
                }}
              />
            );
          })}
        </div>
      </div>
      
      <div className="playback-time">
          {timeDisplay}
      </div>
    </div>
  );
}

