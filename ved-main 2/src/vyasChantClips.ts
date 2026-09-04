// Per-mantra intro clip for "You Chant" mode (Solo Mantra Chant / Samadhan's
// recommended-mantra path): a short clip of Vyas actually chanting that
// mantra, played 3 times as a demonstration before mic listening begins,
// then replaced by a freeze-frame still (stillSrc) for the rest of the
// session. Mantra identity for each clip was confirmed by transcribing its
// audio through the same Whisper pipeline /api/vyas/verify_chant uses.
export interface VyasChantClipConfig {
  videoSrc: string;
  stillSrc: string;
}

export const vyasChantClipConfig: Record<string, VyasChantClipConfig> = {
  shivaya: { videoSrc: '/videos/chant-shivaya.mp4', stillSrc: '/videos/chant-shivaya-still.jpg' },
  durga: { videoSrc: '/videos/chant-durga.mp4', stillSrc: '/videos/chant-durga-still.jpg' },
  ram: { videoSrc: '/videos/chant-ram.mp4', stillSrc: '/videos/chant-ram-still.jpg' },
  hanumate: { videoSrc: '/videos/chant-hanumate.mp4', stillSrc: '/videos/chant-hanumate-still.jpg' }
};
