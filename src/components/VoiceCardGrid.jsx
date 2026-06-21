import { h } from 'preact';

export default function VoiceCardGrid({ selectedMode, onSelectMode }) {
  const cards = [
    {
      mode: 'all',
      title: 'All Voices',
      icon: 'volume_up',
      description: 'Hear both your teammates and your opponents in the demo.'
    },
    {
      mode: 'team',
      title: 'Only Team',
      icon: 'group',
      description: "Hear only your team's voice communications."
    },
    {
      mode: 'opponent',
      title: 'Only Enemy',
      icon: 'swords',
      description: "Hear only your opponents' voice communications."
    },
    {
      mode: 'none',
      title: 'No Voices',
      icon: 'volume_off',
      description: 'Mute all voice communications in the demo.'
    }
  ];

  return (
    <div class="voice-selection">
      {cards.map((card) => (
        <div
          class={`voice-card ${selectedMode === card.mode ? 'active' : ''}`}
          key={card.mode}
          onClick={() => onSelectMode(card.mode)}
        >
          <h4>
            <span class="material-symbols-outlined" style={{ fontSize: '18px', marginRight: '6px', verticalAlign: 'middle' }}>
              {card.icon}
            </span>
            {card.title}
          </h4>
          <p>{card.description}</p>
        </div>
      ))}
    </div>
  );
}
