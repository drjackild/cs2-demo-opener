import { PlayerActor } from './PlayerActor';
import { GrenadeActor } from './GrenadeActor';
import { EffectActor } from './EffectActor';

export class ReplayEngine {
    static preprocessEvents(chunkData) {
        if (!chunkData || !chunkData.ticks) return null;

        const bullets = [];
        const tasers = [];
        const knifes = [];
        const explosions = [];
        const smokes = [];
        const infernos = [];
        const flashes = [];
        const blinds = [];
        
        let activeBombAction = null;
        const bombActions = [];
        let bombPlantedEvent = null;
        let bombExplodedEvent = null;
        let bombDefusedEvent = null;

        const activeSmokes = {};
        const activeInfernos = {};
        const activeFlashes = {};

        for (let i = 0; i < chunkData.ticks.length; i++) {
            const tickData = chunkData.ticks[i];
            const t = tickData.tick;

            // Check if active action has ended due to weapon swap, death, or stopping defusal
            if (activeBombAction) {
                const player = tickData.players?.find(p => p.steam_id === activeBombAction.steam_id);
                if (player) {
                    if (activeBombAction.type === 'plant') {
                        if (!player.is_alive || player.active_weapon?.toLowerCase() !== 'c4') {
                            activeBombAction.end_i = i;
                            activeBombAction.success = false;
                            bombActions.push(activeBombAction);
                            activeBombAction = null;
                        }
                    } else if (activeBombAction.type === 'defuse') {
                        if (!player.is_alive || !player.is_defusing) {
                            activeBombAction.end_i = i;
                            activeBombAction.success = false;
                            bombActions.push(activeBombAction);
                            activeBombAction = null;
                        }
                    }
                } else {
                    activeBombAction.end_i = i;
                    activeBombAction.success = false;
                    bombActions.push(activeBombAction);
                    activeBombAction = null;
                }
            }

            // Check player flash_duration to build accurate blinds list
            if (tickData.players) {
                for (const p of tickData.players) {
                    if (p.flash_duration > 0) {
                        if (!activeFlashes[p.player_id]) {
                            activeFlashes[p.player_id] = {
                                start_i: i
                            };
                        }
                    } else {
                        if (activeFlashes[p.player_id]) {
                            const flash = activeFlashes[p.player_id];
                            blinds.push({
                                player_id: p.player_id,
                                start_i: flash.start_i,
                                end_i: i,
                                duration_ticks: Math.max(1, i - flash.start_i)
                            });
                            delete activeFlashes[p.player_id];
                        }
                    }
                }
            }

            for (const ev of tickData.events) {
                if (ev.event_type === 'weapon_fire') {
                    if (ev.weapon === 'weapon_taser') {
                        tasers.push({ tick: t, i, x: ev.x, y: ev.y, z: ev.z, yaw: ev.yaw });
                    } else if (ev.weapon.includes('knife') || ev.weapon === 'weapon_bayonet') {
                        knifes.push({ tick: t, i, x: ev.x, y: ev.y, z: ev.z, yaw: ev.yaw });
                    } else if (ev.weapon !== 'weapon_hegrenade' && ev.weapon !== 'weapon_flashbang' && ev.weapon !== 'weapon_smokegrenade' && ev.weapon !== 'weapon_molotov' && ev.weapon !== 'weapon_incgrenade' && ev.weapon !== 'weapon_decoy' && ev.weapon !== 'weapon_c4') {
                        bullets.push({ tick: t, i, x: ev.x, y: ev.y, z: ev.z, yaw: ev.yaw });
                    }
                } else if (ev.event_type === 'hegrenade_detonate') {
                    explosions.push({ tick: t, i, x: ev.x, y: ev.y, z: ev.z, weapon: ev.weapon, entityid: ev.entityid });
                } else if (ev.event_type === 'flashbang_detonate') {
                    flashes.push({ tick: t, i, x: ev.x, y: ev.y, z: ev.z, entityid: ev.entityid });
                } else if (ev.event_type === 'player_blind') {
                    // Handled in player tick data loop above for accurate timing
                } else if (ev.event_type === 'smokegrenade_detonate') {
                    activeSmokes[ev.entityid] = { start_i: i, start_tick: t, x: ev.x, y: ev.y, z: ev.z, end_i: chunkData.ticks.length, entityid: ev.entityid };
                } else if (ev.event_type === 'smokegrenade_expired') {
                    if (activeSmokes[ev.entityid]) {
                        activeSmokes[ev.entityid].end_i = i;
                        smokes.push(activeSmokes[ev.entityid]);
                        delete activeSmokes[ev.entityid];
                    }
                } else if (ev.event_type === 'inferno_startburn') {
                    activeInfernos[ev.entityid] = { start_i: i, start_tick: t, x: ev.x, y: ev.y, z: ev.z, weapon: ev.weapon, team: ev.team, end_i: chunkData.ticks.length, entityid: ev.entityid };
                } else if (ev.event_type === 'inferno_expire') {
                    if (activeInfernos[ev.entityid]) {
                        activeInfernos[ev.entityid].end_i = i;
                        infernos.push(activeInfernos[ev.entityid]);
                        delete activeInfernos[ev.entityid];
                    }
                } else if (ev.event_type === 'bomb_beginplant') {
                    activeBombAction = { steam_id: ev.steam_id, type: 'plant', start_i: i };
                } else if (ev.event_type === 'bomb_abortplant') {
                    if (activeBombAction && activeBombAction.type === 'plant') {
                        activeBombAction.end_i = i;
                        activeBombAction.success = false;
                        bombActions.push(activeBombAction);
                        activeBombAction = null;
                    }
                } else if (ev.event_type === 'bomb_planted') {
                    bombPlantedEvent = { i, x: ev.x, y: ev.y, z: ev.z };
                    if (activeBombAction && activeBombAction.type === 'plant') {
                        activeBombAction.end_i = i;
                        activeBombAction.success = true;
                        bombActions.push(activeBombAction);
                        activeBombAction = null;
                    }
                } else if (ev.event_type === 'bomb_begindefuse') {
                    activeBombAction = { steam_id: ev.steam_id, type: 'defuse', start_i: i };
                } else if (ev.event_type === 'bomb_abortdefuse') {
                    if (activeBombAction && activeBombAction.type === 'defuse') {
                        activeBombAction.end_i = i;
                        activeBombAction.success = false;
                        bombActions.push(activeBombAction);
                        activeBombAction = null;
                    }
                } else if (ev.event_type === 'bomb_defused') {
                    bombDefusedEvent = { i, x: ev.x, y: ev.y, z: ev.z };
                    if (activeBombAction && activeBombAction.type === 'defuse') {
                        activeBombAction.end_i = i;
                        activeBombAction.success = true;
                        bombActions.push(activeBombAction);
                        activeBombAction = null;
                    }
                } else if (ev.event_type === 'bomb_exploded') {
                    bombExplodedEvent = { i, x: ev.x, y: ev.y, z: ev.z };
                }
            }
        }

        Object.values(activeSmokes).forEach(s => smokes.push(s));
        Object.values(activeInfernos).forEach(f => infernos.push(f));

        // Flush any active flashes at the end of the chunk
        Object.keys(activeFlashes).forEach(player_id => {
            const flash = activeFlashes[player_id];
            blinds.push({
                player_id: Number(player_id),
                start_i: flash.start_i,
                end_i: chunkData.ticks.length,
                duration_ticks: Math.max(1, chunkData.ticks.length - flash.start_i)
            });
        });

        if (activeBombAction) {
            activeBombAction.end_i = chunkData.ticks.length;
            activeBombAction.success = false;
            bombActions.push(activeBombAction);
        }

        return { bullets, tasers, knifes, explosions, smokes, infernos, flashes, blinds, bombActions, bombPlantedEvent, bombExplodedEvent, bombDefusedEvent };
    }

    static renderFrame(ctx, width, height, tickIndex, chunkData, processedEvents, mapMeta, mapImage, lowerMapImage, activeFloor, transformRef) {
        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.translate(transformRef.current.x, transformRef.current.y);
        ctx.scale(transformRef.current.scale, transformRef.current.scale);

        // Scale logical coordinates (0 to 1024) to physical canvas dimensions
        const scaleX = width / 1024;
        const scaleY = height / 1024;
        ctx.scale(scaleX, scaleY);

        // Background
        ctx.fillStyle = '#000000';
        ctx.fillRect(-5000, -5000, 10000, 10000);

        // Maps
        if (activeFloor === 'upper') {
            if (mapImage) {
                ctx.globalAlpha = 1.0;
                ctx.drawImage(mapImage, 2, 2, mapImage.width - 4, mapImage.height - 4, 0, 0, 1024, 1024);
            }
            if (lowerMapImage) {
                ctx.globalAlpha = 0.5;
                ctx.drawImage(lowerMapImage, 2, 2, lowerMapImage.width - 4, lowerMapImage.height - 4, 0, 0, 1024, 1024);
            }
        } else {
            if (lowerMapImage) {
                ctx.globalAlpha = 1.0;
                ctx.drawImage(lowerMapImage, 2, 2, lowerMapImage.width - 4, lowerMapImage.height - 4, 0, 0, 1024, 1024);
            }
            if (mapImage) {
                ctx.globalAlpha = 0.5;
                ctx.drawImage(mapImage, 2, 2, mapImage.width - 4, mapImage.height - 4, 0, 0, 1024, 1024);
            }
        }
        ctx.globalAlpha = 1.0;

        if (!chunkData || !chunkData.ticks || chunkData.ticks.length === 0 || !processedEvents) {
            ctx.restore();
            return;
        }

        const tickFloor = Math.floor(tickIndex);
        const tickCeil = Math.min(tickFloor + 1, chunkData.ticks.length - 1);
        const fraction = tickIndex - tickFloor;

        const dataStart = chunkData.ticks[tickFloor];
        const dataEnd = chunkData.ticks[tickCeil];

        if (!dataStart) {
            ctx.restore();
            return;
        }

        const currentI = tickFloor;
        const transformX = (x) => (x - mapMeta.pos_x) / mapMeta.scale;
        const transformY = (y) => (mapMeta.pos_y - y) / mapMeta.scale;
        const isLower = (z) => mapMeta.z_split !== undefined ? z < mapMeta.z_split : false;

        // Players Setup and Collision Resolution
        const playerRenderData = [];
        for (const p of dataStart.players) {
            if (!p.is_alive) continue;
            let nextP = null;
            if (dataEnd && dataStart !== dataEnd) {
                nextP = dataEnd.players.find(x => x.steam_id === p.steam_id);
            }
            let finalX = p.x;
            let finalY = p.y;
            if (nextP && nextP.is_alive) {
                finalX = p.x + (nextP.x - p.x) * fraction;
                finalY = p.y + (nextP.y - p.y) * fraction;
            }
            playerRenderData.push({ 
                p, 
                nextP, 
                px: transformX(finalX), 
                py: transformY(finalY), 
                offsetX: 0, 
                offsetY: 0,
                z: p.z,
                zDisplaced: null
            });
        }

        // Check for overlapping players to show height indicator
        const PLAYER_RADIUS = 8;
        const MIN_DIST = PLAYER_RADIUS * 4; // Increased so it triggers when they are near each other
        const MIN_DIST_SQ = MIN_DIST * MIN_DIST;

        for (let i = 0; i < playerRenderData.length; i++) {
            for (let j = i + 1; j < playerRenderData.length; j++) {
                const p1 = playerRenderData[i];
                const p2 = playerRenderData[j];
                const dx = p1.px - p2.px;
                const dy = p1.py - p2.py;
                const distSq = dx * dx + dy * dy;

                if (distSq < MIN_DIST_SQ) {
                    // Mark players if they overlap and have a significant height difference
                    if (Math.abs(p1.z - p2.z) > 80) {
                        if (p1.z > p2.z) {
                            p1.zDisplaced = 'above';
                            p2.zDisplaced = 'below';
                        } else {
                            p1.zDisplaced = 'below';
                            p2.zDisplaced = 'above';
                        }
                    }
                }
            }
        }

        for (const data of playerRenderData) {
            PlayerActor.draw(ctx, data.p, data.nextP, fraction, currentI, processedEvents, activeFloor, isLower, transformX, transformY, data.offsetX, data.offsetY, data.zDisplaced);
        }

        // Bullets
        for (const b of (processedEvents.bullets || [])) {
            EffectActor.drawTracer(ctx, b, currentI, activeFloor, isLower, transformX, transformY);
        }

        // Tasers
        for (const t of (processedEvents.tasers || [])) {
            EffectActor.drawTaser(ctx, t, currentI, activeFloor, isLower, transformX, transformY);
        }

        // Knifes
        for (const k of (processedEvents.knifes || [])) {
            EffectActor.drawKnife(ctx, k, currentI, activeFloor, isLower, transformX, transformY);
        }

        // Bomb Explosion
        if (processedEvents.bombExplodedEvent) {
            if (processedEvents.bombPlantedEvent) {
                processedEvents.bombExplodedEvent.x = processedEvents.bombPlantedEvent.x;
                processedEvents.bombExplodedEvent.y = processedEvents.bombPlantedEvent.y;
                processedEvents.bombExplodedEvent.z = processedEvents.bombPlantedEvent.z;
            }
            GrenadeActor.drawBombExplosion(ctx, processedEvents.bombExplodedEvent, currentI, activeFloor, isLower, transformX, transformY);
        }

        // HE Explosions
        for (const ex of (processedEvents.explosions || [])) {
            GrenadeActor.drawExplosion(ctx, ex, currentI, activeFloor, isLower, transformX, transformY);
        }

        // Flashbangs
        for (const fb of (processedEvents.flashes || [])) {
            GrenadeActor.drawFlashbang(ctx, fb, currentI, activeFloor, isLower, transformX, transformY);
        }

        // Smokes
        for (const s of (processedEvents.smokes || [])) {
            GrenadeActor.drawSmoke(ctx, s, currentI, activeFloor, isLower, transformX, transformY);
        }

        // Infernos
        for (const f of (processedEvents.infernos || [])) {
            GrenadeActor.drawInferno(ctx, f, currentI, activeFloor, isLower, transformX, transformY);
        }

        // Active Grenades / Planted C4
        if (dataStart.grenades) {
            for (const g of dataStart.grenades) {
                // Skip C4 entities if they are being handled by the explicit event drawing below
                if (g.class_name.includes("PlantedC4")) continue;
                GrenadeActor.drawProjectile(ctx, g, currentI, processedEvents, activeFloor, isLower, transformX, transformY, tickIndex);
            }
        }

        // Draw Planted Bomb explicitly from event data (bypasses entity tracking issues)
        if (processedEvents.bombPlantedEvent && currentI >= processedEvents.bombPlantedEvent.i) {
            let shouldDraw = true;
            if (processedEvents.bombExplodedEvent && currentI >= processedEvents.bombExplodedEvent.i) {
                shouldDraw = false;
            }
            if (processedEvents.bombDefusedEvent && currentI >= processedEvents.bombDefusedEvent.i) {
                shouldDraw = false;
            }
            if (shouldDraw) {
                GrenadeActor.drawPlantedBomb(ctx, processedEvents.bombPlantedEvent, currentI, activeFloor, isLower, transformX, transformY, tickIndex);
            }
        }

        ctx.restore();
    }
}
