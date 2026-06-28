export default function LoadingState({ generating, totalTicks, parsedTicks, currentRound }) {
  return (
    <div className="loading-state">
        <div className="loading-spinner"></div>
        {generating ? (
            <>
                <h2 className="loading-title">Generating 2D Data...</h2>
                <p className="loading-subtitle">
                    {totalTicks > 0 ? `Parsed ${parsedTicks} / ${totalTicks} ticks` : 'Initializing parser...'}
                </p>
                <div style={{ marginTop: '16px', width: '300px', background: 'var(--bg-glass)', height: '8px', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                    <div style={{ width: `${totalTicks > 0 ? (parsedTicks / totalTicks) * 100 : 0}%`, height: '100%', background: 'var(--gradient-accent)', transition: 'width 0.2s' }}></div>
                </div>
            </>
        ) : (
            <>
                <h2 className="loading-title">Loading Round {currentRound}...</h2>
                <p className="loading-subtitle">Fetching round data from disk</p>
            </>
        )}
    </div>
  );
}
