export const TICK_RATE = 64.0;
// Represents the milliseconds per tick (1000ms / 64 ticks = 15.625ms). 
// Previously we used 62.5 which corresponds to a 16-tick interval simulation rate for faster playback math,
// but formally it is 1000 / TICK_RATE.
export const TICK_INTERVAL_MS = 62.5; // Keeping playback matching the visual speed we tuned it for originally

export const SIZES = {
    PLAYER_RADIUS: 4,
    PROJECTILE_RADIUS: 2,
    SMOKE_RADIUS: 35,
    INFERNO_RADIUS: 30,
    EXPLOSION_RADIUS: 25,
    TRACER_LENGTH: 80,
    TEXT_OFFSET_Y: 15
};

export const COLORS = {
    TEAM_T: '#fbbf24',
    TEAM_CT: '#38bdf8',
    DEAD: '#ef4444',
    TEXT_LIGHT: '#ffffff',
    TEXT_DARK: '#000000',
    SMOKE: 'rgba(150, 150, 150, 0.7)',
    INFERNO: 'rgba(255, 100, 0, 0.4)',
    EXPLOSION: 'rgba(255, 200, 0, 0.8)',
    FLASHBANG: 'rgba(255, 255, 255, 0.9)',
    TRACER: 'rgba(255, 255, 0, 0.8)'
};

// Maps game data team IDs to our color palette
export const getTeamColor = (teamId) => {
    return teamId === 3 ? COLORS.TEAM_CT : COLORS.TEAM_T;
};
