import { h, Component, createRef } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import mapData from '../map_data.json';
import { TICK_INTERVAL_MS } from '../canvas/constants';
import { ReplayEngine } from '../canvas/ReplayEngine';
import TeamPanel from './replay/TeamPanel';
import FloorSelector from './replay/FloorSelector';
import PlaybackControls from './replay/PlaybackControls';
import KillFeed from './replay/KillFeed';

export default function ReplayCanvas({ chunkData, playerMeta, mapName, mapBase64, lowerMapBase64, activeFloor, setActiveFloor, onRoundComplete }) {
    const canvasRef = useRef(null);

    const requestRef = useRef();
    const lastTimeRef = useRef();
    const currentTickRef = useRef(0);
    const lastUiUpdateRef = useRef(0);
    const isPlayingRef = useRef(false);
    const isTimelineDraggingRef = useRef(false);
    const drawCanvasRef = useRef(null);

    // Zoom and pan state
    const transformRef = useRef({ scale: 1, x: 0, y: 0 });
    const isDraggingRef = useRef(false);
    const lastMousePosRef = useRef({ x: 0, y: 0 });
    const containerRef = useRef(null);

    const handleWheel = (e) => {
        e.preventDefault();
        const zoomDelta = e.deltaY * -0.001;
        let newScale = transformRef.current.scale * (1 + zoomDelta);
        newScale = Math.max(0.5, Math.min(newScale, 5.0));

        const rect = containerRef.current.parentElement.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const scaleRatio = newScale / transformRef.current.scale;
        const newX = mouseX - (mouseX - transformRef.current.x) * scaleRatio;
        const newY = mouseY - (mouseY - transformRef.current.y) * scaleRatio;

        transformRef.current = { scale: newScale, x: newX, y: newY };
        if (!isPlayingRef.current && drawCanvasRef.current) {
            drawCanvasRef.current(currentTickRef.current);
        }
    };

    const handleMouseDown = (e) => {
        isDraggingRef.current = true;
        lastMousePosRef.current = { x: e.clientX, y: e.clientY };
        if (containerRef.current && containerRef.current.parentElement) {
            containerRef.current.parentElement.style.cursor = 'grabbing';
        }
    };

    const handleMouseMove = (e) => {
        if (!isDraggingRef.current) return;
        const dx = e.clientX - lastMousePosRef.current.x;
        const dy = e.clientY - lastMousePosRef.current.y;

        transformRef.current = {
            scale: transformRef.current.scale,
            x: transformRef.current.x + dx,
            y: transformRef.current.y + dy
        };
        lastMousePosRef.current = { x: e.clientX, y: e.clientY };
        if (!isPlayingRef.current && drawCanvasRef.current) {
            drawCanvasRef.current(currentTickRef.current);
        }
    };

    const handleMouseUp = () => {
        isDraggingRef.current = false;
        if (containerRef.current && containerRef.current.parentElement) {
            containerRef.current.parentElement.style.cursor = 'grab';
        }
    };

    // Playback state
    const [currentTickIndex, setCurrentTickIndex] = useState(0);
    const [isPlayingState, setIsPlayingState] = useState(false);
    const setIsPlaying = (val) => { isPlayingRef.current = val; setIsPlayingState(val); };
    const [playbackSpeed, setPlaybackSpeed] = useState(1);

    const [mapImage, setMapImage] = useState(null);
    const [lowerMapImage, setLowerMapImage] = useState(null);

    // Processed events
    const [processedEvents, setProcessedEvents] = useState({ bullets: [], explosions: [], smokes: [], infernos: [], flashes: [], blinds: [] });

    useEffect(() => {
        if (mapBase64) {
            const img = new Image();
            img.onload = () => setMapImage(img);
            img.src = mapBase64;
        }
    }, [mapBase64]);

    useEffect(() => {
        if (lowerMapBase64) {
            const img = new Image();
            img.onload = () => setLowerMapImage(img);
            img.src = lowerMapBase64;
        }
    }, [lowerMapBase64]);

    // Map scaling
    const mapMeta = mapData[mapName] || { pos_x: -3000, pos_y: 2000, scale: 5.0 };

    const transformX = (x) => {
        return (x - mapMeta.pos_x) / mapMeta.scale;
    };

    const transformY = (y) => {
        return (mapMeta.pos_y - y) / mapMeta.scale;
    };

    const isLower = (z) => {
        if (mapMeta.z_split !== undefined) {
            return z < mapMeta.z_split;
        }
        return false;
    };

    // Playback loop
    const updateLoop = time => {
        if (lastTimeRef.current != undefined) {
            const deltaTime = time - lastTimeRef.current;
            const tickAdvance = (deltaTime / TICK_INTERVAL_MS) * playbackSpeed;

            let newTick = currentTickRef.current;
            if (!isTimelineDraggingRef.current) {
                newTick += tickAdvance;
            }

            if (chunkData && chunkData.ticks && chunkData.ticks.length > 0) {
                if (newTick >= chunkData.ticks.length - 1) {
                    newTick = chunkData.ticks.length - 1;
                    if (!isTimelineDraggingRef.current) {
                        setIsPlaying(false);
                        if (onRoundComplete) {
                            onRoundComplete();
                        }
                    }
                }
            } else {
                newTick = 0;
                if (!isTimelineDraggingRef.current) setIsPlaying(false);
            }

            currentTickRef.current = newTick;

            if (drawCanvasRef.current) {
                drawCanvasRef.current(newTick);
            }

            // Throttle React state updates to ~15fps (every 66ms) to prevent "Too many re-renders"
            if (time - lastUiUpdateRef.current > 66) {
                setCurrentTickIndex(newTick);
                lastUiUpdateRef.current = time;
            }
        }
        lastTimeRef.current = time;
        if (isPlayingRef.current) {
            requestRef.current = requestAnimationFrame(updateLoop);
        }
    };

    useEffect(() => {
        if (isPlayingState) {
            lastTimeRef.current = performance.now();
            requestRef.current = requestAnimationFrame(updateLoop);
        }
        return () => cancelAnimationFrame(requestRef.current);
    }, [isPlayingState, playbackSpeed, chunkData]);

    useEffect(() => {
        currentTickRef.current = 0;
        setCurrentTickIndex(0);
        setIsPlaying(true);

        const processed = ReplayEngine.preprocessEvents(chunkData);
        if (processed) {
            setProcessedEvents(processed);
        }
    }, [chunkData]);

    // Store drawing logic in a ref so updateLoop always has latest closures
    drawCanvasRef.current = (tickIndex) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ReplayEngine.renderFrame(
            ctx, 
            canvas.width, 
            canvas.height, 
            tickIndex, 
            chunkData, 
            processedEvents, 
            mapMeta, 
            mapImage, 
            lowerMapImage, 
            activeFloor, 
            transformRef
        );
    };

    return (
        <div className="replay-canvas-wrapper">

            <div className="replay-canvas-layout">

                {/* Left Panel: Team 1 (usually CT) */}
                <TeamPanel 
                    teamName="Team A" 
                    teamId={3} 
                    chunkData={chunkData} 
                    currentTickIndex={currentTickIndex} 
                />

                {/* Canvas */}
                <div
                    className="replay-canvas-container"
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                >
                    {/* UI Overlay */}
                    <div className="replay-overlay" onMouseDown={(e) => e.stopPropagation()} onMouseMove={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
                        {lowerMapBase64 && mapData[mapName]?.z_split !== undefined && (
                            <FloorSelector 
                                activeFloor={activeFloor} 
                                setActiveFloor={setActiveFloor} 
                            />
                        )}
                        <button
                            title="Reset zoom"
                            className="replay-reset-zoom"
                            onClick={(e) => {
                                e.stopPropagation();
                                transformRef.current = { scale: 1, x: 0, y: 0 };
                                if (!isPlayingRef.current && drawCanvasRef.current) drawCanvasRef.current(currentTickRef.current);
                            }}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 10V6a2 2 0 0 1 2-2h4"></path>
                                <path d="M14 4h4a2 2 0 0 1 2 2v4"></path>
                                <path d="M20 14v4a2 2 0 0 1-2 2h-4"></path>
                                <path d="M10 20H6a2 2 0 0 1-2-2v-4"></path>
                            </svg>
                        </button>
                    </div>

                    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
                        <canvas
                            ref={canvasRef}
                            width={1024}
                            height={1024}
                            style={{ width: '100%', height: '100%', display: 'block' }}
                        />
                    </div>
                    
                    <KillFeed 
                        chunkData={chunkData}
                        currentTick={chunkData?.ticks[Math.floor(currentTickIndex)]?.tick}
                    />
                </div>

                {/* Right Panel: Team 2 (usually T) */}
                <TeamPanel 
                    teamName="Team B" 
                    teamId={2} 
                    chunkData={chunkData} 
                    currentTickIndex={currentTickIndex} 
                />

            </div>

            <PlaybackControls 
                isPlaying={isPlayingState}
                setIsPlaying={setIsPlaying}
                playbackSpeed={playbackSpeed}
                setPlaybackSpeed={setPlaybackSpeed}
                currentTickIndex={currentTickIndex}
                setCurrentTickIndex={setCurrentTickIndex}
                currentTickRef={currentTickRef}
                isDraggingRef={isTimelineDraggingRef}
                chunkData={chunkData}
            />
        </div>
    );
}
