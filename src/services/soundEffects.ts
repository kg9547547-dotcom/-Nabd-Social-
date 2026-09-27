// Web Audio API Sound Effects Service (Zero external asset latency, works across all browsers)

export interface SoundPreferences {
  enabled: boolean;
  roomJoinSound: boolean;
  chatSendSound: boolean;
  chatReplySound: boolean;
  giftSound: boolean;
}

const SOUND_PREFS_KEY = 'nabd_sound_preferences';

const defaultPrefs: SoundPreferences = {
  enabled: true,
  roomJoinSound: true,
  chatSendSound: true,
  chatReplySound: true,
  giftSound: true
};

let cachedPrefs: SoundPreferences | null = null;
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      audioCtx = new AudioCtx();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function getSoundPreferences(): SoundPreferences {
  if (cachedPrefs) return cachedPrefs;
  if (typeof window === 'undefined') return defaultPrefs;
  try {
    const raw = localStorage.getItem(SOUND_PREFS_KEY);
    if (raw) {
      cachedPrefs = { ...defaultPrefs, ...JSON.parse(raw) };
      return cachedPrefs!;
    }
  } catch {
    // ignore storage errors
  }
  cachedPrefs = { ...defaultPrefs };
  return cachedPrefs;
}

export function updateSoundPreferences(partial: Partial<SoundPreferences>): SoundPreferences {
  const current = getSoundPreferences();
  const next = { ...current, ...partial };
  cachedPrefs = next;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(SOUND_PREFS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
  return next;
}

function playTone(
  freq: number,
  durationSec: number,
  type: OscillatorType = 'sine',
  gainValue = 0.08,
  delaySec = 0
) {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const startTime = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(gainValue, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + durationSec + 0.02);
  } catch {
    // Ignore audio context autoplay restrictions before first user gesture
  }
}

/**
 * Sound played when a user joins the room
 */
export function playRoomJoinSound() {
  const prefs = getSoundPreferences();
  if (!prefs.enabled || !prefs.roomJoinSound) return;
  playTone(587.33, 0.14, 'sine', 0.07, 0); // D5
  playTone(880.0, 0.22, 'triangle', 0.08, 0.09); // A5
}

/**
 * Sound played when current user sends a message in public or live chat
 */
export function playChatSendSound() {
  const prefs = getSoundPreferences();
  if (!prefs.enabled || !prefs.chatSendSound) return;
  playTone(660, 0.08, 'sine', 0.06, 0);
  playTone(880, 0.1, 'sine', 0.05, 0.04);
}

/**
 * Sound played when someone replies to / mentions the user or sends a chat message
 */
export function playChatReplySound(isDirectReply = false) {
  const prefs = getSoundPreferences();
  if (!prefs.enabled || !prefs.chatReplySound) return;
  if (isDirectReply) {
    playTone(783.99, 0.12, 'triangle', 0.09, 0); // G5
    playTone(1046.5, 0.18, 'triangle', 0.1, 0.1); // C6
    playTone(1318.5, 0.24, 'sine', 0.08, 0.2); // E6
  } else {
    playTone(523.25, 0.07, 'sine', 0.04, 0);
  }
}

/**
 * TikTok-style celebratory sound when a gift or PK interaction occurs
 */
export function playGiftSound(tierOrRare: string | boolean = false) {
  const prefs = getSoundPreferences();
  if (!prefs.enabled || !prefs.giftSound) return;
  const isRareGem = tierOrRare === true || tierOrRare === 'legendary' || tierOrRare === 'epic';
  if (isRareGem) {
    playTone(523.25, 0.14, 'triangle', 0.1, 0); // C5
    playTone(659.25, 0.14, 'triangle', 0.1, 0.08); // E5
    playTone(783.99, 0.14, 'triangle', 0.1, 0.16); // G5
    playTone(1046.5, 0.35, 'sine', 0.12, 0.24); // C6
    playTone(1318.5, 0.45, 'triangle', 0.1, 0.34); // E6
  } else {
    playTone(659.25, 0.12, 'sine', 0.08, 0);
    playTone(880, 0.15, 'triangle', 0.09, 0.07);
    playTone(1046.5, 0.25, 'sine', 0.09, 0.14);
  }
}

/**
 * Sound played on incoming notification or private message
 */
export function playNotificationSound() {
  const prefs = getSoundPreferences();
  if (!prefs.enabled) return;
  playTone(740, 0.1, 'sine', 0.07, 0);
  playTone(987.77, 0.16, 'triangle', 0.08, 0.08);
}
