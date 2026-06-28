import React, { useMemo } from 'react';

export default function HUDScore({ matchInfo, currentRound, matchFinished }) {
  const getTeamASide = (roundNum) => {
    if (roundNum <= 24) {
      return roundNum <= 12 ? 3 : 2;
    } else {
      const otRound = roundNum - 25;
      const halfIndex = Math.floor(otRound / 3);
      return halfIndex % 2 === 0 ? 3 : 2;
    }
  };

  const scores = useMemo(() => {
    if (!matchInfo || matchInfo.length === 0) return { scoreA: 0, scoreB: 0 };
    let scoreA = 0;
    let scoreB = 0;
    const maxRoundToCount = matchFinished ? currentRound : currentRound - 1;
    
    for (const r of matchInfo) {
      if (r.round_number <= maxRoundToCount) {
        const sideA = getTeamASide(r.round_number);
        if (r.winner === sideA) {
          scoreA++;
        } else if (r.winner !== 0) {
          scoreB++;
        }
      }
    }
    return { scoreA, scoreB };
  }, [matchInfo, currentRound, matchFinished]);

  const sideA = getTeamASide(currentRound);
  const sideB = sideA === 3 ? 2 : 3;

  const labelA = sideA === 3 ? 'CT' : 'T';
  const labelB = sideB === 3 ? 'CT' : 'T';

  return (
    <div className="header-score-center">
      <div className="score-container">
          <div className={`score-team ${sideA === 3 ? 'team-ct-score' : 'team-t-score'}`}>
              <span className="score-team-label">{labelA}</span>
              <span className="score-team-value align-right">{scores.scoreA}</span>
          </div>
          <span className="score-divider">:</span>
          <div className={`score-team ${sideB === 3 ? 'team-ct-score' : 'team-t-score'}`}>
              <span className="score-team-value align-left">{scores.scoreB}</span>
              <span className="score-team-label">{labelB}</span>
          </div>
      </div>
    </div>
  );
}
