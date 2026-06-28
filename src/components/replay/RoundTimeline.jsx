import React, { useMemo } from 'react';
import './timeline.css';

export default function RoundTimeline({ matchInfo, currentRound, onSeek }) {
  if (!matchInfo || matchInfo.length === 0) return null;

  const rounds = useMemo(() => {
    return matchInfo.map((r, i) => {
      const isPast = r.round_number < currentRound;
      const isCurrent = r.round_number === currentRound;
      
      let winnerClass = '';
      if (r.winner === 2) winnerClass = 't-win';
      else if (r.winner === 3) winnerClass = 'ct-win';

      return {
        ...r,
        isCurrent,
        winnerClass
      };
    });
  }, [matchInfo, currentRound]);

  const renderReasonIcon = (reason) => {
    if (reason === 1) {
        return <img src="/weapons/c4.svg" alt="Exploded" className="reason-icon" onError={(e) => { e.target.style.display = 'none'; }} />;
    }
    if (reason === 7) {
        return <img src="/weapons/defuser.svg" alt="Defused" className="reason-icon" onError={(e) => { e.target.style.display = 'none'; }} />;
    }
    if (reason === 8 || reason === 9) {
        return (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="reason-icon inline-svg">
                <circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>
                <path d="M8 9a4 4 0 1 1 8 0c0 2-2 4-2 7H10c0-3-2-5-2-7Z"/>
                <path d="M9 22l-1-2M15 22l1-2M12 22v-3"/>
            </svg>
        );
    }
    if (reason === 12 || reason === 13) {
        return (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="reason-icon inline-svg">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
            </svg>
        );
    }
    return null;
  };

  const isSideSwitch = (roundNum) => {
    if (roundNum === 12) return true;
    if (roundNum >= 24) {
      if ((roundNum - 24) % 3 === 0) return true;
    }
    return false;
  };

  return (
    <div className="round-timeline-container">
      {rounds.map((round) => (
        <React.Fragment key={round.round_number}>
          <div 
            className={`timeline-round ${round.winnerClass} ${round.isCurrent ? 'current' : ''}`}
            onClick={() => onSeek && onSeek(round.round_number)}
            title={`Round ${round.round_number}`}
          >
            {renderReasonIcon(round.reason)}
            <span className="timeline-round-num">{round.round_number}</span>
          </div>
          {isSideSwitch(round.round_number) && (
            <div className="timeline-divider" />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
