export class EffectActor {
    static drawTracer(ctx, b, currentI, activeFloor, isLower, transformX, transformY) {
        if (currentI >= b.i && currentI < b.i + 5) {
            const onActiveFloor = (activeFloor === 'lower' && isLower(b.z)) || (activeFloor === 'upper' && !isLower(b.z));
            ctx.globalAlpha = onActiveFloor ? (1.0 - (currentI - b.i) / 5.0) : 0.1;

            const px = transformX(b.x);
            const py = transformY(b.y);
            const angleRad = -(b.yaw * Math.PI) / 180.0 + Math.PI;

            const progress = (currentI - b.i) / 5.0;
            const distancePixels = progress * 36; // Fly maximum for 3 radius (1 radius = 12ish usually)
            const dashLength = 10; // Length of each dash is roughly the size of the player

            const startX = px + Math.cos(angleRad) * distancePixels;
            const startY = py + Math.sin(angleRad) * distancePixels;
            const endX = px + Math.cos(angleRad) * (distancePixels + dashLength);
            const endY = py + Math.sin(angleRad) * (distancePixels + dashLength);

            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.strokeStyle = '#fcd34d';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]); // Make it look like '---' dashes
            ctx.stroke();
            ctx.stroke();
            ctx.setLineDash([]); // Reset
        }
    }

    static drawTaser(ctx, t, currentI, activeFloor, isLower, transformX, transformY) {
        if (currentI >= t.i && currentI < t.i + 15) {
            const onActiveFloor = (activeFloor === 'lower' && isLower(t.z)) || (activeFloor === 'upper' && !isLower(t.z));
            ctx.globalAlpha = onActiveFloor ? (1.0 - (currentI - t.i) / 15.0) : 0.1;

            const px = transformX(t.x);
            const py = transformY(t.y);
            const angleRad = -(t.yaw * Math.PI) / 180.0 + Math.PI;
            
            const distancePixels = 15;
            const endX = px + Math.cos(angleRad) * distancePixels;
            const endY = py + Math.sin(angleRad) * distancePixels;

            ctx.beginPath();
            ctx.moveTo(px, py);
            // Draw zigzag for lightning effect
            const midX = px + Math.cos(angleRad + 0.5) * (distancePixels / 2);
            const midY = py + Math.sin(angleRad + 0.5) * (distancePixels / 2);
            ctx.lineTo(midX, midY);
            ctx.lineTo(endX, endY);

            ctx.strokeStyle = '#38bdf8'; // Lightning blue
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    static drawKnife(ctx, k, currentI, activeFloor, isLower, transformX, transformY) {
        if (currentI >= k.i && currentI < k.i + 10) {
            const onActiveFloor = (activeFloor === 'lower' && isLower(k.z)) || (activeFloor === 'upper' && !isLower(k.z));
            ctx.globalAlpha = onActiveFloor ? (1.0 - (currentI - k.i) / 10.0) : 0.1;

            const px = transformX(k.x);
            const py = transformY(k.y);
            const angleRad = -(k.yaw * Math.PI) / 180.0 + Math.PI;

            const distancePixels = 10;
            
            ctx.beginPath();
            // Draw a slash arc
            ctx.arc(px, py, distancePixels, angleRad - 0.5, angleRad + 0.5, false);
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }
}
