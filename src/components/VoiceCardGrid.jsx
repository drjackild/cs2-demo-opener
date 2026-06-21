import { h } from 'preact';
import { VolumeUpIcon, GroupIcon, CrosshairIcon, VolumeOffIcon } from './Icons';

export default function VoiceCardGrid({ selectedMode, onSelectMode }) {
  const cards = [
    {
      mode: 'all',
      title: 'All Voices',
      icon: VolumeUpIcon,
      description: 'Hear both your teammates and your opponents in the demo.'
    },
    {
      mode: 'team',
      title: 'Only Team',
      icon: GroupIcon,
      description: "Hear only your team's voice communications."
    },
    {
      mode: 'opponent',
      title: 'Only Enemy',
      icon: CrosshairIcon,
      description: "Hear only your opponents' voice communications."
    },
    {
      mode: 'none',
      title: 'No Voices',
      icon: VolumeOffIcon,
      description: 'Mute all voice communications in the demo.'
    }
  ];

  return (
    <div class="voice-selection">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            class={`voice-card ${selectedMode === card.mode ? 'active' : ''}`}
            key={card.mode}
            onClick={() => onSelectMode(card.mode)}
          >
            <h4>
              <Icon />
              {card.title}
            </h4>
            <p>{card.description}</p>
          </div>
        );
      })}
    </div>
  );
}
