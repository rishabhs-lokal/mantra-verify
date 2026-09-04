// Per-practice YouTube video for the Meditation Room. Each practice plays
// its short on loop while the user follows along — mirrors vyasMantraConfig's
// youtubeId for the Mantra Room, minus the jaap-count/verification logic
// that room needs (meditation practices aren't counted or scored).
export const meditationVideoConfig: Record<string, string> = {
  vagus: 'mBISVBg0zKw', // 4-7-8 Breathing
  guided: 'FHsO0xGcfkA', // Guided Meditation
  affirmation: '3Q9McpoTwJE', // Manifestation Meditation
  box: 'nj0jDKzxLwo' // Box Breathing
};
