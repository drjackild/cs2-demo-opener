import { SIZES, COLORS, getTeamColor } from './constants';

const c4Img = new Image();
c4Img.src = "/weapons/c4.svg";

const defuseImg = new Image();
defuseImg.src = "/weapons/defuser.svg";

const activeWeaponIcons = {};

function getWeaponImage(wepName) {
    if (!wepName) return null;
    let lower = wepName.toLowerCase();
    
    // specific mappings
    if (lower === 'incendiarygrenade') lower = 'incgrenade';
    else if (lower === 'molotovgrenade') lower = 'molotov';
    else if (lower === 'decoygrenade') lower = 'decoy';
    else if (lower === 'c4') lower = 'c4';
    else if (lower === 'm4a1') lower = 'm4a1_silencer';
    
    if (activeWeaponIcons[lower]) return activeWeaponIcons[lower];
    
    const img = new Image();
    img.src = `/weapons/${lower}.svg`;
    activeWeaponIcons[lower] = img;
    return img;
}

export class PlayerActor {
    static draw(ctx, p, nextP, fraction, currentI, processedEvents, activeFloor, isLower, transformX, transformY, offsetX = 0, offsetY = 0, zDisplaced = null) {
        if (!p.is_alive) return;

        const onActiveFloor = (activeFloor === 'lower' && isLower(p.z)) || (activeFloor === 'upper' && !isLower(p.z));
        ctx.globalAlpha = onActiveFloor ? 1.0 : 0.2;

        // Interpolation
        let finalX = p.x;
        let finalY = p.y;
        if (nextP && nextP.is_alive) {
            finalX = p.x + (nextP.x - p.x) * fraction;
            finalY = p.y + (nextP.y - p.y) * fraction;
        }

        // Interpolate yaw
        let yawVal = p.yaw || 0;
        if (nextP && nextP.is_alive) {
            let diff = (nextP.yaw || 0) - (p.yaw || 0);
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;
            yawVal = (p.yaw || 0) + diff * fraction;
        }

        const px = transformX(finalX) + offsetX;
        const py = transformY(finalY) + offsetY;
        const color = getTeamColor(p.team);

        // Draw vision cone first (behind dot)
        const angleRad = -(yawVal * Math.PI) / 180.0 + Math.PI;
        const fov = (70 * Math.PI) / 180.0;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.arc(px, py, 25, angleRad - fov / 2, angleRad + fov / 2, false);
        ctx.lineTo(px, py);
        ctx.fillStyle = p.team === 3 ? 'rgba(56, 189, 248, 0.4)' : 'rgba(251, 191, 36, 0.4)';
        ctx.fill();

        // Draw player dot
        ctx.beginPath();
        ctx.arc(px, py, SIZES.PLAYER_RADIUS, 0, 2 * Math.PI, false);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = COLORS.TEXT_DARK;
        ctx.stroke();

        // Draw height indicator if overlapping and displaced
        if (zDisplaced) {
            ctx.beginPath();
            if (zDisplaced === 'above') {
                // Triangle pointing UP
                ctx.moveTo(px, py - SIZES.PLAYER_RADIUS - 6);
                ctx.lineTo(px - 4, py - SIZES.PLAYER_RADIUS - 1);
                ctx.lineTo(px + 4, py - SIZES.PLAYER_RADIUS - 1);
            } else {
                // Triangle pointing DOWN (below the HP bar)
                ctx.moveTo(px, py + SIZES.PLAYER_RADIUS + 11);
                ctx.lineTo(px - 4, py + SIZES.PLAYER_RADIUS + 6);
                ctx.lineTo(px + 4, py + SIZES.PLAYER_RADIUS + 6);
            }
            ctx.closePath();
            ctx.fillStyle = COLORS.TEXT_LIGHT;
            ctx.fill();
            ctx.stroke();
        }

        // Draw flashbang halo if blind
        const activeBlind = processedEvents.blinds?.find(b => b.player_id === p.player_id && currentI >= b.start_i && currentI <= b.end_i);
        if (activeBlind) {
            const progress = (currentI - activeBlind.start_i) / activeBlind.duration_ticks;
            const alpha = 1.0 - Math.min(1.0, progress);
            if (alpha > 0.01) {
                // Draw a filled white circle covering the player dot and extending outward
                ctx.beginPath();
                ctx.arc(px, py, SIZES.PLAYER_RADIUS + 4, 0, 2 * Math.PI, false);
                ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.85})`;
                ctx.fill();
            }
        }

        // Draw bomb action progress
        let activeAction = processedEvents.bombActions?.find(a => a.steam_id === p.steam_id && currentI >= a.start_i && currentI <= a.end_i);
        
        // If the backend failed to capture bomb_abortdefuse, we rely on the pawn's is_defusing state
        if (activeAction && activeAction.type === 'defuse' && p.is_defusing === false) {
            activeAction = null;
        }

        if (activeAction) {
            const isPlant = activeAction.type === 'plant';
            const actionLength = isPlant ? (3.2 * 16) : (p.has_defuser ? 5.0 * 16 : 10.0 * 16);
            
            const progress = Math.min(1.0, (currentI - activeAction.start_i) / actionLength);
            
            ctx.beginPath();
            ctx.arc(px, py, SIZES.PLAYER_RADIUS + 6, -Math.PI / 2, -Math.PI / 2 + (2 * Math.PI * progress), false);
            
            ctx.strokeStyle = isPlant ? '#ef4444' : '#38bdf8';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Draw health bar below dot
        const hpWidth = 12;
        const hpHeight = 3;
        ctx.fillStyle = COLORS.DEAD;
        ctx.fillRect(px - hpWidth / 2, py + SIZES.PLAYER_RADIUS + 2, hpWidth, hpHeight);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(px - hpWidth / 2, py + SIZES.PLAYER_RADIUS + 2, hpWidth * (Math.max(0, p.hp) / 100), hpHeight);

        // Draw name if available
        if (p.name) {
            ctx.font = '10px sans-serif';
            ctx.fillStyle = COLORS.TEXT_LIGHT;
            ctx.textAlign = 'center';
            
            // Fix the spiky artifacts on W, M, A, V when strokeText is used
            ctx.lineJoin = 'round';
            ctx.miterLimit = 2;
            
            ctx.shadowColor = COLORS.TEXT_DARK;
            ctx.shadowBlur = 3;
            ctx.lineWidth = 2;
            ctx.strokeText(p.name, px, py - SIZES.TEXT_OFFSET_Y);
            ctx.shadowBlur = 0;
            ctx.fillText(p.name, px, py - SIZES.TEXT_OFFSET_Y);

            const nameWidth = ctx.measureText(p.name).width;

            if (p.has_bomb && c4Img.complete) {
                // Draw C4 icon right of the name
                ctx.filter = 'brightness(0) invert(1)';
                ctx.drawImage(c4Img, px + nameWidth / 2 + 4, py - SIZES.TEXT_OFFSET_Y - 10, 14, 14);
                ctx.filter = 'none';
            }

            if (p.is_defusing && defuseImg.complete) {
                // Draw defuse kit icon right of the name
                ctx.filter = 'brightness(0) invert(1)';
                ctx.drawImage(defuseImg, px + nameWidth / 2 + 4, py - SIZES.TEXT_OFFSET_Y - 10, 14, 14);
                ctx.filter = 'none';
            }
            
            if (p.active_weapon) {
                const weaponImg = getWeaponImage(p.active_weapon);
                if (weaponImg && weaponImg.complete && weaponImg.naturalHeight > 0) {
                    // Draw weapon icon left of the name
                    // Calculate width dynamically to maintain aspect ratio
                    const h = 12;
                    const aspect = weaponImg.naturalWidth / weaponImg.naturalHeight;
                    const w = h * aspect;
                    ctx.filter = 'brightness(0) invert(1)';
                    ctx.drawImage(weaponImg, px - nameWidth / 2 - w - 4, py - SIZES.TEXT_OFFSET_Y - 10, w, h);
                    ctx.filter = 'none';
                }
            }

            // Handled in unified real-time flash_duration block above
        }
    }
}
