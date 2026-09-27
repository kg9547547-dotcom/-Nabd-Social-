import crypto from 'crypto';
import { dbGet, dbRun } from '../db/index.js';
import { AuthUser } from '../auth/security.js';

/**
 * Level Formula:
 * Level 1 requires 100 XP to reach Level 2.
 * Cumulative XP required for Level L:
 * Each level L requires (L * 100) XP in that tier, or simple clean formula:
 * Level = Math.floor(xp / 100) + 1 (so 0..99 XP = Level 1 (0/100), 100..199 = Level 2, etc.)
 * Let's make it progressive & clear as requested:
 * Level 1: 0 / 100 XP -> at 100 XP becomes Level 2!
 */
export function calculateLevelFromXp(xp: number): {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progressPercent: number;
} {
  const safeXp = Math.max(0, Math.floor(xp));
  let level = 1;
  let threshold = 100;
  let remaining = safeXp;

  while (remaining >= threshold) {
    remaining -= threshold;
    level += 1;
    // Balanced scalable curve: Level 1=100, Level 2=150, Level 3=200, Level 4=250...
    threshold = 100 + (level - 1) * 50;
  }

  const progressPercent = Math.min(100, Math.round((remaining / threshold) * 100));
  return {
    level,
    currentLevelXp: remaining,
    nextLevelXp: threshold,
    progressPercent
  };
}

export function awardUserXp(userId: string, amount: number): { xp: number; level: number; leveledUp: boolean } {
  const user = dbGet<{ xp: number; level: number }>('SELECT xp, level FROM users WHERE id = ?', [userId]);
  if (!user) return { xp: 0, level: 1, leveledUp: false };

  const newXp = Math.max(0, user.xp + amount);
  const calc = calculateLevelFromXp(newXp);
  const leveledUp = calc.level > user.level;

  dbRun('UPDATE users SET xp = ?, level = ? WHERE id = ?', [newXp, calc.level, userId]);

  if (leveledUp) {
    // Award level-up bonus Gold!
    const bonusGold = calc.level * 15;
    dbRun('UPDATE users SET gold = gold + ? WHERE id = ?', [bonusGold, userId]);
    dbRun(
      'INSERT INTO notifications (id, user_id, title, body, notif_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        crypto.randomUUID(),
        userId,
        `ترقية إلى المستوى ${calc.level}! 🎉`,
        `مبارك! وصلت إلى المستوى ${calc.level} وحصلت على ${bonusGold} عملة ذهبية كمكافأة تقدم.`,
        'reward',
        Date.now()
      ]
    );
  }

  return { xp: newXp, level: calc.level, leveledUp };
}

/**
 * Server-side 1-minute presence XP heartbeat (+1 XP per minute)
 */
export function processMinuteHeartbeat(userId: string): {
  awarded: boolean;
  xp: number;
  level: number;
  gold: number;
  gems: number;
} {
  const now = Date.now();
  const user = dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) {
    return { awarded: false, xp: 0, level: 1, gold: 0, gems: 0 };
  }

  // Enforce at least 55 seconds between +1 XP ticks on server
  if (now - (user.last_xp_tick || 0) < 55000) {
    return {
      awarded: false,
      xp: user.xp,
      level: user.level,
      gold: user.gold,
      gems: user.gems
    };
  }

  const setting = dbGet<{ value: string }>('SELECT value FROM platform_settings WHERE key = ?', ['xp_per_minute']);
  const xpGain = Math.max(1, parseInt(setting?.value || '1', 10) || 1);

  dbRun('UPDATE users SET last_xp_tick = ? WHERE id = ?', [now, userId]);
  const res = awardUserXp(userId, xpGain);
  const updated = dbGet<{ gold: number; gems: number }>('SELECT gold, gems FROM users WHERE id = ?', [userId]);

  return {
    awarded: true,
    xp: res.xp,
    level: res.level,
    gold: updated?.gold ?? user.gold,
    gems: updated?.gems ?? user.gems
  };
}

// Track recent messages per user in memory to prevent spam farming Gold Coins
const userMessageRateMap = new Map<string, { lastMsgAt: number; lastContent: string }>();

/**
 * Process public message economy reward:
 * Every 20 non-spam public messages -> +1 Gold Coin & +2 XP
 */
export function recordPublicMessageActivity(userId: string, content: string): {
  goldAwarded: number;
  newMsgCount: number;
} {
  const now = Date.now();
  const prev = userMessageRateMap.get(userId);
  const trimmed = content.trim();

  // Anti-spam check: must be at least 2.5s after previous message and not identical spam
  if (prev && (now - prev.lastMsgAt < 2500 || (prev.lastContent === trimmed && now - prev.lastMsgAt < 15000))) {
    return { goldAwarded: 0, newMsgCount: 0 };
  }

  userMessageRateMap.set(userId, { lastMsgAt: now, lastContent: trimmed });

  const user = dbGet<{ public_msg_count: number }>('SELECT public_msg_count FROM users WHERE id = ?', [userId]);
  if (!user) return { goldAwarded: 0, newMsgCount: 0 };

  const newCount = (user.public_msg_count || 0) + 1;
  const setting = dbGet<{ value: string }>('SELECT value FROM platform_settings WHERE key = ?', ['messages_per_gold']);
  const threshold = Math.max(5, parseInt(setting?.value || '20', 10) || 20);

  let goldAwarded = 0;
  if (newCount % threshold === 0) {
    goldAwarded = 1;
    dbRun('UPDATE users SET public_msg_count = ?, gold = gold + 1 WHERE id = ?', [newCount, userId]);
    awardUserXp(userId, 5);
  } else {
    dbRun('UPDATE users SET public_msg_count = ? WHERE id = ?', [newCount, userId]);
    awardUserXp(userId, 1);
  }

  return { goldAwarded, newMsgCount: newCount };
}

/**
 * Convert XP to Gold Coins with strict server-side daily limit:
 * Rate: 20 XP -> 10 Gold Coins
 * Daily Limit: Max 200 XP converted per day so the economy cannot be broken
 */
export function convertXpToGold(userId: string, xpToConvert: number): {
  success: boolean;
  message: string;
  xp?: number;
  gold?: number;
  dailyRemaining?: number;
} {
  const cleanXp = Math.floor(Number(xpToConvert));
  if (!Number.isFinite(cleanXp) || cleanXp < 20 || cleanXp % 20 !== 0) {
    return { success: false, message: 'يجب أن تكون كمية الـ XP من مضاعفات 20 (بحد أدنى 20 XP).' };
  }

  const user = dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return { success: false, message: 'المستخدم غير موجود' };

  const todayStr = new Date().toISOString().slice(0, 10);
  const alreadyConvertedToday = user.daily_xp_reset_day === todayStr ? user.daily_xp_converted : 0;
  const DAILY_CAP = 200;

  if (alreadyConvertedToday + cleanXp > DAILY_CAP) {
    return {
      success: false,
      message: `لقد وصلت للحد اليومي المسموح لتحويل الـ XP (${DAILY_CAP} XP يومياً للحفاظ على توازن الاقتصاد). المتبقي لك اليوم: ${Math.max(0, DAILY_CAP - alreadyConvertedToday)} XP.`
    };
  }

  if (user.xp < cleanXp) {
    return { success: false, message: 'رصيد الـ XP لديك غير كافٍ لإتمام التحويل.' };
  }

  const goldGained = Math.floor(cleanXp / 2); // 20 XP = 10 Gold
  const newXp = user.xp - cleanXp;
  const newGold = user.gold + goldGained;
  const newConverted = alreadyConvertedToday + cleanXp;
  const newLevel = calculateLevelFromXp(newXp).level;

  dbRun(
    'UPDATE users SET xp = ?, level = ?, gold = ?, daily_xp_converted = ?, daily_xp_reset_day = ? WHERE id = ?',
    [newXp, newLevel, newGold, newConverted, todayStr, userId]
  );

  return {
    success: true,
    message: `تم تحويل ${cleanXp} XP إلى ${goldGained} عملة ذهبية بنجاح!`,
    xp: newXp,
    gold: newGold,
    dailyRemaining: DAILY_CAP - newConverted
  };
}

/**
 * Award rare Gems when another distinct user interacts with creator's content (Reels/Stories)
 */
const contentGemRewardTracker = new Set<string>();

export function rewardCreatorEngagementGem(creatorId: string, actorId: string, contentKey: string): boolean {
  if (!creatorId || !actorId || creatorId === actorId) return false; // Never reward self-views/self-likes
  const uniqueKey = `${creatorId}:${actorId}:${contentKey}`;
  if (contentGemRewardTracker.has(uniqueKey)) return false;
  contentGemRewardTracker.add(uniqueKey);

  // Award +2 Gems and +5 XP to content creator for genuine engagement
  dbRun('UPDATE users SET gems = gems + 2 WHERE id = ?', [creatorId]);
  awardUserXp(creatorId, 5);
  return true;
}
