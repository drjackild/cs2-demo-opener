import React, { useState, useEffect } from 'react';
import './replay.css';

export default function KillFeed({ chunkData, currentTick, ticksPerSecond = 64 }) {
  const [allKills, setAllKills] = useState([]);

  useEffect(() => {
    if (!chunkData || !chunkData.ticks) return;
    
    const kills = [];
    chunkData.ticks.forEach(t => {
      if (t.events) {
        t.events.forEach(e => {
          if (e.event_type === 'player_death') {
             const attacker = t.players.find(p => p.steam_id === e.attacker_id);
             const victim = t.players.find(p => p.steam_id === e.steam_id);
             if (!victim) return; // Ignore non-player kills (e.g. chickens)
             
             const assister = t.players.find(p => p.steam_id === e.assister_id);
             kills.push({
               id: `${t.tick}-${Math.random()}`,
               tick: t.tick,
               weapon: e.weapon,
               headshot: e.headshot,
               penetrated: e.penetrated,
               thrusmoke: e.thrusmoke,
               noscope: e.noscope,
               attackerblind: e.attackerblind,
               attackerName: attacker ? attacker.name : 'Unknown',
               attackerTeam: attacker ? attacker.team : 0,
               victimName: victim ? victim.name : 'Unknown',
               victimTeam: victim ? victim.team : 0,
               assisterName: assister ? assister.name : null,
               assisterTeam: assister ? assister.team : 0,
             });
          }
        });
      }
    });
    setAllKills(kills);
  }, [chunkData]);

  if (allKills.length === 0) return null;

  const activeKills = allKills.filter(k => currentTick >= k.tick && currentTick - k.tick < ticksPerSecond * 5);
  
  if (activeKills.length === 0) return null;

  return (
    <div className="killfeed-container">
      {activeKills.map(kill => (
        <div key={kill.id} className="killfeed-entry">
          {kill.attackerName && (
            <span className={kill.attackerTeam === 2 ? 'text-t' : 'text-ct'}>
              {kill.attackerName}
            </span>
          )}
          
          {kill.assisterName && (
            <>
              <span className="killfeed-assist">+</span>
              <span className={kill.assisterTeam === 2 ? 'text-t' : 'text-ct'}>
                {kill.assisterName}
              </span>
            </>
          )}
          <div className="killfeed-icons">
            <img src={`/weapons/${kill.weapon.replace('weapon_', '')}.svg`} alt={kill.weapon} className="killfeed-weapon" onError={(e) => e.target.style.display = 'none'} />
            {kill.penetrated > 0 && <img src="/icons/penetrate.svg" alt="Wallbang" className="killfeed-modifier-icon" onError={(e) => e.target.style.display = 'none'} />}
            {kill.thrusmoke && <img src="/icons/smoke.svg" alt="Through Smoke" className="killfeed-modifier-icon" onError={(e) => e.target.style.display = 'none'} />}
            {kill.attackerblind && <img src="/icons/blind.svg" alt="Blind Kill" className="killfeed-modifier-icon" onError={(e) => e.target.style.display = 'none'} />}
            {kill.noscope && <img src="/icons/noscope.svg" alt="No Scope" className="killfeed-modifier-icon" onError={(e) => e.target.style.display = 'none'} />}
            {kill.headshot && <img src="/icons/headshot.svg" alt="HS" className="killfeed-hs" onError={(e) => e.target.style.display = 'none'} />}
          </div>

          <span className={kill.victimTeam === 2 ? 'text-t' : 'text-ct'}>
            {kill.victimName}
          </span>
        </div>
      ))}
    </div>
  );
}
