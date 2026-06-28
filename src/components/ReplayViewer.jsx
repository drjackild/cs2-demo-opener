import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import protobuf from 'protobufjs';

let protoTypePromise = null;

function getProtoType() {
  if (!protoTypePromise) {
    protoTypePromise = fetch('/cs2_demo.proto')
      .then(res => res.text())
      .then(text => {
        const root = new protobuf.Root();
        protobuf.parse(text, root, { keepCase: true });
        return root.lookupType('cs2_demo.RoundChunk');
      });
  }
  return protoTypePromise;
}
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import ReplayCanvas from './ReplayCanvas';
import ReplayHeader from './replay/ReplayHeader';
import LoadingState from './replay/LoadingState';
import './replay/replay.css';

export default function ReplayViewer({ demoPath, mapName, onClose }) {
  const [currentRound, setCurrentRound] = useState(1);
  const [totalRounds, setTotalRounds] = useState(null);
  const [chunkData, setChunkData] = useState(null);
  const [matchInfo, setMatchInfo] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [parsedTicks, setParsedTicks] = useState(0);
  const [totalTicks, setTotalTicks] = useState(0);
  const [debugLog, setDebugLog] = useState(["Component mounted"]);

  const [playerMeta, setPlayerMeta] = useState({});
  const [mapBase64, setMapBase64] = useState(null);
  const [lowerMapBase64, setLowerMapBase64] = useState(null);
  const [activeFloor, setActiveFloor] = useState('upper');
  const [matchFinished, setMatchFinished] = useState(false);
  const chunkCacheRef = useRef({});

  const log = (msg) => {
    setDebugLog(prev => [...prev, msg]);
  };

  // When the component mounts, trigger the backend to start generating 2D data
  useEffect(() => {
    let unlistenProgress;

    async function startGeneration() {
      setGenerating(true);
      log(`Starting generation for: ${demoPath}`);

      try {
        log("Registering parse_init listener...");
        const unlistenInit = await listen('parse_init', (event) => {
          const ticks = event.payload || 0;
          log(`Total ticks in demo: ${ticks}`);
          setTotalTicks(ticks);
        });

        log("Registering parse_progress listener...");
        unlistenProgress = await listen('parse_progress', (event) => {
          if (event.payload === 4294967295) {
            log("Match restart detected! Resetting chunks...");
            setChunkData(null);
            chunkCacheRef.current = {};
            setMatchFinished(false);
            setCurrentRound(1);
            return;
          }
          log(`Progress tick: ${event.payload}`);
          setParsedTicks(event.payload);
        });
        log("parse_progress listener registered.");

        log("Registering parse_error listener...");
        const unlistenError = await listen('parse_error', (event) => {
          log(`Error from backend: ${event.payload}`);
          console.error('Backend emitted error:', event.payload);
          setError(event.payload);
          setGenerating(false);
        });
        log("parse_error listener registered.");

        log("Registering parse_complete listener...");
        const unlistenComplete = await listen('parse_complete', async (event) => {
          log(`Backend finished: ${event.payload.message}`);
          if (event.payload.total_rounds > 0) {
            setTotalRounds(event.payload.total_rounds);
          }
          try {
            const infoStr = await invoke('get_match_info', { demoPath });
            setMatchInfo(JSON.parse(infoStr));
            log("Match info loaded.");
          } catch (e) {
            log(`Failed to load match info: ${e}`);
          }
          setGenerating(false);
          loadRound(1);
        });
        log("parse_complete listener registered.");

        log("Fetching map radar image...");
        try {
          const b64 = await invoke('get_map_radar_base64', { mapName });
          setMapBase64(b64);
          log("Map radar loaded");

          try {
            const lowerB64 = await invoke('get_lower_map_radar_base64', { mapName });
            setLowerMapBase64(lowerB64);
            log("Lower map radar loaded");
          } catch (err) {
            log(`No lower map found for this map: ${err}`);
          }
        } catch (e) {
          log(`Failed to load radar: ${e}`);
        }

        log("Invoking generate_2d_data...");
        await invoke('generate_2d_data', { demoPath });
        log("generate_2d_data returned!");
        // We now wait for parse_complete to trigger pollForChunk(1)
      } catch (err) {
        log(`Exception caught: ${err}`);
        console.error('Failed to start 2D generation:', err);
        setError('Failed to start parser: ' + err.toString());
        setGenerating(false);
      }
    }

    startGeneration();

    // On unmount/close, cancel parsing
    return () => {
      if (unlistenProgress) {
        unlistenProgress();
      }
      invoke('cancel_2d_parsing').catch(console.error);
    };
  }, [demoPath]);

  const preloadNextRound = async (nextRoundNum) => {
    if (chunkCacheRef.current[nextRoundNum]) return;
    if (totalRounds && nextRoundNum > totalRounds) return;

    try {
      const rawBytes = await invoke('get_round_chunk', { demoPath, round: nextRoundNum });
      if (rawBytes) {
        const protoType = await getProtoType();
        const decoded = protoType.decode(new Uint8Array(rawBytes));
        const data = protoType.toObject(decoded, {
          keepCase: true,
          defaults: true,
          arrays: true,
          objects: true,
          oneofs: true
        });

        if (data.players_metadata) {
          const metaMap = {};
          for (const p of data.players_metadata) {
            metaMap[p.id] = p;
          }
          for (const tick of data.ticks) {
            tick.players = tick.players || [];
            tick.grenades = tick.grenades || [];
            tick.events = tick.events || [];
            for (const player of tick.players) {
              const meta = metaMap[player.player_id];
              if (meta) {
                player.steam_id = meta.steam_id;
                player.name = meta.name;
                player.team = meta.team;
              }
            }
          }
        }
        chunkCacheRef.current[nextRoundNum] = data;
        log(`Preloaded round ${nextRoundNum} in background.`);
      }
    } catch (e) {
      // Best-effort, ignore errors
    }
  };

  const loadRound = async (roundNum) => {
    setLoading(true);
    setError(null);

    // Check if in cache
    if (chunkCacheRef.current[roundNum]) {
      const data = chunkCacheRef.current[roundNum];
      setChunkData(data);
      setLoading(false);
      preloadNextRound(roundNum + 1);
      return;
    }

    let attempts = 0;
    const maxAttempts = 60; // wait up to 90 seconds

    const checkInterval = setInterval(async () => {
      attempts++;
      log(`Polling chunk ${roundNum} (attempt ${attempts})`);
      try {
        const rawBytes = await invoke('get_round_chunk', { demoPath, round: roundNum });
        if (rawBytes) {
          const protoType = await getProtoType();
          const decoded = protoType.decode(new Uint8Array(rawBytes));
          const data = protoType.toObject(decoded, {
            keepCase: true,
            defaults: true,
            arrays: true,
            objects: true,
            oneofs: true
          });

          // Reconstruct player fields from players_metadata to retain compatibility
          if (data.players_metadata) {
            const metaMap = {};
            for (const p of data.players_metadata) {
              metaMap[p.id] = p;
            }
            for (const tick of data.ticks) {
              tick.players = tick.players || [];
              tick.grenades = tick.grenades || [];
              tick.events = tick.events || [];
              for (const player of tick.players) {
                const meta = metaMap[player.player_id];
                if (meta) {
                  player.steam_id = meta.steam_id;
                  player.name = meta.name;
                  player.team = meta.team;
                }
              }
            }
          }

          chunkCacheRef.current[roundNum] = data;
          setChunkData(data);
          setLoading(false);
          clearInterval(checkInterval);

          preloadNextRound(roundNum + 1);
        }
      } catch (err) {
        // Chunk not ready yet
        if (attempts >= maxAttempts) {
          setError(`Timeout waiting for round ${roundNum}`);
          setLoading(false);
          clearInterval(checkInterval);
        }
      }
    }, 1500);

    return () => clearInterval(checkInterval);
  };

  const handleRoundChange = (round) => {
    setCurrentRound(round);
    setChunkData(null);
    setMatchFinished(false);
    loadRound(round);
  };

  const handleRoundComplete = () => {
    if (totalRounds && currentRound >= totalRounds) {
      setMatchFinished(true);
      return; // End of demo
    }
    const nextRound = currentRound + 1;
    setCurrentRound(nextRound);
    setChunkData(null);
    setMatchFinished(false);
    loadRound(nextRound);
  };

  return (
    <div className="replay-container">
      {/* 1. Header (Always visible once basic demo info is parsed) */}
      {!loading && !generating && (
        <ReplayHeader
          mapName={mapName}
          currentRound={currentRound}
          totalRounds={totalRounds}
          handleRoundChange={handleRoundChange}
          matchInfo={matchInfo}
          matchFinished={matchFinished}
        />
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'auto', position: 'relative' }}>
        {loading ? (
          <LoadingState
            generating={generating}
            totalTicks={totalTicks}
            parsedTicks={parsedTicks}
            currentRound={currentRound}
          />
        ) : error ? (
          <div style={{ color: '#ff4444', textAlign: 'center' }}>
            <p>Failed to load chunk.</p>
          </div>
        ) : chunkData ? (
          <div style={{ flex: 1, position: 'relative' }}>
            <ReplayCanvas chunkData={chunkData} mapBase64={mapBase64} lowerMapBase64={lowerMapBase64} activeFloor={activeFloor} setActiveFloor={setActiveFloor} playerMeta={playerMeta} mapName={mapName} onRoundComplete={handleRoundComplete} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
