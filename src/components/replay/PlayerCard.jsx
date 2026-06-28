import React from 'react';
import { SIZES, getTeamColor } from '../../canvas/constants';
import './replay.css'; // Make sure the new CSS classes are picked up

function getWeaponIcon(wepName) {
    if (!wepName) return '';
    let lower = wepName.toLowerCase();
    
    // specific mappings
    if (lower === 'incendiarygrenade') return 'incgrenade';
    if (lower === 'molotovgrenade') return 'molotov';
    if (lower === 'decoygrenade') return 'decoy';
    if (lower === 'c4') return 'c4';
    if (lower === 'm4a1') return 'm4a1_silencer'; // M4A1-S is usually called weapon_m4a1 in events
    
    return lower;
}

export default function PlayerCard({ p }) {
  const isDead = !p.is_alive || p.hp <= 0;

  const inventory = p.inventory || [];
  
  const isSecondary = (icon) => ['glock', 'hkp2000', 'usp_silencer', 'p250', 'tec9', 'fiveseven', 'cz75a', 'deagle', 'revolver', 'elite'].includes(icon);
  const isGrenade = (icon) => ['smokegrenade', 'flashbang', 'hegrenade', 'molotov', 'incgrenade', 'decoy'].includes(icon);
  const isKnife = (icon) => icon === 'knife' || icon.startsWith('knife_');
  const isC4 = (icon) => icon === 'c4';
  
  const mappedInv = inventory.map(w => ({ name: w, icon: getWeaponIcon(w) }));
  
  const grenades = mappedInv.filter(w => isGrenade(w.icon));
  const secondaries = mappedInv.filter(w => isSecondary(w.icon));
  const knives = mappedInv.filter(w => isKnife(w.icon));
  const c4 = mappedInv.find(w => isC4(w.icon));
  
  // Primary is anything that isn't secondary, grenade, knife, or c4
  const primaries = mappedInv.filter(w => !isSecondary(w.icon) && !isGrenade(w.icon) && !isKnife(w.icon) && !isC4(w.icon));

  return (
      <div className={`player-card-v2 ${p.team === 3 ? 'team-ct' : 'team-t'} ${isDead ? 'dead' : ''}`}>
          <div className="pc-top-row">
              <div className={`pc-hp ${p.hp <= 25 ? 'low-hp' : ''}`}>
                  {isDead ? '0' : p.hp}
              </div>
              <div className="pc-name">
                  {p.has_bomb && <img src="/weapons/c4.svg" alt="C4" className="pc-icon c4-icon" />}
                  {p.name}
                  <div className="pc-armor-group">
                      {p.armor > 0 && <img src="/weapons/armor.svg" alt="Armor" className="pc-icon" />}
                      {p.has_helmet && <img src="/weapons/helmet.svg" alt="Helmet" className="pc-icon helmet-icon" />}
                  </div>
              </div>
              <div className="pc-top-right">
                  {p.has_defuser && <img src="/weapons/defuser.svg" alt="Defuse Kit" className="pc-icon" />}
                  {primaries.map((w, idx) => (
                      <img key={idx} src={`/weapons/${w.icon}.svg`} alt={w.name} className={`pc-weapon ${p.active_weapon === w.name ? 'active' : ''}`} onError={(e) => { e.target.style.display = 'none'; }} />
                  ))}
              </div>
          </div>
          <div className="pc-bottom-row">
              <div className="pc-money">
                  ${p.money ?? 0}
              </div>
              <div className="pc-kda">
                  {p.kills ?? 0} / {p.deaths ?? 0} / {p.assists ?? 0}
              </div>
              <div className="pc-bottom-right">
                  <div className="pc-grenades">
                      {grenades.map((w, idx) => (
                          <img key={idx} src={`/weapons/${w.icon}.svg`} alt={w.name} className={`pc-weapon ${p.active_weapon === w.name ? 'active' : ''}`} onError={(e) => { e.target.style.display = 'none'; }} />
                      ))}
                  </div>
                  <div className="pc-secondaries">
                      {secondaries.map((w, idx) => (
                          <img key={idx} src={`/weapons/${w.icon}.svg`} alt={w.name} className={`pc-weapon ${p.active_weapon === w.name ? 'active' : ''}`} onError={(e) => { e.target.style.display = 'none'; }} />
                      ))}
                      {/* Always show knives in their own dedicated space alongside secondaries */}
                      {knives.map((w, idx) => (
                          <img key={`knife-${idx}`} src={`/weapons/${w.icon}.svg`} alt={w.name} className={`pc-weapon ${p.active_weapon === w.name ? 'active' : ''}`} onError={(e) => { e.target.style.display = 'none'; }} />
                      ))}
                  </div>
              </div>
          </div>
      </div>
  );
}
