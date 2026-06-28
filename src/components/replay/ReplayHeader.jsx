import React from 'react';
import RoundTimeline from './RoundTimeline';
import HUDScore from './HUDScore';

export default function ReplayHeader({ mapName, currentRound, totalRounds, handleRoundChange, matchInfo, matchFinished }) {
  return (
    <div className="replay-header" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
              <h2>2D Replay Viewer - {mapName}</h2>
              <p>Round: {currentRound}</p>
          </div>

          {matchInfo && matchInfo.length > 0 && (
              <HUDScore matchInfo={matchInfo} currentRound={currentRound} matchFinished={matchFinished} />
          )}

          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
              {(!totalRounds || totalRounds === 0) && (
                  <span style={{ color: 'var(--text-muted)', marginRight: '16px' }}>Parsing rounds...</span>
              )}
          </div>
      </div>
      
      {matchInfo && matchInfo.length > 0 && (
          <RoundTimeline 
              matchInfo={matchInfo} 
              currentRound={currentRound} 
              onSeek={handleRoundChange} 
          />
      )}
    </div>
  );
}
