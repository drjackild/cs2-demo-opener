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
          onTouchStart={() => {
              if (isDraggingRef) isDraggingRef.current = true;
          }}
          onTouchEnd={() => {
              if (isDraggingRef) isDraggingRef.current = false;
          }}
          onChange={(e) => {
              setCurrentTickIndex(parseInt(e.target.value));
              if (currentTickRef) {
                  currentTickRef.current = parseInt(e.target.value);
              }
          }}
          onInput={(e) => {
              setCurrentTickIndex(parseInt(e.target.value));
              if (currentTickRef) {
                  currentTickRef.current = parseInt(e.target.value);
              }
          }}
          className="playback-timeline"
      />
      <div className="playback-time">
          {timeDisplay}
      </div>
    </div>
  );
}
