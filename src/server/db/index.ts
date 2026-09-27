import fs from 'fs';
import path from 'path';
import initSqlJs, { Database } from 'sql.js';
import {
  restoreDatabaseFromFirestoreIfNeeded,
  scheduleCloudBackup
} from './firestoreCloudBackup.js';

const DB_PATH = process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), 'data', 'nabd_social.sqlite');

let dbInstance: Database | null = null;
let saveTimeout: NodeJS.Timeout | null = null;

export function persistDatabaseImmediate() {
  if (!dbInstance) return;
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    const tempPath = `${DB_PATH}.tmp`;
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, DB_PATH);
    scheduleCloudBackup(() => (dbInstance ? dbInstance.export() : null));
  } catch (err) {
    console.error('[DB] Failed to persist SQLite database:', err);
  }
}

export function schedulePersist(immediate = false) {
  if (immediate) {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    persistDatabaseImmediate();
    return;
  }
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    persistDatabaseImmediate();
  }, 80);
}

let exitHooksRegistered = false;
function registerExitPersistHooks() {
  if (exitHooksRegistered) return;
  exitHooksRegistered = true;
  const flush = () => {
    try {
      persistDatabaseImmediate();
    } catch {
      // ignore
    }
  };
  process.on('beforeExit', flush);
  process.on('SIGINT', () => {
    flush();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    flush();
    process.exit(0);
  });
}

export async function initDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;

  const SQL = await initSqlJs();
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Restore from Firestore cloud backup if local file is missing or older than cloud backup
  await restoreDatabaseFromFirestoreIfNeeded(DB_PATH);

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    dbInstance = new SQL.Database(fileBuffer);
  } else {
    dbInstance = new SQL.Database();
  }

  dbInstance.run('PRAGMA foreign_keys = ON;');
  dbInstance.run('PRAGMA synchronous = NORMAL;');
  dbInstance.run('PRAGMA temp_store = MEMORY;');
  dbInstance.run('PRAGMA cache_size = -32000;');
  createSchema(dbInstance);
  seedSystemCatalogs(dbInstance);
  persistDatabaseImmediate();
  registerExitPersistHooks();

  return dbInstance;
}

export function getDb(): Database {
  if (!dbInstance) {
    throw new Error('Database not initialized yet. Call initDatabase() first.');
  }
  return dbInstance;
}

export function dbAll<T = any>(sql: string, params: any[] = []): T[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return rows;
}

export function dbGet<T = any>(sql: string, params: any[] = []): T | undefined {
  const rows = dbAll<T>(sql, params);
  return rows[0];
}

export function dbRun(sql: string, params: any[] = []): void {
  const db = getDb();
  db.run(sql, params);
  schedulePersist();
}

function createSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_guest INTEGER DEFAULT 0,
      profile_completed INTEGER DEFAULT 0,
      avatar_url TEXT DEFAULT '',
      banner_url TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      country TEXT DEFAULT 'السعودية',
      age INTEGER DEFAULT 22,
      gender TEXT DEFAULT 'male',
      role TEXT DEFAULT 'Member',
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      gold INTEGER DEFAULT 50,
      gems INTEGER DEFAULT 0,
      total_support_power INTEGER DEFAULT 0,
      public_msg_count INTEGER DEFAULT 0,
      name_color TEXT DEFAULT '',
      font_color TEXT DEFAULT '',
      active_frame TEXT DEFAULT '',
      active_badge TEXT DEFAULT '',
      active_effect TEXT DEFAULT '',
      status_text TEXT DEFAULT 'متصل الآن',
      is_muted INTEGER DEFAULT 0,
      muted_until INTEGER DEFAULT 0,
      is_banned INTEGER DEFAULT 0,
      banned_until INTEGER DEFAULT 0,
      ban_reason TEXT DEFAULT '',
      last_xp_tick INTEGER DEFAULT 0,
      last_daily_claim INTEGER DEFAULT 0,
      daily_xp_converted INTEGER DEFAULT 0,
      daily_xp_reset_day TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'public',
      is_private INTEGER DEFAULT 0,
      room_code TEXT DEFAULT '',
      password_hash TEXT DEFAULT '',
      banner_url TEXT DEFAULT '',
      avatar_url TEXT DEFAULT '',
      owner_id TEXT,
      is_locked INTEGER DEFAULT 0,
      slow_mode_seconds INTEGER DEFAULT 0,
      max_seats INTEGER DEFAULT 5,
      welcome_message TEXT DEFAULT 'أهلاً وسهلاً بكم في الغرفة، نرجو الالتزام بالاحترام المتبادل.',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      media_url TEXT DEFAULT '',
      media_type TEXT DEFAULT 'text',
      is_system INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS room_moderation (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      expires_at INTEGER DEFAULT 0,
      reason TEXT DEFAULT '',
      moderator_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friends (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL,
      addressee_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      UNIQUE(requester_id, addressee_id),
      FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL,
      following_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (follower_id, following_id),
      FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ignored_users (
      user_id TEXT NOT NULL,
      ignored_user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, ignored_user_id)
    );

    CREATE TABLE IF NOT EXISTS private_messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL,
      content TEXT NOT NULL,
      media_url TEXT DEFAULT '',
      media_type TEXT DEFAULT 'text',
      is_read INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      media_url TEXT DEFAULT '',
      media_type TEXT NOT NULL DEFAULT 'text',
      caption TEXT DEFAULT '',
      bg_style TEXT DEFAULT 'from-indigo-900 via-slate-900 to-slate-950',
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS story_views (
      story_id TEXT NOT NULL,
      viewer_id TEXT NOT NULL,
      liked INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (story_id, viewer_id),
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
      FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reels (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      video_url TEXT NOT NULL,
      thumbnail_url TEXT DEFAULT '',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      views_count INTEGER DEFAULT 0,
      likes_count INTEGER DEFAULT 0,
      comments_count INTEGER DEFAULT 0,
      shares_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reel_views (
      reel_id TEXT NOT NULL,
      viewer_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (reel_id, viewer_id)
    );

    CREATE TABLE IF NOT EXISTS reel_likes (
      reel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (reel_id, user_id),
      FOREIGN KEY (reel_id) REFERENCES reels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reel_comments (
      id TEXT PRIMARY KEY,
      reel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (reel_id) REFERENCES reels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wall_posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      media_url TEXT DEFAULT '',
      likes_count INTEGER DEFAULT 0,
      comments_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wall_likes (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS wall_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (post_id) REFERENCES wall_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS store_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      item_type TEXT NOT NULL,
      currency TEXT NOT NULL,
      price INTEGER NOT NULL,
      css_value TEXT NOT NULL,
      icon_name TEXT DEFAULT 'Sparkles',
      min_level INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS user_inventory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      is_equipped INTEGER DEFAULT 0,
      purchased_at INTEGER NOT NULL,
      UNIQUE(user_id, item_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES store_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS gifts_catalog (
      id TEXT PRIMARY KEY,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      currency TEXT NOT NULL,
      cost INTEGER NOT NULL,
      bar_power INTEGER NOT NULL,
      icon_emoji TEXT NOT NULL,
      tier TEXT NOT NULL,
      effect_class TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gift_transactions (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL,
      gift_id TEXT NOT NULL,
      context_type TEXT NOT NULL,
      context_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      cost INTEGER NOT NULL,
      bar_power INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (gift_id) REFERENCES gifts_catalog(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS live_streams (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL,
      title TEXT NOT NULL,
      topic TEXT DEFAULT 'سوالف وصوتيات',
      status TEXT NOT NULL DEFAULT 'active',
      support_bar INTEGER DEFAULT 0,
      total_taps INTEGER DEFAULT 0,
      max_seats INTEGER DEFAULT 4,
      battle_status TEXT DEFAULT 'Idle',
      battle_mode TEXT DEFAULT 'Classic',
      battle_round INTEGER DEFAULT 0,
      battle_started_at INTEGER DEFAULT 0,
      battle_duration INTEGER DEFAULT 120,
      battle_invite_expires_at INTEGER DEFAULT 0,
      battle_opponent_id TEXT DEFAULT '',
      battle_opponent_name TEXT DEFAULT '',
      battle_opponent_avatar TEXT DEFAULT '',
      battle_opponent_accepted INTEGER DEFAULT 0,
      battle_host_score INTEGER DEFAULT 0,
      battle_opponent_score INTEGER DEFAULT 0,
      battle_third_id TEXT DEFAULT '',
      battle_third_name TEXT DEFAULT '',
      battle_third_avatar TEXT DEFAULT '',
      battle_third_accepted INTEGER DEFAULT 0,
      battle_third_score INTEGER DEFAULT 0,
      battle_ends_at INTEGER DEFAULT 0,
      battle_winner_id TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      ended_at INTEGER DEFAULT 0,
      FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      notif_type TEXT DEFAULT 'info',
      is_read INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      resolved_by TEXT DEFAULT '',
      resolution_note TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_name TEXT PRIMARY KEY,
      rank_order INTEGER NOT NULL,
      badge_label TEXT NOT NULL,
      badge_color TEXT NOT NULL,
      can_manage_users INTEGER DEFAULT 0,
      can_manage_roles INTEGER DEFAULT 0,
      can_manage_rooms INTEGER DEFAULT 0,
      can_moderate_chat INTEGER DEFAULT 0,
      can_manage_live INTEGER DEFAULT 0,
      can_manage_economy INTEGER DEFAULT 0,
      can_view_reports INTEGER DEFAULT 0,
      can_access_admin INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS uploaded_files (
      filename TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  const alterColumns = [
    'ALTER TABLE live_streams ADD COLUMN ended_at INTEGER DEFAULT 0;',
    'ALTER TABLE live_streams ADD COLUMN battle_round INTEGER DEFAULT 0;',
    'ALTER TABLE live_streams ADD COLUMN battle_started_at INTEGER DEFAULT 0;',
    'ALTER TABLE live_streams ADD COLUMN battle_duration INTEGER DEFAULT 300;',
    'ALTER TABLE live_streams ADD COLUMN battle_invite_expires_at INTEGER DEFAULT 0;',
    'ALTER TABLE live_streams ADD COLUMN battle_opponent_avatar TEXT DEFAULT "";',
    'ALTER TABLE live_streams ADD COLUMN battle_opponent_live_id TEXT DEFAULT "";',
    'ALTER TABLE live_streams ADD COLUMN battle_opponent_accepted INTEGER DEFAULT 0;',
    'ALTER TABLE live_streams ADD COLUMN battle_third_avatar TEXT DEFAULT "";',
    'ALTER TABLE live_streams ADD COLUMN battle_third_accepted INTEGER DEFAULT 0;',
    'ALTER TABLE live_streams ADD COLUMN battle_punishment_ends_at INTEGER DEFAULT 0;',
    'ALTER TABLE live_streams ADD COLUMN open_stage INTEGER DEFAULT 1;',
    'ALTER TABLE users ADD COLUMN allow_follow_requests INTEGER DEFAULT 1;',
    'ALTER TABLE users ADD COLUMN pm_privacy TEXT DEFAULT "everyone";',
    'ALTER TABLE users ADD COLUMN call_privacy TEXT DEFAULT "everyone";',
    'ALTER TABLE users ADD COLUMN hide_online_status INTEGER DEFAULT 0;'
  ];
  for (const sql of alterColumns) {
    try {
      db.run(sql);
    } catch {
      // Column already exists
    }
  }

  // Performance Indexes for +60 Concurrent Users
  const indexQueries = [
    'CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);',
    'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);',
    'CREATE INDEX IF NOT EXISTS idx_room_msgs_room ON room_messages(room_id, created_at);',
    'CREATE INDEX IF NOT EXISTS idx_pm_sender_rec ON private_messages(sender_id, receiver_id, created_at);',
    'CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);',
    'CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);',
    'CREATE INDEX IF NOT EXISTS idx_live_status ON live_streams(status, host_id);'
  ];
  for (const idxSql of indexQueries) {
    try {
      db.run(idxSql);
    } catch {
      // ignore
    }
  }

  // Migrate any legacy accepted/pending friendships into follows table seamlessly
  try {
    db.run(`
      INSERT OR IGNORE INTO follows (follower_id, following_id, created_at)
      SELECT requester_id, addressee_id, created_at FROM friends;
    `);
    db.run(`
      INSERT OR IGNORE INTO follows (follower_id, following_id, created_at)
      SELECT addressee_id, requester_id, created_at FROM friends WHERE status = 'accepted';
    `);
  } catch {
    // ignore
  }

  // Enforce 4 seats maximum (1 Host + 3 Guests) and purge any legacy dummy battle records
  try {
    db.run('UPDATE live_streams SET max_seats = 4 WHERE max_seats != 4;');
    db.run(`
      UPDATE live_streams
      SET battle_status = 'Idle',
          battle_opponent_id = '',
          battle_opponent_name = '',
          battle_third_id = '',
          battle_third_name = '',
          battle_winner_id = ''
      WHERE battle_opponent_id IN ('opponent', 'third')
         OR battle_third_id IN ('opponent', 'third')
         OR battle_winner_id IN ('opponent', 'third');
    `);
  } catch {
    // Ignore
  }
}

function seedSystemCatalogs(db: Database) {
  const now = Date.now();

  // 1. Seed Default Rooms (Public General, Girls, Boys)
  const existingRooms = dbAll('SELECT id FROM rooms LIMIT 1');
  if (existingRooms.length === 0) {
    const defaultRooms = [
      {
        id: 'room-general',
        name: 'الغرفة العامة',
        description: 'المجلس العربي العام للنقاش، التعارف، والدردشة الصوتية والكتابية لجميع الأعضاء.',
        category: 'general',
        is_private: 0,
        room_code: 'GEN-100',
        banner_url: '/src/assets/images/room_banner_general_1790452755617.jpg',
        welcome_message: 'أهلاً بكم في الغرفة العامة — احترم الجميع واستمتع بوقتك معنا!'
      },
      {
        id: 'room-girls',
        name: 'غرفة البنات',
        description: 'مساحة راقية مخصصة للفتيات فقط للسوالف، الموضة، والفن والقصص اليومية.',
        category: 'female',
        is_private: 0,
        room_code: 'GRL-200',
        banner_url: '/src/assets/images/room_banner_girls_1790452764290.jpg',
        welcome_message: 'مرحباً بكِ في مجلس البنات — خصوصية، أناقة، وسوالف ممتعة.'
      },
      {
        id: 'room-boys',
        name: 'غرفة الأولاد',
        description: 'مجلس الشباب للنقاشات الرياضية، التقنية، الألعاب، والتحديات الصوتية.',
        category: 'male',
        is_private: 0,
        room_code: 'BOY-300',
        banner_url: '/src/assets/images/room_banner_boys_1790452774299.jpg',
        welcome_message: 'حياكم الله في غرفة الشباب — تحديات، نقاشات، ومقاعد صوتية مفتوحة.'
      }
    ];

    for (const r of defaultRooms) {
      db.run(
        `INSERT INTO rooms (id, name, description, category, is_private, room_code, banner_url, welcome_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.name, r.description, r.category, r.is_private, r.room_code, r.banner_url, r.welcome_message, now]
      );
    }
  }

  // 2. Seed Exact Gifts Catalog (5 Gold Gifts + 5 Gem Gifts as specified)
  const existingGifts = dbAll('SELECT id FROM gifts_catalog LIMIT 1');
  if (existingGifts.length === 0) {
    const gifts = [
      // Gold Support Gifts
      { id: 'gift-gold-item', name_ar: 'سبيكة ذهب', name_en: 'Gold Item', currency: 'gold', cost: 100, bar_power: 200, icon_emoji: '🪙', tier: 'standard', effect_class: 'from-amber-500/30 to-yellow-600/20 border-amber-400/50' },
      { id: 'gift-tea-cup', name_ar: 'فنجان شاي عربي', name_en: 'Tea Cup', currency: 'gold', cost: 250, bar_power: 300, icon_emoji: '🍵', tier: 'standard', effect_class: 'from-emerald-500/30 to-teal-600/20 border-emerald-400/50' },
      { id: 'gift-headphones', name_ar: 'سماعات استوديو', name_en: 'Headphones', currency: 'gold', cost: 500, bar_power: 600, icon_emoji: '🎧', tier: 'medium', effect_class: 'from-sky-500/30 to-blue-600/20 border-sky-400/50' },
      { id: 'gift-phone', name_ar: 'هاتف ذكي فاخر', name_en: 'Phone', currency: 'gold', cost: 1000, bar_power: 1050, icon_emoji: '📱', tier: 'medium', effect_class: 'from-indigo-500/30 to-violet-600/20 border-indigo-400/50' },
      { id: 'gift-computer', name_ar: 'حاسوب احترافي', name_en: 'Computer', currency: 'gold', cost: 2000, bar_power: 3000, icon_emoji: '💻', tier: 'high', effect_class: 'from-purple-500/40 to-fuchsia-600/20 border-purple-400/60' },
      // Gem Support Gifts (Rare)
      { id: 'gift-airplane', name_ar: 'طائرة خاصة', name_en: 'Airplane', currency: 'gems', cost: 100, bar_power: 10000, icon_emoji: '✈️', tier: 'epic', effect_class: 'from-cyan-500/40 to-blue-700/30 border-cyan-300/70' },
      { id: 'gift-teddy-bear', name_ar: 'الدب الملكي', name_en: 'Teddy Bear', currency: 'gems', cost: 300, bar_power: 25000, icon_emoji: '🧸', tier: 'epic', effect_class: 'from-pink-500/40 to-rose-700/30 border-pink-300/70' },
      { id: 'gift-lamp', name_ar: 'المصباح السحري', name_en: 'Lamp', currency: 'gems', cost: 500, bar_power: 50000, icon_emoji: '🪔', tier: 'legendary', effect_class: 'from-amber-400/50 to-orange-700/40 border-amber-300/80' },
      { id: 'gift-falcon', name_ar: 'الصقر الحر', name_en: 'Falcon', currency: 'gems', cost: 1000, bar_power: 100000, icon_emoji: '🦅', tier: 'legendary', effect_class: 'from-red-500/50 to-amber-700/40 border-red-300/80' },
      { id: 'gift-lion', name_ar: 'الأسد الذهبي', name_en: 'Lion', currency: 'gems', cost: 1500, bar_power: 200000, icon_emoji: '🦁', tier: 'mythic', effect_class: 'from-yellow-400/60 via-amber-500/50 to-red-700/50 border-yellow-200' }
    ];

    for (const g of gifts) {
      db.run(
        `INSERT INTO gifts_catalog (id, name_ar, name_en, currency, cost, bar_power, icon_emoji, tier, effect_class)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [g.id, g.name_ar, g.name_en, g.currency, g.cost, g.bar_power, g.icon_emoji, g.tier, g.effect_class]
      );
    }
  }

  // 3. Seed Store Items (Badges, Frames, Name Colors, Profile Effects)
  const existingStore = dbAll('SELECT id FROM store_items LIMIT 1');
  if (existingStore.length === 0) {
    const items = [
      { id: 'item-color-gold', name: 'لون اسم ذهبي ملكي', description: 'يميز اسمك باللون الذهبي اللامع في جميع الغرف والدردشات.', item_type: 'name_color', currency: 'gold', price: 150, css_value: '#FBBF24', icon_name: 'Palette', min_level: 1 },
      { id: 'item-color-cyan', name: 'لون اسم سماوي متألق', description: 'لون سماوي صافي يبرز اسمك داخل الرسائل وقائمة المتصلين.', item_type: 'name_color', currency: 'gold', price: 120, css_value: '#38BDF8', icon_name: 'Palette', min_level: 1 },
      { id: 'item-color-rose', name: 'لون اسم وردي ياقوتي', description: 'إطلالة وردية أنيقة لاسم المستخدم في الغرف والبثوث.', item_type: 'name_color', currency: 'gold', price: 120, css_value: '#FB7185', icon_name: 'Palette', min_level: 1 },
      { id: 'item-frame-emerald', name: 'إطار الزمرد النقي', description: 'إطار دائري زمردي يحيط بصورتك الشخصية في الغرف والبروفايل.', item_type: 'frame', currency: 'gold', price: 300, css_value: 'ring-2 ring-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.45)]', icon_name: 'Sparkles', min_level: 2 },
      { id: 'item-frame-royal', name: 'إطار التاج البنفسجي', description: 'إطار ملكي متوهج خاص بنخبة الأعضاء والداعمين.', item_type: 'frame', currency: 'gold', price: 600, css_value: 'ring-2 ring-purple-400 shadow-[0_0_15px_rgba(192,132,252,0.55)]', icon_name: 'Crown', min_level: 3 },
      { id: 'item-frame-mythic', name: 'إطار اللهب الأسطوري', description: 'إطار نادر جداً بالعملات الماسية يمنح حضورك هيبة خاصة.', item_type: 'frame', currency: 'gems', price: 80, css_value: 'ring-2 ring-amber-300 shadow-[0_0_18px_rgba(251,191,36,0.75)]', icon_name: 'Flame', min_level: 5 },
      { id: 'item-badge-vip', name: 'وسام VIP الماسي', description: 'يظهر بجانب اسمك في جميع غرف الدردشة والبثوث الصوتية.', item_type: 'badge', currency: 'gold', price: 500, css_value: '💎 VIP مميز', icon_name: 'Award', min_level: 2 },
      { id: 'item-badge-knight', name: 'وسام فارس المجلس', description: 'وسام شرفي للمتفاعلين في الغرف والجولات الصوتية.', item_type: 'badge', currency: 'gold', price: 350, css_value: '⚔️ فارس المجلس', icon_name: 'Shield', min_level: 2 },
      { id: 'item-badge-star', name: 'وسام نجم البثوث', description: 'وسام نادر بالماس يبرز مكانتك بين صناع المحتوى والداعمين.', item_type: 'badge', currency: 'gems', price: 120, css_value: '🌟 نجم ساطع', icon_name: 'Star', min_level: 4 },
      { id: 'item-effect-royal', name: 'تأثير دخول مهيب', description: 'يظهر إشعار ترحيبي مميز عند دخولك أي غرفة دردشة أو بث مباشر.', item_type: 'effect', currency: 'gold', price: 450, css_value: 'royal-entry', icon_name: 'Zap', min_level: 2 }
    ];

    for (const item of items) {
      db.run(
        `INSERT INTO store_items (id, name, description, item_type, currency, price, css_value, icon_name, min_level, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [item.id, item.name, item.description, item.item_type, item.currency, item.price, item.css_value, item.icon_name, item.min_level]
      );
    }
  }

  // 4. Seed Role Hierarchy & Permissions
  const existingRoles = dbAll('SELECT role_name FROM role_permissions LIMIT 1');
  if (existingRoles.length === 0) {
    const roles = [
      { role_name: 'Owner', rank_order: 100, badge_label: '👑 المالك', badge_color: 'bg-amber-500/20 text-amber-300 border-amber-400/40', u: 1, r: 1, rm: 1, m: 1, l: 1, e: 1, rp: 1, a: 1 },
      { role_name: 'Super Admin', rank_order: 90, badge_label: '⚡ سوبر أدمن', badge_color: 'bg-purple-500/20 text-purple-300 border-purple-400/40', u: 1, r: 1, rm: 1, m: 1, l: 1, e: 1, rp: 1, a: 1 },
      { role_name: 'Admin', rank_order: 80, badge_label: '🛡️ أدمن', badge_color: 'bg-indigo-500/20 text-indigo-300 border-indigo-400/40', u: 1, r: 0, rm: 1, m: 1, l: 1, e: 0, rp: 1, a: 1 },
      { role_name: 'Moderator', rank_order: 70, badge_label: '⚖️ مشرف عام', badge_color: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40', u: 0, r: 0, rm: 0, m: 1, l: 1, e: 0, rp: 1, a: 1 },
      { role_name: 'Room Moderator', rank_order: 60, badge_label: '🎙️ مشرف غرفة', badge_color: 'bg-teal-500/20 text-teal-300 border-teal-400/40', u: 0, r: 0, rm: 0, m: 1, l: 0, e: 0, rp: 0, a: 0 },
      { role_name: 'VIP', rank_order: 50, badge_label: '💎 VIP', badge_color: 'bg-rose-500/20 text-rose-300 border-rose-400/40', u: 0, r: 0, rm: 0, m: 0, l: 0, e: 0, rp: 0, a: 0 },
      { role_name: 'Member', rank_order: 20, badge_label: 'عضو', badge_color: 'bg-slate-700/40 text-slate-300 border-slate-600/40', u: 0, r: 0, rm: 0, m: 0, l: 0, e: 0, rp: 0, a: 0 },
      { role_name: 'Guest', rank_order: 10, badge_label: 'زائر', badge_color: 'bg-slate-800/60 text-slate-400 border-slate-700/40', u: 0, r: 0, rm: 0, m: 0, l: 0, e: 0, rp: 0, a: 0 }
    ];

    for (const role of roles) {
      db.run(
        `INSERT INTO role_permissions (
          role_name, rank_order, badge_label, badge_color,
          can_manage_users, can_manage_roles, can_manage_rooms, can_moderate_chat,
          can_manage_live, can_manage_economy, can_view_reports, can_access_admin
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [role.role_name, role.rank_order, role.badge_label, role.badge_color, role.u, role.r, role.rm, role.m, role.l, role.e, role.rp, role.a]
      );
    }
  }

  // 5. Seed Platform Settings
  const existingSettings = dbAll('SELECT key FROM platform_settings LIMIT 1');
  if (existingSettings.length === 0) {
    const defaultSettings = [
      ['platform_name', 'نبض المجالس'],
      ['announcement_banner', 'أهلاً بكم في منصة نبض المجالس — أول حساب مسجل يحصل تلقائياً على رتبة المالك (Owner) لإدارة المنصة بالكامل!'],
      ['xp_per_minute', '1'],
      ['messages_per_gold', '20'],
      ['daily_gold_reward', '25'],
      ['allow_guest_login', 'true'],
      ['maintenance_mode', 'false']
    ];
    for (const [k, v] of defaultSettings) {
      db.run('INSERT INTO platform_settings (key, value) VALUES (?, ?)', [k, v]);
    }
  }
}
