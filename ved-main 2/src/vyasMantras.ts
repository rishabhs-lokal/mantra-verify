// Per-mantra config for the Vyas-powered Mantra Room: the Devanagari text
// sent to /api/vyas/verify_chant as reference_text (Whisper transcribes into
// Devanagari, so scoring needs a Devanagari target, not the Latin-transliterated
// label shown elsewhere in the UI), and the YouTube video Vyas plays on loop
// in "Vyas Chants" mode.
export interface VyasMantraConfig {
  referenceText: string;
  youtubeId: string | null;
}

export const vyasMantraConfig: Record<string, VyasMantraConfig> = {
  shivaya: { referenceText: 'ॐ नमः शिवाय', youtubeId: 'gVjSyex902E' },
  hanumate: { referenceText: 'ॐ श्री हनुमते नमः', youtubeId: 'RMkaQ7QyMEY' },
  ram: { referenceText: 'जय श्री राम', youtubeId: 'PPE9V6SBKcQ' },
  durga: { referenceText: 'जय माँ दुर्गा', youtubeId: 'O6Le96b7FBE' }
};
