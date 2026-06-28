import { SIZES, COLORS, getTeamColor } from './constants';

export class GrenadeActor {
    static drawSmoke(ctx, s, currentI, activeFloor, isLower, transformX, transformY) {
        if (currentI >= s.start_i && currentI < s.end_i) {
            const onActiveFloor = (activeFloor === 'lower' && isLower(s.z)) || (activeFloor === 'upper' && !isLower(s.z));
            ctx.globalAlpha = onActiveFloor ? 1.0 : 0.2;

            const px = transformX(s.x);
            const py = transformY(s.y);
            ctx.beginPath();
            ctx.arc(px, py, SIZES.SMOKE_RADIUS, 0, 2 * Math.PI, false);
            ctx.fillStyle = COLORS.SMOKE;
            ctx.fill();
        }
    }

    static drawInferno(ctx, f, currentI, activeFloor, isLower, transformX, transformY) {
        if (currentI >= f.start_i && currentI < f.end_i) {
            const onActiveFloor = (activeFloor === 'lower' && isLower(f.z)) || (activeFloor === 'upper' && !isLower(f.z));
            ctx.globalAlpha = onActiveFloor ? 1.0 : 0.2;

            const px = transformX(f.x);
            const py = transformY(f.y);
            ctx.beginPath();
            ctx.arc(px, py, SIZES.INFERNO_RADIUS, 0, 2 * Math.PI, false);
            ctx.fillStyle = COLORS.INFERNO;
            ctx.fill();
        }
    }

    static drawExplosion(ctx, ex, currentI, activeFloor, isLower, transformX, transformY) {
        if (currentI >= ex.i && currentI < ex.i + 30) {
            const onActiveFloor = (activeFloor === 'lower' && isLower(ex.z)) || (activeFloor === 'upper' && !isLower(ex.z));
            ctx.globalAlpha = onActiveFloor ? (1.0 - (currentI - ex.i) / 30.0) : 0.1;

            const px = transformX(ex.x);
            const py = transformY(ex.y);
            ctx.beginPath();
            ctx.arc(px, py, SIZES.EXPLOSION_RADIUS, 0, 2 * Math.PI, false);
            ctx.fillStyle = COLORS.EXPLOSION;
            ctx.fill();
        }
    }

    static drawFlashbang(ctx, fb, currentI, activeFloor, isLower, transformX, transformY) {
        if (currentI >= fb.i && currentI < fb.i + 15) {
            const onActiveFloor = (activeFloor === 'lower' && isLower(fb.z)) || (activeFloor === 'upper' && !isLower(fb.z));
            ctx.globalAlpha = onActiveFloor ? (1.0 - (currentI - fb.i) / 15.0) : 0.1;

            const px = transformX(fb.x);
            const py = transformY(fb.y);
            ctx.beginPath();
            ctx.arc(px, py, SIZES.EXPLOSION_RADIUS, 0, 2 * Math.PI, false);
            ctx.fillStyle = COLORS.FLASHBANG;
            ctx.fill();
        }
    }

    static drawBombExplosion(ctx, ex, currentI, activeFloor, isLower, transformX, transformY) {
        if (currentI >= ex.i && currentI < ex.i + 70) {
            const progress = (currentI - ex.i) / 70.0;
            ctx.globalAlpha = 1.0 - progress; // Show at full opacity on all levels

            const px = transformX(ex.x);
            const py = transformY(ex.y);
            // Expanding shockwave ring
            const maxRadius = 180;
            const currentRadius = maxRadius * Math.pow(progress, 0.4);

            ctx.beginPath();
            ctx.arc(px, py, currentRadius, 0, 2 * Math.PI, false);
            ctx.fillStyle = `rgba(239, 68, 68, ${0.5 * (1.0 - progress)})`;
            ctx.fill();

            ctx.lineWidth = 2;
            ctx.strokeStyle = `rgba(239, 68, 68, ${1.0 - progress})`;
            ctx.stroke();
        }
    }

    static drawProjectile(ctx, g, currentI, processedEvents, activeFloor, isLower, transformX, transformY, currentTickIndex) {
        let hide = false;
        if (g.class_name.includes("HEGrenade")) {
            hide = processedEvents.explosions.some(e => currentI >= e.i && e.entityid === g.id);
        } else if (g.class_name.includes("Flash")) {
            hide = processedEvents.flashes.some(f => currentI >= f.i && f.entityid === g.id);
        } else if (g.class_name.includes("Smoke")) {
            hide = processedEvents.smokes.some(s => currentI >= s.start_i && s.entityid === g.id);
        } else if (g.class_name.includes("Inferno") || g.class_name.includes("Molotov") || g.class_name.includes("Incendiary")) {
            hide = processedEvents.infernos.some(inf => currentI >= inf.start_i && inf.entityid === g.id);
        }
        if (hide) return;

        const onActiveFloor = (activeFloor === 'lower' && isLower(g.z)) || (activeFloor === 'upper' && !isLower(g.z));
        ctx.globalAlpha = onActiveFloor ? 1.0 : 0.3;

        const px = transformX(g.x);
        const py = transformY(g.y);

        if (g.class_name.includes("C4") || g.class_name.includes("PlantedC4")) {
            ctx.fillStyle = '#ef4444'; // Red for C4
            const size = SIZES.PROJECTILE_RADIUS * 2.5;
            ctx.fillRect(px - size/2, py - size/2, size, size);
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#000000';
            ctx.strokeRect(px - size/2, py - size/2, size, size);
            return;
        }

        ctx.beginPath();
        ctx.arc(px, py, SIZES.PROJECTILE_RADIUS, 0, 2 * Math.PI, false);

        if (g.class_name.includes("Smoke")) {
            ctx.fillStyle = '#64748b';
        } else if (g.class_name.includes("Inferno") || g.class_name.includes("Molotov") || g.class_name.includes("Incendiary")) {
            ctx.fillStyle = '#f97316';
        } else if (g.class_name.includes("Flash")) {
            ctx.fillStyle = '#ffffff';
        } else if (g.class_name.includes("HEGrenade")) {
            ctx.fillStyle = '#22c55e';
        } else {
            ctx.fillStyle = '#94a3b8'; // default
        }

        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#000000';
        ctx.stroke();
    }

    static drawPlantedBomb(ctx, ev, currentI, activeFloor, isLower, transformX, transformY, currentTickIndex) {
        const onActiveFloor = (activeFloor === 'lower' && isLower(ev.z)) || (activeFloor === 'upper' && !isLower(ev.z));
        ctx.globalAlpha = onActiveFloor ? 1.0 : 0.3;

        const px = transformX(ev.x);
        const py = transformY(ev.y);

        let timeElapsed = (currentI - ev.i) / 16.0;
        const timeLeft = Math.max(0, 40.0 - timeElapsed);

        // Blink logic: normal state is red, blink state is bright red
        const blinkRate = Math.max(0.1, (timeLeft / 40.0) * 1.5);
        const blinkCycle = timeElapsed % blinkRate;
        const isBlinking = blinkCycle < blinkRate * 0.3;

        // Pulsating halo
        const pulse = (currentTickIndex % 64) / 64.0;
        ctx.beginPath();
        ctx.arc(px, py, SIZES.PROJECTILE_RADIUS * 1.5 + (pulse * 8), 0, 2 * Math.PI, false);
        ctx.fillStyle = `rgba(239, 68, 68, ${0.4 * (1.0 - pulse)})`;
        ctx.fill();

        // Draw square instead of circle
        const size = SIZES.PROJECTILE_RADIUS * 2.5;
        ctx.fillStyle = isBlinking ? '#ff6b6b' : '#ef4444'; // Bright red vs Normal Red
        ctx.fillRect(px - size/2, py - size/2, size, size);
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#000000';
        ctx.strokeRect(px - size/2, py - size/2, size, size);

        // Draw timer
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#ef4444'; // Red text
        ctx.textAlign = 'center';
        ctx.fillText(timeLeft.toFixed(1) + 's', px, py - 8);
    }
}
