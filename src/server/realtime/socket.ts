import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import crypto from 'crypto';
import { dbAll, dbGet, dbRun } from '../db/index.js';
import { getUserBySessionToken, getRolePermission, AuthUser } from '../auth/security.js';
import { recordPublicMessageActivity, calculateLevelFromXp } from '../services/economy.js';

export interface VoiceSeatState {
  seatIndex: number;
  userId: string | null;
  username: string;
  displayName: string;
  avatarUrl: string;
  level: number;
  gender: string;
  role: string;
  activeFrame: string;
  isMuted: boolean;
  isLocked: boolean;
  isSpeaking: boolean;
  isCameraOn: boolean;
}

export const LIVE_MAX_SPEAKER_SEATS = 4; // Strictly 1 Host (seatIndex 0) + 3 Guests (seatIndex 1, 2, 3)

export interface LiveChatItem {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string;
  level: number;
  role: string;
  gender: string;
  type: 'chat' | 'gift' | 'join' | 'system';
  content: string;
  giftEmoji?: string;
  giftName?: string;
  giftPower?: number;
  createdAt: number;
}

// Authoritative in-memory state synced with DB
const roomVoiceSeats = new Map<string, VoiceSeatState[]>();
const roomConnectedUsers = new Map<string, Map<string, Set<string>>>(); // roomId -> (userId -> Set<socketId>)
const userSocketsMap = new Map<string, Set<string>>(); // userId -> Set<socketId>

// Live stream state
const liveViewers = new Map<string, Map<string, Set<string>>>(); // liveId -> (userId -> Set<socketId>)
const liveVoiceSeats = new Map<string, VoiceSeatState[]>(); // liveId -> seats (index 0 is Host, 1..3 are guests)
const liveTapAccumulators = new Map<string, { count: number; lastTapAt: number; recentTapsInWindow: number; windowStart: number }>(); // `${liveId}:${userId}`

export interface GuestJoinRequestState {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  level: number;
  gender: 'male' | 'female';
  activeFrame: string;
  withCamera: boolean;
  createdAt: number;
}
const liveGuestRequests = new Map<string, GuestJoinRequestState[]>(); // liveId -> pending viewer join requests

// Active WebRTC speaker sockets per session: `${contextType}:${contextId}` -> Map<socketId, userId>
const activeSpeakerSockets = new Map<string, Map<string, string>>();

let ioInstance: Server | null = null;

export function getIo(): Server | null {
  return ioInstance;
}

export function getOrInitRoomSeats(roomId: string, maxSeats = 5): VoiceSeatState[] {
  if (!roomVoiceSeats.has(roomId)) {
    const seats: VoiceSeatState[] = [];
    for (let i = 0; i < maxSeats; i++) {
      seats.push({
        seatIndex: i,
        userId: null,
        username: '',
        displayName: '',
        avatarUrl: '',
        level: 1,
        gender: 'male',
        role: 'Member',
        activeFrame: '',
        isMuted: false,
        isLocked: false,
        isSpeaking: false,
        isCameraOn: false
      });
    }
    roomVoiceSeats.set(roomId, seats);
  }
  return roomVoiceSeats.get(roomId)!;
}

export function getOrInitLiveSeats(liveId: string, hostUser?: AuthUser): VoiceSeatState[] {
  if (!liveVoiceSeats.has(liveId)) {
    const seats: VoiceSeatState[] = [];
    for (let i = 0; i < LIVE_MAX_SPEAKER_SEATS; i++) {
      if (i === 0 && hostUser) {
        seats.push({
          seatIndex: 0,
          userId: hostUser.id,
          username: hostUser.username,
          displayName: hostUser.display_name,
          avatarUrl: hostUser.avatar_url,
          level: hostUser.level,
          gender: hostUser.gender,
          role: hostUser.role,
          activeFrame: hostUser.active_frame,
          isMuted: false,
          isLocked: false,
          isSpeaking: false,
          isCameraOn: false
        });
      } else {
        seats.push({
          seatIndex: i,
          userId: null,
          username: '',
          displayName: '',
          avatarUrl: '',
          level: 1,
          gender: 'male',
          role: 'Member',
          activeFrame: '',
          isMuted: false,
          isLocked: false,
          isSpeaking: false,
          isCameraOn: false
        });
      }
    }
    liveVoiceSeats.set(liveId, seats);
  } else {
    const seats = liveVoiceSeats.get(liveId)!;
    // Enforce max 4 seats if any legacy array was larger
    if (seats.length > LIVE_MAX_SPEAKER_SEATS) {
      seats.length = LIVE_MAX_SPEAKER_SEATS;
    }
    if (hostUser && seats[0] && !seats[0].userId) {
      seats[0].userId = hostUser.id;
      seats[0].username = hostUser.username;
      seats[0].displayName = hostUser.display_name;
      seats[0].avatarUrl = hostUser.avatar_url;
      seats[0].level = hostUser.level;
      seats[0].gender = hostUser.gender;
      seats[0].role = hostUser.role;
      seats[0].activeFrame = hostUser.active_frame;
    }
  }
  return liveVoiceSeats.get(liveId)!;
}

export function cleanupLiveSession(liveId: string) {
  liveVoiceSeats.delete(liveId);
  liveViewers.delete(liveId);
  liveGuestRequests.delete(liveId);
  activeSpeakerSockets.delete(`live:${liveId}`);
}

export function getSessionParticipantIds(contextType: 'room' | 'live', contextId: string): string[] {
  if (contextType === 'live') {
    const map = liveViewers.get(contextId);
    return map ? Array.from(map.keys()) : [];
  } else {
    const map = roomConnectedUsers.get(contextId);
    return map ? Array.from(map.keys()) : [];
  }
}

export function getSessionSockets(
  contextType: 'room' | 'live',
  contextId: string
): Array<{ socketId: string; userId: string }> {
  const map = contextType === 'live' ? liveViewers.get(contextId) : roomConnectedUsers.get(contextId);
  const list: Array<{ socketId: string; userId: string }> = [];
  const seenSockets = new Set<string>();

  const collectFromMap = (m?: Map<string, Set<string>>) => {
    if (!m) return;
    for (const [uid, sSet] of m.entries()) {
      for (const sid of sSet) {
        if (!seenSockets.has(sid) && (!ioInstance || ioInstance.sockets.sockets.has(sid))) {
          seenSockets.add(sid);
          list.push({ socketId: sid, userId: uid });
        }
      }
    }
  };

  collectFromMap(map);

  // If this is a Live Stream currently in an Active/Ending/Finished PK Battle with another active Live Stream,
  // bridge their WebRTC peer lists so both Hosts and viewers receive both PK Hosts' audio/video feeds seamlessly.
  if (contextType === 'live') {
    const stream = dbGet<any>(
      `SELECT battle_status, battle_opponent_live_id
       FROM live_streams
       WHERE id = ? AND status = 'active'`,
      [contextId]
    );
    if (
      stream &&
      stream.battle_opponent_live_id &&
      ['Active', 'Ending', 'Finished'].includes(stream.battle_status)
    ) {
      collectFromMap(liveViewers.get(stream.battle_opponent_live_id));
    }
  }

  return list;
}

export function getSessionSpeakerIds(contextType: 'room' | 'live', contextId: string): string[] {
  const seats = contextType === 'live' ? liveVoiceSeats.get(contextId) : roomVoiceSeats.get(contextId);
  const speakerIds = new Set<string>();
  if (seats) {
    for (const s of seats) {
      if (s.userId) speakerIds.add(s.userId);
    }
  }
  if (contextType === 'live') {
    const stream = dbGet<any>(
      `SELECT host_id, battle_status, battle_opponent_id, battle_third_id, battle_opponent_live_id
       FROM live_streams
       WHERE id = ? AND status = 'active'`,
      [contextId]
    );
    if (stream) {
      if (stream.host_id) speakerIds.add(stream.host_id);
      if (['Active', 'Ending', 'Finished'].includes(stream.battle_status)) {
        if (stream.battle_opponent_id) speakerIds.add(stream.battle_opponent_id);
        if (stream.battle_third_id) speakerIds.add(stream.battle_third_id);
      }
    }
  }
  return Array.from(speakerIds);
}

export function getOnlineUsersForRoom(roomId: string) {
  const roomMap = roomConnectedUsers.get(roomId);
  if (!roomMap || roomMap.size === 0) return [];
  const userIds = Array.from(roomMap.keys());
  const placeholders = userIds.map(() => '?').join(',');
  const users = dbAll<any>(
    `SELECT id, username, display_name, avatar_url, gender, role, level, xp,
            name_color, active_frame, active_badge, status_text, country, total_support_power
     FROM users WHERE id IN (${placeholders})`,
    userIds
  );
  const roleRanks = new Map<string, { rank: number; label: string; color: string }>();
  const roles = dbAll<any>('SELECT role_name, rank_order, badge_label, badge_color FROM role_permissions');
  for (const r of roles) {
    roleRanks.set(r.role_name, { rank: r.rank_order, label: r.badge_label, color: r.badge_color });
  }

  return users
    .map((u) => {
      const rInfo = roleRanks.get(u.role) || { rank: 20, label: 'عضو', color: '' };
      return {
        ...u,
        rankOrder: rInfo.rank,
        roleLabel: rInfo.label,
        roleColor: rInfo.color
      };
    })
    .sort((a, b) => b.rankOrder - a.rankOrder || b.level - a.level);
}

export function getGlobalOnlineCount(): number {
  return userSocketsMap.size;
}

export function isUserOnline(userId: string): boolean {
  const s = userSocketsMap.get(userId);
  return Boolean(s && s.size > 0);
}

/**
 * Authoritative helper: Returns the active live stream hosted by `userId` (if any).
 * Regular viewers/listeners who do not host an active stream (`status = 'active'`) return undefined.
 */
export function getActiveLiveStreamForHost(userId: string, excludeLiveId?: string) {
  if (!userId) return undefined;
  if (excludeLiveId) {
    return dbGet<any>(
      `SELECT * FROM live_streams WHERE host_id = ? AND status = 'active' AND id != ?`,
      [userId, excludeLiveId]
    );
  }
  return dbGet<any>(
    `SELECT * FROM live_streams WHERE host_id = ? AND status = 'active'`,
    [userId]
  );
}

/**
 * CRITICAL PK BATTLE RULE:
 * A PK Battle (جولة) MUST ONLY be possible between ACTIVE Live Stream Hosts (`status = 'active'`).
 * Regular viewers/listeners cannot be invited to PK Battles unless they launch their own active Live Stream.
 */
export function getEligibleBattleOpponents(liveId: string, hostId: string) {
  const activeHostRows = dbAll<any>(
    `SELECT ls.id as live_id, ls.title as live_title, ls.status as live_status,
            ls.support_bar, ls.battle_status,
            u.id, u.username, u.display_name, u.avatar_url, u.gender, u.role, u.level, u.active_frame
     FROM live_streams ls
     INNER JOIN users u ON u.id = ls.host_id
     WHERE ls.status = 'active'
       AND ls.id != ?
       AND ls.host_id != ?
       AND u.is_banned = 0
       AND ls.battle_status NOT IN ('Active', 'Ending')
     ORDER BY ls.support_bar DESC, u.level DESC`,
    [liveId, hostId]
  );

  return activeHostRows.map((row) => ({
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    gender: row.gender,
    role: row.role,
    level: row.level,
    active_frame: row.active_frame,
    status: row.live_status,
    live_id: row.live_id,
    live_title: row.live_title,
    viewer_count: getLiveViewerCount(row.live_id),
    battle_status: row.battle_status,
    isOnline: isUserOnline(row.id)
  }));
}

export function getBattleMvpContributors(stream: any) {
  if (!stream || stream.battle_status === 'Idle' || stream.battle_status === 'Waiting') {
    return { hostMvp: [], opponentMvp: [] };
  }
  const sinceTime = Number(stream.battle_started_at) || stream.created_at || 0;
  const linkedLiveId = stream.battle_opponent_live_id || stream.id;

  const hostMvp = dbAll<any>(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.gender, u.active_frame,
            SUM(gt.bar_power) as total_power
     FROM gift_transactions gt
     JOIN users u ON u.id = gt.sender_id
     WHERE gt.context_type = 'live'
       AND gt.context_id IN (?, ?)
       AND gt.receiver_id = ?
       AND gt.created_at >= ?
     GROUP BY u.id
     ORDER BY total_power DESC
     LIMIT 3`,
    [stream.id, linkedLiveId, stream.host_id, sinceTime]
  );

  const opponentMvp = stream.battle_opponent_id
    ? dbAll<any>(
        `SELECT u.id, u.username, u.display_name, u.avatar_url, u.gender, u.active_frame,
                SUM(gt.bar_power) as total_power
         FROM gift_transactions gt
         JOIN users u ON u.id = gt.sender_id
         WHERE gt.context_type = 'live'
           AND gt.context_id IN (?, ?)
           AND gt.receiver_id = ?
           AND gt.created_at >= ?
         GROUP BY u.id
         ORDER BY total_power DESC
         LIMIT 3`,
        [stream.id, linkedLiveId, stream.battle_opponent_id, sinceTime]
      )
    : [];

  return { hostMvp, opponentMvp };
}

export function getRoomOnlineCount(roomId: string): number {
  return roomConnectedUsers.get(roomId)?.size || 0;
}

export function getLiveViewerCount(liveId: string): number {
  return liveViewers.get(liveId)?.size || 0;
}

export function getTopSupportersForLive(liveId: string) {
  return dbAll<any>(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.level, u.gender, u.active_frame,
            SUM(gt.bar_power) as total_power, COUNT(gt.id) as gifts_sent
     FROM gift_transactions gt
     JOIN users u ON u.id = gt.sender_id
     WHERE gt.context_type = 'live' AND gt.context_id = ?
     GROUP BY u.id
     ORDER BY total_power DESC
     LIMIT 10`,
    [liveId]
  );
}

export function broadcastRoomState(roomId: string) {
  if (!ioInstance) return;
  const onlineUsers = getOnlineUsersForRoom(roomId);
  const seats = getOrInitRoomSeats(roomId);
  ioInstance.to(`room:${roomId}`).emit('room:presence', {
    roomId,
    onlineCount: onlineUsers.length,
    onlineUsers,
    seats
  });
}

export function broadcastLiveState(liveId: string) {
  if (!ioInstance) return;
  const stream = dbGet<any>(
    `SELECT ls.*, u.display_name as host_name, u.username as host_username, u.avatar_url as host_avatar,
            u.level as host_level, u.gender as host_gender, u.active_frame as host_frame
     FROM live_streams ls
     JOIN users u ON u.id = ls.host_id
     WHERE ls.id = ?`,
    [liveId]
  );
  if (!stream) return;

  const hostUser = dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [stream.host_id]);
  const seats = getOrInitLiveSeats(liveId, hostUser);
  const supporters = getTopSupportersForLive(liveId);
  const viewerCount = getLiveViewerCount(liveId);
  const guestRequests = liveGuestRequests.get(liveId) || [];
  const { hostMvp, opponentMvp } = getBattleMvpContributors(stream);

  ioInstance.to(`live:${liveId}`).emit('live:state', {
    stream,
    seats,
    supporters,
    viewerCount,
    guestRequests,
    hostMvp,
    opponentMvp
  });
}

export function bridgePkWebRTCSessions(liveIdA: string, liveIdB?: string) {
  if (!ioInstance || !liveIdB) return;
  const socketsA = getSessionSockets('live', liveIdA);
  const socketsB = getSessionSockets('live', liveIdB);
  const speakersA = activeSpeakerSockets.get(`live:${liveIdA}`);
  const speakersB = activeSpeakerSockets.get(`live:${liveIdB}`);

  if (speakersA) {
    for (const [spkSocketId] of speakersA.entries()) {
      for (const peer of socketsB) {
        if (peer.socketId !== spkSocketId) {
          ioInstance.to(spkSocketId).emit('webrtc:listener-joined', {
            contextType: 'live',
            contextId: liveIdA,
            listenerSocketId: peer.socketId,
            listenerUserId: peer.userId
          });
        }
      }
    }
  }
  if (speakersB) {
    for (const [spkSocketId] of speakersB.entries()) {
      for (const peer of socketsA) {
        if (peer.socketId !== spkSocketId) {
          ioInstance.to(spkSocketId).emit('webrtc:listener-joined', {
            contextType: 'live',
            contextId: liveIdB,
            listenerSocketId: peer.socketId,
            listenerUserId: peer.userId
          });
        }
      }
    }
  }
}

export function emitToUser(userId: string, event: string, payload: any) {
  if (!ioInstance) return;
  const sockets = userSocketsMap.get(userId);
  if (sockets) {
    for (const sid of sockets) {
      ioInstance.to(sid).emit(event, payload);
    }
  }
}

export function setupSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      credentials: true
    },
    maxHttpBufferSize: 1e6,
    pingInterval: 20000,
    pingTimeout: 20000,
    perMessageDeflate: false
  });
  ioInstance = io;

  // Periodic server-side check for Pending Battle Invitations & Active Live Battles expiration
  setInterval(() => {
    const now = Date.now();

    // 1. Check Waiting (Pending Invitation) Battles that expired OR where invited opponent no longer has an active live stream
    const waitingBattles = dbAll<any>(
      `SELECT id, battle_invite_expires_at, battle_opponent_id, battle_opponent_name
       FROM live_streams
       WHERE status = 'active' AND battle_status = 'Waiting'`
    );
    for (const wb of waitingBattles) {
      const opponentActiveStream = wb.battle_opponent_id
        ? getActiveLiveStreamForHost(wb.battle_opponent_id, wb.id)
        : undefined;
      const isExpired = wb.battle_invite_expires_at > 0 && wb.battle_invite_expires_at <= now;
      if (isExpired || !opponentActiveStream) {
        dbRun(
          `UPDATE live_streams
           SET battle_status = 'Idle',
               battle_invite_expires_at = 0,
               battle_opponent_id = '',
               battle_opponent_name = '',
               battle_opponent_avatar = '',
               battle_opponent_live_id = '',
               battle_opponent_accepted = 0,
               battle_third_id = '',
               battle_third_name = '',
               battle_third_avatar = '',
               battle_third_accepted = 0
           WHERE id = ?`,
          [wb.id]
        );
        io.to(`live:${wb.id}`).emit('live:chat_event', {
          id: crypto.randomUUID(),
          userId: 'system',
          displayName: 'النظام',
          avatarUrl: '',
          level: 1,
          role: 'System',
          gender: 'male',
          type: 'system',
          content: !opponentActiveStream
            ? '⚠️ أُلغيت دعوة جولة التحدي لأن الطرف المدعو أنهى بثه المباشر ولم يعد مضيفاً نشطاً.'
            : '⏱️ انتهت مهلة دعوة جولة التحدي (Battle) دون رد من الطرف المدعو.',
          createdAt: now
        });
        broadcastLiveState(wb.id);
      }
    }

    // 2. Check Active / Ending Battles
    const activeBattles = dbAll<any>(
      `SELECT id, battle_status, battle_ends_at, battle_mode, battle_round, host_id,
              battle_opponent_id, battle_opponent_name, battle_opponent_live_id, battle_host_score,
              battle_opponent_score, battle_third_id, battle_third_name, battle_third_score
       FROM live_streams
       WHERE status = 'active' AND battle_status IN ('Active', 'Ending')`
    );

    for (const b of activeBattles) {
      const remainingMs = b.battle_ends_at - now;
      if (remainingMs <= 0) {
        let winnerId = 'draw';
        let winnerLabel = 'تعادل بين المتنافسين!';
        const hostUser = dbGet<{ display_name: string }>('SELECT display_name FROM users WHERE id = ?', [b.host_id]);
        const hostName = hostUser?.display_name || 'المضيف';

        if (b.battle_mode === 'Triple') {
          const hScore = Number(b.battle_host_score) || 0;
          const oScore = Number(b.battle_opponent_score) || 0;
          const tScore = Number(b.battle_third_score) || 0;
          const maxScore = Math.max(hScore, oScore, tScore);
          if (maxScore > 0) {
            const topCount = [hScore, oScore, tScore].filter((s) => s === maxScore).length;
            if (topCount === 1) {
              if (hScore === maxScore) {
                winnerId = b.host_id;
                winnerLabel = `فوز ${hostName}!`;
              } else if (oScore === maxScore && b.battle_opponent_id) {
                winnerId = b.battle_opponent_id;
                winnerLabel = `فوز ${b.battle_opponent_name}!`;
              } else if (tScore === maxScore && b.battle_third_id) {
                winnerId = b.battle_third_id;
                winnerLabel = `فوز ${b.battle_third_name}!`;
              }
            }
          }
        } else {
          const hScore = Number(b.battle_host_score) || 0;
          const oScore = Number(b.battle_opponent_score) || 0;
          if (hScore > oScore) {
            winnerId = b.host_id;
            winnerLabel = `فوز ${hostName}!`;
          } else if (oScore > hScore && b.battle_opponent_id) {
            winnerId = b.battle_opponent_id;
            winnerLabel = `فوز ${b.battle_opponent_name}!`;
          }
        }

        // 3-Minute Punishment Phase (مرحلة الحكم: 180 ثانية)
        const punishmentEndsAt = now + 180 * 1000;

        dbRun(
          `UPDATE live_streams
           SET battle_status = 'Finished',
               battle_winner_id = ?,
               battle_punishment_ends_at = ?
           WHERE id = ?`,
          [winnerId, punishmentEndsAt, b.id]
        );
        io.to(`live:${b.id}`).emit('live:chat_event', {
          id: crypto.randomUUID(),
          userId: 'system',
          displayName: 'النظام',
          avatarUrl: '',
          level: 1,
          role: 'System',
          gender: 'male',
          type: 'system',
          content: `🏆 انتهت الجولة رقم ${b.battle_round || 1}! النتيجة: ${winnerLabel} — بدأت الآن مرحلة الحكم (3 دقائق)!`,
          createdAt: now
        });
        broadcastLiveState(b.id);
      } else if (remainingMs <= 10000 && b.battle_status === 'Active') {
        dbRun(`UPDATE live_streams SET battle_status = 'Ending' WHERE id = ?`, [b.id]);
        broadcastLiveState(b.id);
      }
    }

    // 3. Check Finished Battles whose 3-Minute Punishment Phase has expired
    const finishedBattles = dbAll<any>(
      `SELECT id, battle_punishment_ends_at
       FROM live_streams
       WHERE status = 'active' AND battle_status = 'Finished' AND battle_punishment_ends_at > 0`
    );
    for (const fb of finishedBattles) {
      if (fb.battle_punishment_ends_at <= now) {
        dbRun(
          `UPDATE live_streams
           SET battle_status = 'Idle',
               battle_punishment_ends_at = 0,
               battle_opponent_id = '',
               battle_opponent_name = '',
               battle_opponent_avatar = '',
               battle_opponent_live_id = '',
               battle_opponent_accepted = 0,
               battle_third_id = '',
               battle_third_name = '',
               battle_third_avatar = '',
               battle_third_accepted = 0,
               battle_host_score = 0,
               battle_opponent_score = 0,
               battle_third_score = 0,
               battle_ends_at = 0,
               battle_winner_id = ''
           WHERE id = ?`,
          [fb.id]
        );
        broadcastLiveState(fb.id);
      }
    }
  }, 1000);

  io.on('connection', (socket: Socket) => {
    const token =
      socket.handshake.auth?.token ||
      parseCookie(socket.handshake.headers.cookie || '', 'nabd_session');
    const user = getUserBySessionToken(token);

    if (!user || user.is_banned) {
      socket.emit('auth:error', { message: 'غير مصرح بالاتصال' });
      socket.disconnect();
      return;
    }

    const userId = user.id;
    if (!userSocketsMap.has(userId)) {
      userSocketsMap.set(userId, new Set());
    }
    userSocketsMap.get(userId)!.add(socket.id);

    let currentRoomId: string | null = null;
    let currentLiveId: string | null = null;

    // =========================================================================
    // 1. JOIN CHAT ROOM
    // =========================================================================
    socket.on('room:join', ({ roomId }: { roomId: string }) => {
      const freshUser = getUserBySessionToken(token);
      if (!freshUser || freshUser.is_banned) return;

      const roomBan = dbGet<any>(
        `SELECT * FROM room_moderation
         WHERE room_id = ? AND user_id = ? AND action_type = 'ban'
         AND (expires_at = 0 OR expires_at > ?)`,
        [roomId, userId, Date.now()]
      );
      if (roomBan) {
        socket.emit('room:error', { message: `أنت محظور من دخول هذه الغرفة. السبب: ${roomBan.reason || 'قرار إداري'}` });
        return;
      }

      if (currentRoomId && currentRoomId !== roomId) {
        leaveRoomHelper(socket, currentRoomId, userId);
      }

      currentRoomId = roomId;
      socket.join(`room:${roomId}`);

      if (!roomConnectedUsers.has(roomId)) {
        roomConnectedUsers.set(roomId, new Map());
      }
      const rMap = roomConnectedUsers.get(roomId)!;
      const wasAlreadyInRoom = rMap.has(userId);
      if (!rMap.has(userId)) {
        rMap.set(userId, new Set());
      }
      rMap.get(userId)!.add(socket.id);

      if (!wasAlreadyInRoom) {
        const perms = getRolePermission(freshUser.role);
        const badgeText = freshUser.active_badge || perms?.badge_label || 'عضو';
        io.to(`room:${roomId}`).emit('room:system_event', {
          id: crypto.randomUUID(),
          roomId,
          userId: freshUser.id,
          displayName: freshUser.display_name,
          avatarUrl: freshUser.avatar_url,
          badgeText,
          hasRoyalEntry: freshUser.active_effect === 'royal-entry',
          text: `انضم إلى الغرفة [ ${badgeText} ]`,
          createdAt: Date.now()
        });
      }

      broadcastRoomState(roomId);
    });

    // =========================================================================
    // 2. SEND CHAT MESSAGE IN ROOM
    // =========================================================================
    socket.on('room:message', (payload: { roomId: string; content: string; mediaUrl?: string; mediaType?: string }) => {
      const freshUser = getUserBySessionToken(token);
      if (!freshUser || freshUser.is_banned) return;

      const { roomId, content = '', mediaUrl = '', mediaType = 'text' } = payload;
      if (!content.trim() && !mediaUrl) return;

      if (freshUser.is_muted && (freshUser.muted_until === 0 || freshUser.muted_until > Date.now())) {
        socket.emit('room:error', { message: 'أنت مكتوم حالياً ولا يمكنك إرسال رسائل.' });
        return;
      }
      const roomMute = dbGet<any>(
        `SELECT * FROM room_moderation
         WHERE room_id = ? AND user_id = ? AND action_type = 'mute'
         AND (expires_at = 0 OR expires_at > ?)`,
        [roomId, userId, Date.now()]
      );
      if (roomMute) {
        socket.emit('room:error', { message: 'أنت مكتوم داخل هذه الغرفة.' });
        return;
      }

      const room = dbGet<any>('SELECT * FROM rooms WHERE id = ?', [roomId]);
      if (!room) return;
      if (room.is_locked) {
        const perms = getRolePermission(freshUser.role);
        if (!perms?.can_moderate_chat && room.owner_id !== userId) {
          socket.emit('room:error', { message: 'الدردشة مقفلة حالياً من قِبل إدارة الغرفة.' });
          return;
        }
      }

      const msgId = crypto.randomUUID();
      const now = Date.now();
      const safeContent = content.trim().slice(0, 1000);

      dbRun(
        `INSERT INTO room_messages (id, room_id, user_id, content, media_url, media_type, is_system, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
        [msgId, roomId, userId, safeContent, mediaUrl, mediaType, now]
      );

      const econ = recordPublicMessageActivity(userId, safeContent);
      const updatedUser = dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [userId])!;
      const perms = getRolePermission(updatedUser.role);

      const messageObj = {
        id: msgId,
        room_id: roomId,
        user_id: userId,
        content: safeContent,
        media_url: mediaUrl,
        media_type: mediaType,
        is_system: 0,
        created_at: now,
        username: updatedUser.username,
        display_name: updatedUser.display_name,
        avatar_url: updatedUser.avatar_url,
        gender: updatedUser.gender,
        role: updatedUser.role,
        role_label: perms?.badge_label || 'عضو',
        role_color: perms?.badge_color || '',
        level: updatedUser.level,
        name_color: updatedUser.name_color,
        font_color: updatedUser.font_color,
        active_frame: updatedUser.active_frame,
        active_badge: updatedUser.active_badge
      };

      io.to(`room:${roomId}`).emit('room:new_message', messageObj);

      if (econ.goldAwarded > 0) {
        socket.emit('economy:update', {
          gold: updatedUser.gold,
          gems: updatedUser.gems,
          xp: updatedUser.xp,
          level: updatedUser.level,
          levelProgress: calculateLevelFromXp(updatedUser.xp),
          toast: `🎉 نشاط رائع! حصلت على +${econ.goldAwarded} عملة ذهبية لتفاعلك في الغرفة.`
        });
      }
    });

    // =========================================================================
    // 3. ROOM VOICE SEATS MANAGEMENT
    // =========================================================================
    socket.on('room:seat:action', (payload: {
      roomId: string;
      seatIndex: number;
      action: 'join' | 'leave' | 'toggle_mute' | 'lock' | 'unlock' | 'kick' | 'force_mute' | 'invite';
      targetUserId?: string;
    }) => {
      const freshUser = getUserBySessionToken(token);
      if (!freshUser) return;
      const { roomId, seatIndex, action, targetUserId } = payload;
      const seats = getOrInitRoomSeats(roomId);
      const seat = seats[seatIndex];
      if (!seat) return;

      const room = dbGet<any>('SELECT * FROM rooms WHERE id = ?', [roomId]);
      const perms = getRolePermission(freshUser.role);
      const isRoomMod = Boolean(perms?.can_moderate_chat || room?.owner_id === userId);

      if (action === 'join') {
        if (seat.isLocked && !isRoomMod) {
          socket.emit('room:error', { message: 'هذا المقعد الصوتي مقفل من الإدارة.' });
          return;
        }
        if (seat.userId && seat.userId !== userId) {
          socket.emit('room:error', { message: 'المقعد مشغول حالياً.' });
          return;
        }
        for (const s of seats) {
          if (s.userId === userId) {
            s.userId = null;
            s.username = '';
            s.displayName = '';
            s.avatarUrl = '';
            s.isSpeaking = false;
          }
        }
        seat.userId = freshUser.id;
        seat.username = freshUser.username;
        seat.displayName = freshUser.display_name;
        seat.avatarUrl = freshUser.avatar_url;
        seat.level = freshUser.level;
        seat.gender = freshUser.gender;
        seat.role = freshUser.role;
        seat.activeFrame = freshUser.active_frame;
        seat.isMuted = false;
        seat.isSpeaking = false;
      } else if (action === 'leave') {
        if (seat.userId === userId) {
          seat.userId = null;
          seat.username = '';
          seat.displayName = '';
          seat.avatarUrl = '';
          seat.isSpeaking = false;
          io.to(`room:${roomId}`).emit('webrtc:speaker-left', {
            contextType: 'room',
            contextId: roomId,
            speakerUserId: userId
          });
        }
      } else if (action === 'toggle_mute') {
        if (seat.userId === userId) {
          seat.isMuted = !seat.isMuted;
          if (seat.isMuted) seat.isSpeaking = false;
          io.to(`room:${roomId}`).emit('webrtc:mute-state', {
            contextType: 'room',
            contextId: roomId,
            speakerUserId: userId,
            isMuted: seat.isMuted
          });
        }
      } else if (action === 'lock' && isRoomMod) {
        seat.isLocked = true;
      } else if (action === 'unlock' && isRoomMod) {
        seat.isLocked = false;
      } else if (action === 'kick' && isRoomMod) {
        const kickedUserId = seat.userId;
        seat.userId = null;
        seat.username = '';
        seat.displayName = '';
        seat.avatarUrl = '';
        seat.isSpeaking = false;
        if (kickedUserId) {
          emitToUser(kickedUserId, 'webrtc:kicked-from-seat', { contextType: 'room', contextId: roomId });
          io.to(`room:${roomId}`).emit('webrtc:speaker-left', {
            contextType: 'room',
            contextId: roomId,
            speakerUserId: kickedUserId
          });
        }
      } else if (action === 'force_mute' && isRoomMod) {
        const mutedUserId = seat.userId;
        seat.isMuted = true;
        seat.isSpeaking = false;
        if (mutedUserId) {
          emitToUser(mutedUserId, 'webrtc:force-mute', { contextType: 'room', contextId: roomId });
          io.to(`room:${roomId}`).emit('webrtc:mute-state', {
            contextType: 'room',
            contextId: roomId,
            speakerUserId: mutedUserId,
            isMuted: true
          });
        }
      } else if (action === 'invite' && isRoomMod && targetUserId) {
        emitToUser(targetUserId, 'room:seat:invited', {
          roomId,
          seatIndex,
          invitedBy: freshUser.display_name
        });
      }

      broadcastRoomState(roomId);
    });

    // =========================================================================
    // 4. REAL WEBRTC AUDIO & VIDEO SIGNALING (FOR LIVE & VOICE ROOMS)
    // =========================================================================

    const verifySessionAccess = (contextType: 'room' | 'live', contextId: string): boolean => {
      if (!contextId || (contextType !== 'room' && contextType !== 'live')) return false;
      const freshUser = getUserBySessionToken(token);
      if (!freshUser || freshUser.is_banned) return false;

      if (contextType === 'live') {
        const stream = dbGet<any>('SELECT id, host_id, status FROM live_streams WHERE id = ? AND status = "active"', [
          contextId
        ]);
        if (!stream) return false;
        const hostUser = dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [stream.host_id]);
        getOrInitLiveSeats(contextId, hostUser);
        return true;
      } else {
        const room = dbGet<any>('SELECT id FROM rooms WHERE id = ?', [contextId]);
        if (!room) return false;
        const roomBan = dbGet<any>(
          `SELECT id FROM room_moderation
           WHERE room_id = ? AND user_id = ? AND action_type = 'ban'
           AND (expires_at = 0 OR expires_at > ?)`,
          [contextId, userId, Date.now()]
        );
        if (roomBan) return false;
        getOrInitRoomSeats(contextId);
        return true;
      }
    };

    const registerSocketInSession = (contextType: 'room' | 'live', contextId: string): boolean => {
      if (!verifySessionAccess(contextType, contextId)) return false;
      if (contextType === 'live') {
        if (currentLiveId && currentLiveId !== contextId) {
          leaveLiveHelper(socket, currentLiveId, userId);
        }
        currentLiveId = contextId;
        socket.join(`live:${contextId}`);
        if (!liveViewers.has(contextId)) {
          liveViewers.set(contextId, new Map());
        }
        const vMap = liveViewers.get(contextId)!;
        if (!vMap.has(userId)) {
          vMap.set(userId, new Set());
        }
        vMap.get(userId)!.add(socket.id);
      } else {
        if (currentRoomId && currentRoomId !== contextId) {
          leaveRoomHelper(socket, currentRoomId, userId);
        }
        currentRoomId = contextId;
        socket.join(`room:${contextId}`);
        if (!roomConnectedUsers.has(contextId)) {
          roomConnectedUsers.set(contextId, new Map());
        }
        const rMap = roomConnectedUsers.get(contextId)!;
        if (!rMap.has(userId)) {
          rMap.set(userId, new Set());
        }
        rMap.get(userId)!.add(socket.id);
      }
      return true;
    };

    const emitSignalingToAuthorizedTarget = (
      eventName: 'webrtc:offer' | 'webrtc:answer' | 'webrtc:ice-candidate',
      contextType: 'room' | 'live',
      contextId: string,
      targetSocketId: string | undefined,
      targetUserId: string | undefined,
      msgPayload: any
    ) => {
      if (!verifySessionAccess(contextType, contextId)) return;

      const sessionPeers = getSessionSockets(contextType, contextId);
      // Verify sender is actually in this session
      const isSenderInSession = sessionPeers.some((p) => p.socketId === socket.id);
      if (!isSenderInSession) return;

      // Strictly restrict signaling to receivers in the EXACT SAME session (no cross-room/cross-live signaling)
      if (targetSocketId) {
        const targetPeer = sessionPeers.find((p) => p.socketId === targetSocketId);
        if (targetPeer && targetPeer.socketId !== socket.id) {
          io.to(targetPeer.socketId).emit(eventName, msgPayload);
        }
      } else if (targetUserId) {
        for (const peer of sessionPeers) {
          if (peer.userId === targetUserId && peer.socketId !== socket.id) {
            io.to(peer.socketId).emit(eventName, msgPayload);
          }
        }
      }
    };

    /**
     * When a Speaker (Host or Seated Guest) enables their microphone/camera and has an active MediaStream,
     * they emit 'webrtc:speaker-ready'.
     * Server verifies they are seated in an active session, records their active speaker socketId, and returns
     * all connected peer sockets in that session so the Speaker creates 1-to-1 RTCPeerConnections with each peer.
     */
    socket.on('webrtc:speaker-ready', (payload: { contextType: 'room' | 'live'; contextId: string }) => {
      const { contextType, contextId } = payload || ({} as any);
      if (!registerSocketInSession(contextType, contextId)) return;

      const speakerIds = getSessionSpeakerIds(contextType, contextId);
      if (!speakerIds.includes(userId)) {
        return;
      }

      const sessionKey = `${contextType}:${contextId}`;
      if (!activeSpeakerSockets.has(sessionKey)) {
        activeSpeakerSockets.set(sessionKey, new Map());
      }
      const speakerMap = activeSpeakerSockets.get(sessionKey)!;
      speakerMap.set(socket.id, userId);

      // Get all connected sockets in this session except this speaker socket itself
      const allPeers = getSessionSockets(contextType, contextId).filter(
        (p) => p.socketId !== socket.id
      );

      socket.emit('webrtc:peers-list', {
        contextType,
        contextId,
        peers: allPeers,
        peerUserIds: Array.from(new Set(allPeers.map((p) => p.userId)))
      });
    });

    socket.on('webrtc:speaker-stopped', (payload: { contextType: 'room' | 'live'; contextId: string }) => {
      const { contextType, contextId } = payload || ({} as any);
      if (!contextId) return;
      const sessionKey = `${contextType}:${contextId}`;
      activeSpeakerSockets.get(sessionKey)?.delete(socket.id);
      const channel = contextType === 'room' ? `room:${contextId}` : `live:${contextId}`;
      socket.to(channel).emit('webrtc:speaker-left', {
        contextType,
        contextId,
        speakerSocketId: socket.id,
        speakerUserId: userId
      });
    });

    /**
     * When a Listener (or newly joined user) mounts the audio hook in a Live Stream or Room,
     * they emit 'webrtc:listener-ready'.
     * Server notifies all active Speaker sockets in that session to send a WebRTC Offer to this Listener socket!
     */
    socket.on('webrtc:listener-ready', (payload: { contextType: 'room' | 'live'; contextId: string }) => {
      const { contextType, contextId } = payload || ({} as any);
      if (!registerSocketInSession(contextType, contextId)) return;

      const sessionKey = `${contextType}:${contextId}`;
      const speakerMap = activeSpeakerSockets.get(sessionKey);
      const notifiedSockets = new Set<string>();

      // 1. Notify all registered active speaker sockets in this session
      if (speakerMap) {
        for (const [speakerSocketId] of speakerMap.entries()) {
          if (speakerSocketId !== socket.id) {
            notifiedSockets.add(speakerSocketId);
            io.to(speakerSocketId).emit('webrtc:listener-joined', {
              contextType,
              contextId,
              listenerSocketId: socket.id,
              listenerUserId: userId
            });
          }
        }
      }

      // 2. Also notify any seated speaker's connected sockets in this session in case they just finished getUserMedia
      const speakerUserIds = new Set(getSessionSpeakerIds(contextType, contextId));
      const sessionSockets = getSessionSockets(contextType, contextId);
      for (const peer of sessionSockets) {
        if (
          peer.socketId !== socket.id &&
          speakerUserIds.has(peer.userId) &&
          !notifiedSockets.has(peer.socketId)
        ) {
          notifiedSockets.add(peer.socketId);
          io.to(peer.socketId).emit('webrtc:listener-joined', {
            contextType,
            contextId,
            listenerSocketId: socket.id,
            listenerUserId: userId
          });
        }
      }
    });

    /**
     * Directed SDP Offer from Speaker Socket -> Target Listener/Peer Socket (Strictly validated in same session)
     */
    socket.on(
      'webrtc:offer',
      (payload: {
        targetSocketId?: string;
        targetUserId?: string;
        contextType: 'room' | 'live';
        contextId: string;
        sdp: any;
      }) => {
        if (!payload?.sdp || !payload.contextId) return;
        const msg = {
          fromSocketId: socket.id,
          fromUserId: userId,
          contextType: payload.contextType,
          contextId: payload.contextId,
          sdp: payload.sdp
        };
        emitSignalingToAuthorizedTarget(
          'webrtc:offer',
          payload.contextType,
          payload.contextId,
          payload.targetSocketId,
          payload.targetUserId,
          msg
        );
      }
    );

    /**
     * Directed SDP Answer from Listener/Peer Socket -> Speaker Socket (Strictly validated in same session)
     */
    socket.on(
      'webrtc:answer',
      (payload: {
        targetSocketId?: string;
        targetUserId?: string;
        contextType: 'room' | 'live';
        contextId: string;
        sdp: any;
      }) => {
        if (!payload?.sdp || !payload.contextId) return;
        const msg = {
          fromSocketId: socket.id,
          fromUserId: userId,
          contextType: payload.contextType,
          contextId: payload.contextId,
          sdp: payload.sdp
        };
        emitSignalingToAuthorizedTarget(
          'webrtc:answer',
          payload.contextType,
          payload.contextId,
          payload.targetSocketId,
          payload.targetUserId,
          msg
        );
      }
    );

    /**
     * Directed ICE Candidate Exchange between Peer Sockets (Strictly validated in same session)
     */
    socket.on(
      'webrtc:ice-candidate',
      (payload: {
        targetSocketId?: string;
        targetUserId?: string;
        contextType: 'room' | 'live';
        contextId: string;
        candidate: any;
      }) => {
        if (!payload?.candidate || !payload.contextId) return;
        const msg = {
          fromSocketId: socket.id,
          fromUserId: userId,
          contextType: payload.contextType,
          contextId: payload.contextId,
          candidate: payload.candidate
        };
        emitSignalingToAuthorizedTarget(
          'webrtc:ice-candidate',
          payload.contextType,
          payload.contextId,
          payload.targetSocketId,
          payload.targetUserId,
          msg
        );
      }
    );

    /**
     * Real-time speaking activity indicator driven by Web Audio API AnalyserNode
     */
    socket.on('voice:speaking', (payload: { contextType: 'room' | 'live'; contextId: string; isSpeaking: boolean }) => {
      const { contextType, contextId, isSpeaking } = payload;
      const seats = contextType === 'room' ? roomVoiceSeats.get(contextId) : liveVoiceSeats.get(contextId);
      if (!seats) return;
      let changed = false;
      for (const s of seats) {
        if (s.userId === userId) {
          const nextVal = s.isMuted ? false : Boolean(isSpeaking);
          if (s.isSpeaking !== nextVal) {
            s.isSpeaking = nextVal;
            changed = true;
          }
        }
      }
      if (changed) {
        const channel = contextType === 'room' ? `room:${contextId}` : `live:${contextId}`;
        io.to(channel).emit('voice:seats_update', { contextType, contextId, seats });
      }
    });

    // =========================================================================
    // 5. LIVE AUDIO STREAMING & BATTLES
    // =========================================================================
    socket.on('live:join', ({ liveId }: { liveId: string }) => {
      const freshUser = getUserBySessionToken(token);
      if (!freshUser) return;

      if (currentLiveId && currentLiveId !== liveId) {
        leaveLiveHelper(socket, currentLiveId, userId);
      }

      const stream = dbGet<any>('SELECT * FROM live_streams WHERE id = ? AND status = "active"', [liveId]);
      if (!stream) {
        socket.emit('live:error', { message: 'هذا البث المباشر انتهى أو غير موجود.' });
        return;
      }

      currentLiveId = liveId;
      socket.join(`live:${liveId}`);

      if (!liveViewers.has(liveId)) {
        liveViewers.set(liveId, new Map());
      }
      const vMap = liveViewers.get(liveId)!;
      const isNewViewer = !vMap.has(userId);
      if (!vMap.has(userId)) {
        vMap.set(userId, new Set());
      }
      vMap.get(userId)!.add(socket.id);

      const hostUser = dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [stream.host_id]);
      getOrInitLiveSeats(liveId, hostUser);

      if (isNewViewer) {
        const joinEvent: LiveChatItem = {
          id: crypto.randomUUID(),
          userId: freshUser.id,
          displayName: freshUser.display_name,
          avatarUrl: freshUser.avatar_url,
          level: freshUser.level,
          role: freshUser.role,
          gender: freshUser.gender,
          type: 'join',
          content: 'انضم للاستماع إلى البث الصوتي 🎧',
          createdAt: Date.now()
        };
        io.to(`live:${liveId}`).emit('live:chat_event', joinEvent);
      }

      broadcastLiveState(liveId);
    });

    socket.on('live:leave', ({ liveId }: { liveId: string }) => {
      leaveLiveHelper(socket, liveId, userId);
      if (currentLiveId === liveId) currentLiveId = null;
    });

    socket.on('live:chat', ({ liveId, content }: { liveId: string; content: string }) => {
      const freshUser = getUserBySessionToken(token);
      if (!freshUser || freshUser.is_muted) return;
      const trimmed = (content || '').trim().slice(0, 400);
      if (!trimmed) return;

      const chatItem: LiveChatItem = {
        id: crypto.randomUUID(),
        userId: freshUser.id,
        displayName: freshUser.display_name,
        avatarUrl: freshUser.avatar_url,
        level: freshUser.level,
        role: freshUser.role,
        gender: freshUser.gender,
        type: 'chat',
        content: trimmed,
        createdAt: Date.now()
      };
      io.to(`live:${liveId}`).emit('live:chat_event', chatItem);
    });

    // Server-authoritative Taps: Every 10 taps = +1 to Support Bar / Battle Bar
    socket.on('live:tap', ({ liveId, targetSide = 'host' }: { liveId: string; targetSide?: 'host' | 'opponent' | 'third' }) => {
      const now = Date.now();
      const key = `${liveId}:${userId}`;
      let acc = liveTapAccumulators.get(key);
      if (!acc) {
        acc = { count: 0, lastTapAt: 0, recentTapsInWindow: 0, windowStart: now };
        liveTapAccumulators.set(key, acc);
      }

      if (now - acc.windowStart > 1000) {
        acc.windowStart = now;
        acc.recentTapsInWindow = 0;
      }
      acc.recentTapsInWindow += 1;
      if (acc.recentTapsInWindow > 14) {
        return;
      }

      acc.count += 1;
      acc.lastTapAt = now;

      io.to(`live:${liveId}`).emit('live:tap_burst', {
        userId,
        totalUserTaps: acc.count,
        targetSide
      });

      if (acc.count % 10 === 0) {
        const stream = dbGet<any>('SELECT * FROM live_streams WHERE id = ? AND status = "active"', [liveId]);
        if (!stream) return;

        dbRun('UPDATE live_streams SET support_bar = support_bar + 1, total_taps = total_taps + 10 WHERE id = ?', [liveId]);

        if (stream.battle_status === 'Active' || stream.battle_status === 'Ending') {
          if (targetSide === 'opponent') {
            dbRun('UPDATE live_streams SET battle_opponent_score = battle_opponent_score + 1 WHERE id = ?', [liveId]);
            if (stream.battle_opponent_live_id) {
              dbRun('UPDATE live_streams SET battle_host_score = battle_host_score + 1 WHERE id = ?', [
                stream.battle_opponent_live_id
              ]);
            }
          } else if (targetSide === 'third') {
            dbRun('UPDATE live_streams SET battle_third_score = battle_third_score + 1 WHERE id = ?', [liveId]);
            if (stream.battle_opponent_live_id) {
              dbRun('UPDATE live_streams SET battle_third_score = battle_third_score + 1 WHERE id = ?', [
                stream.battle_opponent_live_id
              ]);
            }
          } else {
            dbRun('UPDATE live_streams SET battle_host_score = battle_host_score + 1 WHERE id = ?', [liveId]);
            if (stream.battle_opponent_live_id) {
              dbRun('UPDATE live_streams SET battle_opponent_score = battle_opponent_score + 1 WHERE id = ?', [
                stream.battle_opponent_live_id
              ]);
            }
          }
        }

        broadcastLiveState(liveId);
        if (stream.battle_opponent_live_id) {
          broadcastLiveState(stream.battle_opponent_live_id);
        }
      }
    });

    // Viewer Request to Join as Guest Speaker (طلب انضمام كضيف صوتي/فيديو في المقاعد أو صعود مباشر)
    socket.on('live:guest:request', (payload: { liveId: string; withCamera?: boolean; directJoin?: boolean }) => {
      const freshUser = getUserBySessionToken(token);
      if (!freshUser || freshUser.is_banned) return;
      const { liveId, withCamera = false, directJoin = false } = payload || ({} as any);
      const stream = dbGet<any>('SELECT * FROM live_streams WHERE id = ? AND status = "active"', [liveId]);
      if (!stream) return;

      if (stream.host_id === userId) {
        socket.emit('live:error', { message: 'أنت مضيف هذا البث بالفعل.' });
        return;
      }
      if (freshUser.is_muted && (freshUser.muted_until === 0 || freshUser.muted_until > Date.now())) {
        socket.emit('live:error', { message: 'أنت مكتوم حالياً ولا يمكنك طلب الصعود كضيف.' });
        return;
      }

      const hostUser = dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [stream.host_id]);
      const seats = getOrInitLiveSeats(liveId, hostUser);
      if (seats.some((s) => s.userId === userId)) {
        socket.emit('live:error', { message: 'أنت موجود بالفعل على أحد مقاعد الضيوف.' });
        return;
      }

      // Check if Open Stage is active (default 1 = open stage) OR if viewer is a follower/friend of the host
      const isOpenStage = stream.open_stage !== 0;
      const isFriendOrFollower = Boolean(
        dbGet(
          `SELECT 1 FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)
           UNION
           SELECT 1 FROM friends WHERE ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)) AND status = 'accepted'`,
          [userId, stream.host_id, stream.host_id, userId, userId, stream.host_id, stream.host_id, userId]
        )
      );

      const emptySeat = seats.find((s) => s.seatIndex > 0 && !s.userId);
      if ((isOpenStage || isFriendOrFollower || directJoin) && emptySeat) {
        emptySeat.userId = freshUser.id;
        emptySeat.username = freshUser.username;
        emptySeat.displayName = freshUser.display_name;
        emptySeat.avatarUrl = freshUser.avatar_url;
        emptySeat.level = freshUser.level;
        emptySeat.gender = freshUser.gender;
        emptySeat.role = freshUser.role;
        emptySeat.activeFrame = freshUser.active_frame;
        emptySeat.isMuted = false;
        emptySeat.isSpeaking = false;
        emptySeat.isCameraOn = Boolean(withCamera);

        const list = liveGuestRequests.get(liveId);
        if (list) {
          liveGuestRequests.set(
            liveId,
            list.filter((r) => r.userId !== userId)
          );
        }

        emitToUser(freshUser.id, 'live:guest:approved', {
          liveId,
          seatIndex: emptySeat.seatIndex,
          withCamera: Boolean(withCamera)
        });

        io.to(`live:${liveId}`).emit('live:chat_event', {
          id: crypto.randomUUID(),
          userId: freshUser.id,
          displayName: freshUser.display_name,
          avatarUrl: freshUser.avatar_url,
          level: freshUser.level,
          role: freshUser.role,
          gender: freshUser.gender,
          type: 'system',
          content: `🎙️ صعد ${freshUser.display_name} إلى القسط #${emptySeat.seatIndex} للمشاركة في الحديث!`,
          createdAt: Date.now()
        });

        broadcastLiveState(liveId);
        return;
      }

      if (!liveGuestRequests.has(liveId)) {
        liveGuestRequests.set(liveId, []);
      }
      const list = liveGuestRequests.get(liveId)!;
      const existingIdx = list.findIndex((r) => r.userId === userId);
      const reqObj: GuestJoinRequestState = {
        userId: freshUser.id,
        username: freshUser.username,
        displayName: freshUser.display_name,
        avatarUrl: freshUser.avatar_url,
        level: freshUser.level,
        gender: freshUser.gender === 'female' ? 'female' : 'male',
        activeFrame: freshUser.active_frame,
        withCamera: Boolean(withCamera),
        createdAt: Date.now()
      };
      if (existingIdx >= 0) {
        list[existingIdx] = reqObj;
      } else {
        list.push(reqObj);
      }

      emitToUser(stream.host_id, 'live:guest:requested', {
        liveId,
        request: reqObj
      });
      broadcastLiveState(liveId);
    });

    socket.on('live:guest:cancel', ({ liveId }: { liveId: string }) => {
      if (!liveId) return;
      const list = liveGuestRequests.get(liveId);
      if (list) {
        liveGuestRequests.set(
          liveId,
          list.filter((r) => r.userId !== userId)
        );
        broadcastLiveState(liveId);
      }
    });

    socket.on(
      'live:guest:respond',
      (payload: { liveId: string; targetUserId: string; action: 'approve' | 'reject' }) => {
        const freshUser = getUserBySessionToken(token);
        if (!freshUser || freshUser.is_banned) return;
        const { liveId, targetUserId, action } = payload || ({} as any);
        const stream = dbGet<any>('SELECT * FROM live_streams WHERE id = ? AND status = "active"', [liveId]);
        if (!stream) return;

        const perms = getRolePermission(freshUser.role);
        const isHostOrMod = stream.host_id === userId || Boolean(perms?.can_manage_live);
        if (!isHostOrMod) return;

        const list = liveGuestRequests.get(liveId) || [];
        const reqItem = list.find((r) => r.userId === targetUserId);
        liveGuestRequests.set(
          liveId,
          list.filter((r) => r.userId !== targetUserId)
        );

        if (action === 'reject') {
          emitToUser(targetUserId, 'live:guest:rejected', { liveId });
          broadcastLiveState(liveId);
          return;
        }

        // Approve: assign to first open guest seat (1..3)
        const hostUser = dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [stream.host_id]);
        const seats = getOrInitLiveSeats(liveId, hostUser);
        const emptySeat = seats.find((s) => s.seatIndex > 0 && !s.userId);
        if (!emptySeat) {
          socket.emit('live:error', { message: 'جميع مقاعد الضيوف (3 ضيوف) ممتلئة حالياً.' });
          broadcastLiveState(liveId);
          return;
        }

        const guestUser = dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [targetUserId]);
        if (!guestUser) {
          broadcastLiveState(liveId);
          return;
        }

        emptySeat.userId = guestUser.id;
        emptySeat.username = guestUser.username;
        emptySeat.displayName = guestUser.display_name;
        emptySeat.avatarUrl = guestUser.avatar_url;
        emptySeat.level = guestUser.level;
        emptySeat.gender = guestUser.gender;
        emptySeat.role = guestUser.role;
        emptySeat.activeFrame = guestUser.active_frame;
        emptySeat.isMuted = false;
        emptySeat.isSpeaking = false;
        emptySeat.isCameraOn = Boolean(reqItem?.withCamera);

        emitToUser(targetUserId, 'live:guest:approved', {
          liveId,
          seatIndex: emptySeat.seatIndex,
          withCamera: Boolean(reqItem?.withCamera)
        });

        io.to(`live:${liveId}`).emit('live:chat_event', {
          id: crypto.randomUUID(),
          userId: guestUser.id,
          displayName: guestUser.display_name,
          avatarUrl: guestUser.avatar_url,
          level: guestUser.level,
          role: guestUser.role,
          gender: guestUser.gender,
          type: 'system',
          content: `🎙️ انضم ${guestUser.display_name} كضيف متحدث على القسط #${emptySeat.seatIndex}!`,
          createdAt: Date.now()
        });

        broadcastLiveState(liveId);
      }
    );

    // Socket-based PK Battle Invitation Handler (Strictly enforces active live stream host status)
    socket.on(
      'live:battle:invite',
      (payload: {
        liveId: string;
        opponentId: string;
        thirdId?: string;
        mode?: 'Classic' | 'Box' | 'Bear' | 'Triple';
        durationSeconds?: number;
      }) => {
        const freshUser = getUserBySessionToken(token);
        if (!freshUser || freshUser.is_banned) return;
        const { liveId, opponentId, thirdId, mode = 'Classic', durationSeconds = 300 } =
          payload || ({} as any);

        const stream = dbGet<any>(
          'SELECT * FROM live_streams WHERE id = ? AND status = "active"',
          [liveId]
        );
        if (!stream) {
          socket.emit('live:error', { message: 'البث غير نشط أو انتهى.' });
          return;
        }
        const perms = getRolePermission(freshUser.role);
        if (stream.host_id !== userId && !perms?.can_manage_live) {
          socket.emit('live:error', { message: 'فقط مضيف البث يمكنه إرسال دعوة جولة PK.' });
          return;
        }
        if (!opponentId || opponentId === stream.host_id) {
          socket.emit('live:error', { message: 'يرجى اختيار مضيف منافس صالح.' });
          return;
        }

        // Enforce that target opponent is currently hosting an active live stream (never a regular viewer)
        const opponentStream = getActiveLiveStreamForHost(opponentId, liveId);
        if (!opponentStream) {
          socket.emit('live:error', {
            message:
              'لا يمكن دعوة مشاهد عادي لجولة PK! يجب أن يكون لدى الخصم بث مباشر نشط حالياً (status = active).'
          });
          return;
        }
        const opponentUser = dbGet<AuthUser>(
          'SELECT * FROM users WHERE id = ? AND is_banned = 0',
          [opponentId]
        );
        if (!opponentUser) {
          socket.emit('live:error', { message: 'المنافس المختار غير متاح.' });
          return;
        }

        let thirdUser: AuthUser | undefined;
        if (mode === 'Triple') {
          if (!thirdId || thirdId === stream.host_id || thirdId === opponentId) {
            socket.emit('live:error', { message: 'يرجى اختيار مضيف ثالث مختلف للجولة الثلاثية.' });
            return;
          }
          const thirdStream = getActiveLiveStreamForHost(thirdId, liveId);
          if (!thirdStream) {
            socket.emit('live:error', {
              message: 'المنافس الثالث ليس لديه بث مباشر نشط حالياً (status = active).'
            });
            return;
          }
          thirdUser = dbGet<AuthUser>('SELECT * FROM users WHERE id = ? AND is_banned = 0', [
            thirdId
          ]);
        }

        const now = Date.now();
        const inviteExpiresAt = now + 45 * 1000;
        const safeDuration = Math.max(30, Math.min(600, Number(durationSeconds) || 300));

        dbRun(
          `UPDATE live_streams
           SET battle_status = 'Waiting',
               battle_mode = ?,
               battle_duration = ?,
               battle_invite_expires_at = ?,
               battle_opponent_id = ?,
               battle_opponent_name = ?,
               battle_opponent_avatar = ?,
               battle_opponent_live_id = ?,
               battle_opponent_accepted = 0,
               battle_host_score = 0,
               battle_opponent_score = 0,
               battle_third_id = ?,
               battle_third_name = ?,
               battle_third_avatar = ?,
               battle_third_accepted = 0,
               battle_third_score = 0,
               battle_ends_at = 0,
               battle_punishment_ends_at = 0,
               battle_winner_id = ''
           WHERE id = ?`,
          [
            mode,
            safeDuration,
            inviteExpiresAt,
            opponentUser.id,
            opponentUser.display_name,
            opponentUser.avatar_url || '',
            opponentStream.id,
            thirdUser ? thirdUser.id : '',
            thirdUser ? thirdUser.display_name : '',
            thirdUser ? thirdUser.avatar_url || '' : '',
            liveId
          ]
        );

        const invitePayload = {
          liveId,
          liveTitle: stream.title,
          hostId: stream.host_id,
          hostName: freshUser.display_name,
          hostAvatar: freshUser.avatar_url || '',
          mode,
          durationSeconds: safeDuration,
          expiresAt: inviteExpiresAt
        };
        emitToUser(opponentUser.id, 'live:battle:invited', invitePayload);
        if (thirdUser) {
          emitToUser(thirdUser.id, 'live:battle:invited', invitePayload);
        }
        broadcastLiveState(liveId);
      }
    );

    // Live Seats Management (Server-Authoritative Permissions, Max 4 Speakers: 1 Host + 3 Guests)
    socket.on('live:seat:action', (payload: {
      liveId: string;
      seatIndex: number;
      action: 'join' | 'leave' | 'toggle_mute' | 'toggle_camera' | 'kick' | 'force_mute' | 'invite';
      targetUserId?: string;
      isCameraOn?: boolean;
    }) => {
      const freshUser = getUserBySessionToken(token);
      if (!freshUser || freshUser.is_banned) return;
      const { liveId, seatIndex, action, targetUserId, isCameraOn } = payload;
      const stream = dbGet<any>('SELECT * FROM live_streams WHERE id = ? AND status = "active"', [liveId]);
      if (!stream) {
        socket.emit('live:error', { message: 'هذا البث المباشر انتهى أو غير موجود.' });
        return;
      }

      if (typeof seatIndex !== 'number' || seatIndex < 0 || seatIndex >= LIVE_MAX_SPEAKER_SEATS) {
        socket.emit('live:error', {
          message: 'الحد الأقصى للمتحدثين في البث الواحد هو 4 أشخاص فقط (المضيف + 3 ضيوف).'
        });
        return;
      }

      const hostUser = dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [stream.host_id]);
      const seats = getOrInitLiveSeats(liveId, hostUser);
      const seat = seats[seatIndex];
      if (!seat) return;

      const perms = getRolePermission(freshUser.role);
      const isHostOrMod = stream.host_id === userId || Boolean(perms?.can_manage_live);

      if (action === 'join') {
        if (freshUser.is_muted && (freshUser.muted_until === 0 || freshUser.muted_until > Date.now())) {
          socket.emit('live:error', { message: 'أنت مكتوم حالياً ولا يمكنك الصعود إلى مقعد التحدث.' });
          return;
        }
        // Security check: Only actual host can sit on Seat 0
        if (seatIndex === 0 && stream.host_id !== userId) {
          socket.emit('live:error', { message: 'المقعد الرئيسي مخصص لمضيف البث فقط.' });
          return;
        }
        if (seatIndex > 0 && stream.host_id === userId) {
          socket.emit('live:error', { message: 'أنت مضيف البث ومقعدك الرئيسي هو المقعد الأول.' });
          return;
        }
        if (seat.userId && seat.userId !== userId) {
          socket.emit('live:error', { message: 'هذا المقعد الصوتي مشغول حالياً.' });
          return;
        }

        // Strict check: count currently occupied guest seats (1..3) excluding this user
        const occupiedGuestSeats = seats.filter(
          (s) => s.seatIndex > 0 && s.userId && s.userId !== userId
        ).length;
        if (seatIndex > 0 && occupiedGuestSeats >= LIVE_MAX_SPEAKER_SEATS - 1) {
          socket.emit('live:error', {
            message: 'اكتمل العدد الأقصى للمتحدثين (المضيف + 3 ضيوف). لا يمكن حجز مقعد إضافي.'
          });
          return;
        }

        // Clear user from any other guest seat first
        for (const s of seats) {
          if (s.userId === userId && s.seatIndex !== 0) {
            s.userId = null;
            s.username = '';
            s.displayName = '';
            s.avatarUrl = '';
            s.isSpeaking = false;
            s.isCameraOn = false;
          }
        }
        // Also clear any pending guest join request for this user
        const pendingReqs = liveGuestRequests.get(liveId);
        if (pendingReqs) {
          liveGuestRequests.set(
            liveId,
            pendingReqs.filter((r) => r.userId !== userId)
          );
        }
        seat.userId = freshUser.id;
        seat.username = freshUser.username;
        seat.displayName = freshUser.display_name;
        seat.avatarUrl = freshUser.avatar_url;
        seat.level = freshUser.level;
        seat.gender = freshUser.gender;
        seat.role = freshUser.role;
        seat.activeFrame = freshUser.active_frame;
        seat.isMuted = false;
        seat.isSpeaking = false;
        seat.isCameraOn = false;
      } else if (action === 'leave') {
        if (seat.userId === userId && seatIndex !== 0) {
          seat.userId = null;
          seat.username = '';
          seat.displayName = '';
          seat.avatarUrl = '';
          seat.isSpeaking = false;
          seat.isCameraOn = false;
          activeSpeakerSockets.get(`live:${liveId}`)?.delete(socket.id);
          io.to(`live:${liveId}`).emit('webrtc:speaker-left', {
            contextType: 'live',
            contextId: liveId,
            speakerSocketId: socket.id,
            speakerUserId: userId
          });
        }
      } else if (action === 'toggle_mute') {
        if (seat.userId === userId) {
          seat.isMuted = !seat.isMuted;
          if (seat.isMuted) seat.isSpeaking = false;
          io.to(`live:${liveId}`).emit('webrtc:mute-state', {
            contextType: 'live',
            contextId: liveId,
            speakerUserId: userId,
            isMuted: seat.isMuted
          });
        }
      } else if (action === 'toggle_camera') {
        if (seat.userId === userId) {
          seat.isCameraOn = isCameraOn !== undefined ? Boolean(isCameraOn) : !seat.isCameraOn;
          io.to(`live:${liveId}`).emit('voice:seats_update', {
            contextType: 'live',
            contextId: liveId,
            seats
          });
        }
      } else if (action === 'kick' && isHostOrMod && seatIndex !== 0) {
        const kickedUserId = seat.userId;
        seat.userId = null;
        seat.username = '';
        seat.displayName = '';
        seat.avatarUrl = '';
        seat.isSpeaking = false;
        seat.isCameraOn = false;
        if (kickedUserId) {
          const spkMap = activeSpeakerSockets.get(`live:${liveId}`);
          if (spkMap) {
            for (const [sid, uid] of spkMap.entries()) {
              if (uid === kickedUserId) spkMap.delete(sid);
            }
          }
          emitToUser(kickedUserId, 'webrtc:kicked-from-seat', {
            contextType: 'live',
            contextId: liveId
          });
          io.to(`live:${liveId}`).emit('webrtc:speaker-left', {
            contextType: 'live',
            contextId: liveId,
            speakerUserId: kickedUserId
          });
        }
      } else if (action === 'force_mute' && isHostOrMod) {
        const mutedUserId = seat.userId;
        seat.isMuted = true;
        seat.isSpeaking = false;
        if (mutedUserId) {
          emitToUser(mutedUserId, 'webrtc:force-mute', {
            contextType: 'live',
            contextId: liveId
          });
          io.to(`live:${liveId}`).emit('webrtc:mute-state', {
            contextType: 'live',
            contextId: liveId,
            speakerUserId: mutedUserId,
            isMuted: true
          });
        }
      } else if (action === 'invite' && isHostOrMod && targetUserId) {
        emitToUser(targetUserId, 'live:seat:invited', {
          liveId,
          seatIndex,
          hostName: freshUser.display_name
        });
      } else if ((action as string) === 'toggle_open_stage' && isHostOrMod) {
        const nextOpen = stream.open_stage === 0 ? 1 : 0;
        dbRun('UPDATE live_streams SET open_stage = ? WHERE id = ?', [nextOpen, liveId]);
      }

      broadcastLiveState(liveId);
    });

    socket.on('disconnect', () => {
      const userSet = userSocketsMap.get(userId);
      if (userSet) {
        userSet.delete(socket.id);
        if (userSet.size === 0) {
          userSocketsMap.delete(userId);
          // Ephemeral public room messages: clear user's public messages once they leave the site
          setTimeout(() => {
            if (!isUserOnline(userId)) {
              dbRun('DELETE FROM room_messages WHERE user_id = ?', [userId]);
              ioInstance?.emit('room:user_messages_cleared', { userId });
            }
          }, 4000);
        }
      }
      if (currentRoomId) {
        leaveRoomHelper(socket, currentRoomId, userId);
      }
      if (currentLiveId) {
        leaveLiveHelper(socket, currentLiveId, userId);
      }
    });
  });

  return io;
}

function leaveRoomHelper(socket: Socket, roomId: string, userId: string) {
  socket.leave(`room:${roomId}`);
  activeSpeakerSockets.get(`room:${roomId}`)?.delete(socket.id);
  ioInstance?.to(`room:${roomId}`).emit('webrtc:peer-left', {
    contextType: 'room',
    contextId: roomId,
    peerSocketId: socket.id,
    peerUserId: userId
  });

  const rMap = roomConnectedUsers.get(roomId);
  if (rMap) {
    const sSet = rMap.get(userId);
    if (sSet) {
      sSet.delete(socket.id);
      if (sSet.size === 0) {
        rMap.delete(userId);
        const seats = roomVoiceSeats.get(roomId);
        if (seats) {
          for (const s of seats) {
            if (s.userId === userId) {
              s.userId = null;
              s.username = '';
              s.displayName = '';
              s.avatarUrl = '';
              s.isSpeaking = false;
              s.isCameraOn = false;
              ioInstance?.to(`room:${roomId}`).emit('webrtc:speaker-left', {
                contextType: 'room',
                contextId: roomId,
                speakerSocketId: socket.id,
                speakerUserId: userId
              });
            }
          }
        }
      }
    }
  }
  broadcastRoomState(roomId);
}

function leaveLiveHelper(socket: Socket, liveId: string, userId: string) {
  socket.leave(`live:${liveId}`);
  activeSpeakerSockets.get(`live:${liveId}`)?.delete(socket.id);
  ioInstance?.to(`live:${liveId}`).emit('webrtc:peer-left', {
    contextType: 'live',
    contextId: liveId,
    peerSocketId: socket.id,
    peerUserId: userId
  });

  const vMap = liveViewers.get(liveId);
  if (vMap) {
    const sSet = vMap.get(userId);
    if (sSet) {
      sSet.delete(socket.id);
      if (sSet.size === 0) {
        vMap.delete(userId);
        const seats = liveVoiceSeats.get(liveId);
        if (seats) {
          for (const s of seats) {
            if (s.userId === userId) {
              if (s.seatIndex !== 0) {
                s.userId = null;
                s.username = '';
                s.displayName = '';
                s.avatarUrl = '';
              }
              s.isSpeaking = false;
              s.isCameraOn = false;
              ioInstance?.to(`live:${liveId}`).emit('webrtc:speaker-left', {
                contextType: 'live',
                contextId: liveId,
                speakerSocketId: socket.id,
                speakerUserId: userId
              });
            }
          }
        }
      }
    }
  }
  broadcastLiveState(liveId);
}

function parseCookie(cookieStr: string, name: string): string | undefined {
  const match = cookieStr.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : undefined;
}
