import React, { useEffect, useState, useRef } from 'react';
import {
  Menu,
  Bell,
  UserPlus,
  Mail,
  Film,
  Trophy,
  Sparkles,
  Radio,
  ShoppingBag,
  Users,
  Home,
  User as UserIcon,
  RefreshCw,
  Send,
  Mic,
  MicOff,
  Headphones,
  VolumeX,
  Image as ImageIcon,
  Gift,
  ChevronUp,
  ChevronDown,
  Lock,
  Plus,
  Shield,
  Trash2,
  Flag,
  Square,
  Settings,
  Crown,
  Search,
  X,
  Sun,
  Moon
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { apiFetch, uploadMediaFile } from '../services/api';
import { Room, RoomMessage, VoiceSeat } from '../types';
import { AvatarWithFrame } from './AvatarWithFrame';
import { useWebRTCAudio } from '../hooks/useWebRTCAudio';
import { playRoomJoinSound, playChatSendSound, playChatReplySound } from '../services/soundEffects';

interface ChatRoomViewProps {
  onNavigateLive: () => void;
  onOpenModal: (
    modal:
      | 'pm'
      | 'friends'
      | 'stories'
      | 'reels'
      | 'wall'
      | 'rankings'
      | 'store'
      | 'admin'
      | null,
    extraUserId?: string
  ) => void;
  onOpenProfile: (userId: string) => void;
  onOpenGift: (receiverId: string, receiverName: string, roomId: string) => void;
  onOpenReport: (targetType: string, targetId: string) => void;
}

export const ChatRoomView: React.FC<ChatRoomViewProps> = ({
  onNavigateLive,
  onOpenModal,
  onOpenProfile,
  onOpenGift,
  onOpenReport
}) => {
  const { user, socket, rooms, refreshRooms, addToast, theme, toggleTheme, sessionEntryTime } = useApp();
  const [activeRoomId, setActiveRoomId] = useState<string>('room-general');
  const [messages, setMessages] = useState<any[]>([]);
  const hasCleanedInitialMessagesRef = useRef<boolean>(false);
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [seats, setSeats] = useState<VoiceSeat[]>([]);
  const [podiums, setPodiums] = useState<{ topStaff: any[]; topMembers: any[] }>({
    topStaff: [],
    topMembers: []
  });

  // UI toggles (On mobile <768px, keep rightUsersOpen closed initially so chat stream is unobstructed)
  const [leftNavOpen, setLeftNavOpen] = useState<boolean>(false);
  const [rightUsersOpen, setRightUsersOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const [seatsCollapsed, setSeatsCollapsed] = useState<boolean>(false);
  const [isListeningRoomAudio, setIsListeningRoomAudio] = useState<boolean>(true);
  const [userSearch, setUserSearch] = useState('');

  // Context Menu popover when clicking a user
  const [selectedContextUser, setSelectedContextUser] = useState<any | null>(null);

  // Rooms & Private Room Modals
  const [showRoomsModal, setShowRoomsModal] = useState(false);
  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
  const [privatePromptRoom, setPrivatePromptRoom] = useState<Room | null>(null);
  const [privateRoomCodeInput, setPrivateRoomCodeInput] = useState('');
  const [privateRoomPwdInput, setPrivateRoomPwdInput] = useState('');

  // Create Room Form
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomDesc, setNewRoomDesc] = useState('');
  const [newRoomIsPrivate, setNewRoomIsPrivate] = useState(false);
  const [newRoomCode, setNewRoomCode] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');

  // Room Settings Edit Modal
  const [showRoomSettings, setShowRoomSettings] = useState(false);
  const [editRoomName, setEditRoomName] = useState('');
  const [editRoomWelcome, setEditRoomWelcome] = useState('');
  const [editRoomLocked, setEditRoomLocked] = useState(false);

  // Notifications popover
  const [showNotifs, setShowNotifs] = useState(false);
  const [notifsList, setNotifsList] = useState<any[]>([]);

  // Chat Input & Voice Clip Recording
  const [inputText, setInputText] = useState('');
  const [recordingClip, setRecordingClip] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const chatStreamEndRef = useRef<HTMLDivElement | null>(null);

  const currentRoom = rooms.find((r) => r.id === activeRoomId) || rooms[0];

  // Helper to ensure white custom colors remain legible in Light Mode
  const resolveLegibleColor = (hexColor?: string, fallbackDark = '#FFFFFF', fallbackLight = '#0F172A') => {
    const normalized = (hexColor || '').trim().toUpperCase();
    if (!normalized || normalized === '#FFFFFF' || normalized === '#FFF' || normalized === '#F1F5F9') {
      return theme === 'light' ? fallbackLight : fallbackDark;
    }
    return hexColor;
  };

  // Real WebRTC Voice Seats Connection
  const { micError } = useWebRTCAudio({
    socket,
    currentUserId: user?.id || '',
    contextType: 'room',
    contextId: activeRoomId,
    seats,
    isListening: isListeningRoomAudio
  });

  // Load Podiums (تفاعل الإدارة & تفاعل الأعضاء)
  const loadPodiums = async () => {
    try {
      const res = await apiFetch<{ topStaff: any[]; topMembers: any[] }>('/api/rankings');
      setPodiums({
        topStaff: res.topStaff || [],
        topMembers: res.topMembers || []
      });
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadPodiums();
  }, [activeRoomId]);

  const handleOpenNotifs = async () => {
    const next = !showNotifs;
    setShowNotifs(next);
    if (next) {
      try {
        const res = await apiFetch<{ notifications: any[] }>('/api/notifications');
        setNotifsList(res.notifications);
      } catch {
        // ignore
      }
    }
  };

  // Load room messages & join socket room (Public Room Messages are ephemeral per visit)
  useEffect(() => {
    if (!socket || !activeRoomId) return;

    const freshFlag = !hasCleanedInitialMessagesRef.current ? '&fresh=1' : '';
    hasCleanedInitialMessagesRef.current = true;
    apiFetch<{ messages: RoomMessage[] }>(
      `/api/rooms/${activeRoomId}/messages?since=${sessionEntryTime}${freshFlag}`
    )
      .then((res) => setMessages(res.messages))
      .catch(() => {});

    socket.emit('room:join', { roomId: activeRoomId });

    const handlePresence = (payload: {
      roomId: string;
      onlineCount: number;
      onlineUsers: any[];
      seats: VoiceSeat[];
    }) => {
      if (payload.roomId !== activeRoomId) return;
      setOnlineUsers(payload.onlineUsers);
      setSeats(payload.seats);
      refreshRooms();
    };

    const handleSeatsUpdate = (payload: { contextType: string; contextId: string; seats: VoiceSeat[] }) => {
      if (payload.contextType === 'room' && payload.contextId === activeRoomId) {
        setSeats(payload.seats);
      }
    };

    const handleNewMessage = (msg: RoomMessage) => {
      if (msg.room_id !== activeRoomId) return;
      if (
        user &&
        msg.user_id !== user.id &&
        msg.content &&
        (msg.content.includes(`@${user.display_name}`) ||
          msg.content.includes(`@${user.username}`) ||
          msg.content.includes(`رد على ${user.display_name}`))
      ) {
        playChatReplySound();
      }
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev.slice(-100), msg];
      });
    };

    const handleSystemEvent = (ev: any) => {
      if (ev.roomId !== activeRoomId) return;
      if (ev.userId !== user?.id) {
        playRoomJoinSound();
      }
      setMessages((prev) => [
        ...prev.slice(-100),
        {
          id: ev.id,
          room_id: ev.roomId,
          user_id: ev.userId,
          display_name: ev.displayName,
          avatar_url: ev.avatarUrl,
          role_label: ev.badgeText,
          content: ev.text,
          is_system: 1,
          hasRoyalEntry: ev.hasRoyalEntry,
          created_at: ev.createdAt
        }
      ]);
    };

    const handleMessageDeleted = ({ msgId }: { msgId: string }) => {
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    };

    const handleMessagesCleared = (payload?: { roomId?: string }) => {
      if (!payload?.roomId || payload.roomId === 'all' || payload.roomId === activeRoomId) {
        setMessages([]);
      }
    };

    const handleUserMessagesCleared = ({ userId: clearedUid }: { userId: string }) => {
      setMessages((prev) => prev.filter((m) => m.user_id !== clearedUid));
    };

    const handleRoomError = ({ message }: { message: string }) => {
      addToast(message, 'error');
    };

    const handleKicked = (payload: { roomId: string; actionType: string; reason: string }) => {
      if (payload.roomId === activeRoomId) {
        addToast(`تم إخراجك من الغرفة: ${payload.reason}`, 'error');
        setActiveRoomId('room-general');
      }
    };

    const handleSeatInvited = (payload: { roomId: string; seatIndex: number; invitedBy: string }) => {
      playRoomJoinSound();
      addToast(`🎙️ دعاك ${payload.invitedBy} للصعود إلى المقعد الصوتي رقم ${payload.seatIndex + 1}!`, 'info');
    };

    socket.on('room:presence', handlePresence);
    socket.on('voice:seats_update', handleSeatsUpdate);
    socket.on('room:new_message', handleNewMessage);
    socket.on('room:system_event', handleSystemEvent);
    socket.on('room:message_deleted', handleMessageDeleted);
    socket.on('room:messages_cleared', handleMessagesCleared);
    socket.on('room:user_messages_cleared', handleUserMessagesCleared);
    socket.on('room:error', handleRoomError);
    socket.on('room:kicked', handleKicked);
    socket.on('room:seat:invited', handleSeatInvited);

    return () => {
      socket.off('room:presence', handlePresence);
      socket.off('voice:seats_update', handleSeatsUpdate);
      socket.off('room:new_message', handleNewMessage);
      socket.off('room:system_event', handleSystemEvent);
      socket.off('room:message_deleted', handleMessageDeleted);
      socket.off('room:messages_cleared', handleMessagesCleared);
      socket.off('room:user_messages_cleared', handleUserMessagesCleared);
      socket.off('room:error', handleRoomError);
      socket.off('room:kicked', handleKicked);
      socket.off('room:seat:invited', handleSeatInvited);
    };
  }, [socket, activeRoomId, sessionEntryTime, user?.id]);

  useEffect(() => {
    chatStreamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket || !inputText.trim()) return;
    playChatSendSound();
    socket.emit('room:message', {
      roomId: activeRoomId,
      content: inputText.trim(),
      mediaType: 'text'
    });
    setInputText('');
  };

  const handleImageAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !socket) return;
    try {
      const uploaded = await uploadMediaFile(file);
      socket.emit('room:message', {
        roomId: activeRoomId,
        content: '',
        mediaUrl: uploaded.url,
        mediaType: uploaded.mimeType.startsWith('video/') ? 'video' : 'image'
      });
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const toggleVoiceClipRecording = async () => {
    if (!socket) return;
    if (recordingClip && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecordingClip(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `room_voice_${Date.now()}.webm`, { type: 'audio/webm' });
        try {
          const uploaded = await uploadMediaFile(file);
          socket.emit('room:message', {
            roomId: activeRoomId,
            content: 'رسالة صوتية 🎙️',
            mediaUrl: uploaded.url,
            mediaType: 'audio'
          });
        } catch (err: any) {
          addToast(err.message, 'error');
        }
      };
      mr.start();
      setRecordingClip(true);
    } catch {
      addToast('يرجى السماح بصلاحية الميكروفون لتسجيل مقطع صوتي.', 'error');
    }
  };

  const handleSelectRoom = (room: Room) => {
    if (room.is_private && room.owner_id !== user?.id && user?.role !== 'Owner') {
      setPrivatePromptRoom(room);
      setPrivateRoomCodeInput(room.room_code || '');
      setPrivateRoomPwdInput('');
      return;
    }
    setActiveRoomId(room.id);
    setShowRoomsModal(false);
    setLeftNavOpen(false);
  };

  const handleVerifyPrivateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ roomId: string; name: string }>('/api/rooms/verify-private', {
        method: 'POST',
        body: JSON.stringify({
          roomCode: privateRoomCodeInput,
          password: privateRoomPwdInput
        })
      });
      setPrivatePromptRoom(null);
      setShowRoomsModal(false);
      setLeftNavOpen(false);
      setActiveRoomId(res.roomId);
      addToast(`تم الدخول إلى الغرفة الخاصة: ${res.name}`, 'success');
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ room: Room }>('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          name: newRoomName,
          description: newRoomDesc,
          isPrivate: newRoomIsPrivate,
          roomCode: newRoomCode,
          password: newRoomPassword
        })
      });
      await refreshRooms();
      setShowCreateRoomModal(false);
      setNewRoomName('');
      setNewRoomDesc('');
      setNewRoomPassword('');
      setActiveRoomId(res.room.id);
      addToast(`تم إنشاء الغرفة "${res.room.name}" بنجاح!`, 'success');
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleModerateUserInRoom = async (
    targetUserId: string,
    actionType: 'mute' | 'kick' | 'ban' | 'unmute'
  ) => {
    try {
      await apiFetch(`/api/rooms/${activeRoomId}/moderate`, {
        method: 'POST',
        body: JSON.stringify({
          targetUserId,
          actionType,
          durationMinutes: 60,
          reason: 'مخالفة نظام الغرفة'
        })
      });
      addToast('تم تنفيذ الإجراء داخل الغرفة بنجاح', 'success');
      setSelectedContextUser(null);
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const isRoomModOrOwner =
    Boolean(user?.permissions?.can_moderate_chat) ||
    currentRoom?.owner_id === user?.id ||
    user?.role === 'Owner';

  const canAccessAdmin = Boolean(user?.permissions?.can_access_admin || user?.role === 'Owner');

  const filteredOnlineUsers = onlineUsers.filter(
    (u) =>
      u.display_name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.username.toLowerCase().includes(userSearch.toLowerCase())
  );

  // Helper to render Top-3 Podium Card
  const renderPodiumCard = (title: string, list: any[], borderAccent: string) => {
    const first = list[0];
    const second = list[1];
    const third = list[2];
    return (
      <div
        className={`rounded-2xl bg-white dark:bg-slate-900/95 border ${borderAccent} p-3 shadow-sm transition-colors`}
      >
        <div className="text-center text-xs font-extrabold text-amber-600 dark:text-amber-300 mb-2 flex items-center justify-center gap-1">
          <Crown className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
          <span>{title}</span>
        </div>

        {list.length === 0 ? (
          <div className="text-[11px] text-slate-400 dark:text-slate-500 text-center py-3">
            لا توجد بيانات تصنيف بعد
          </div>
        ) : (
          <div className="grid grid-cols-3 items-end gap-1.5 pt-1">
            {/* #2 Silver */}
            <div className="flex flex-col items-center text-center">
              {second ? (
                <div onClick={() => onOpenProfile(second.id)} className="cursor-pointer flex flex-col items-center">
                  <span className="text-[10px] font-bold text-slate-500 dark:text-slate-300 mb-0.5 font-mono-num">
                    🥈 2
                  </span>
                  <AvatarWithFrame
                    avatarUrl={second.avatar_url}
                    displayName={second.display_name}
                    gender={second.gender}
                    size="sm"
                  />
                  <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate max-w-[68px] mt-1">
                    {second.display_name}
                  </span>
                </div>
              ) : (
                <div className="h-12" />
              )}
            </div>

            {/* #1 Gold Center */}
            <div className="flex flex-col items-center text-center -mt-2">
              {first && (
                <div onClick={() => onOpenProfile(first.id)} className="cursor-pointer flex flex-col items-center">
                  <span className="text-xs font-extrabold text-amber-500 dark:text-amber-400 mb-0.5">
                    👑 TOP 1
                  </span>
                  <AvatarWithFrame
                    avatarUrl={first.avatar_url}
                    displayName={first.display_name}
                    gender={first.gender}
                    activeFrame="ring-2 ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]"
                    size="md"
                  />
                  <span className="text-[11px] font-extrabold text-amber-700 dark:text-amber-200 truncate max-w-[80px] mt-1">
                    {first.display_name}
                  </span>
                </div>
              )}
            </div>

            {/* #3 Bronze */}
            <div className="flex flex-col items-center text-center">
              {third ? (
                <div onClick={() => onOpenProfile(third.id)} className="cursor-pointer flex flex-col items-center">
                  <span className="text-[10px] font-bold text-amber-600 mb-0.5 font-mono-num">🥉 3</span>
                  <AvatarWithFrame
                    avatarUrl={third.avatar_url}
                    displayName={third.display_name}
                    gender={third.gender}
                    size="sm"
                  />
                  <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate max-w-[68px] mt-1">
                    {third.display_name}
                  </span>
                </div>
              ) : (
                <div className="h-12" />
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-[#F8FAFC] dark:bg-[#0B0D13] text-slate-900 dark:text-slate-100 flex flex-col select-none transition-colors duration-200">
      {/* ====================================================================
          1. TOP NAVIGATION BAR (Matched to Video Design in Light & Dark Mode)
         ==================================================================== */}
      <header className="h-14 bg-[#2563EB] dark:bg-[#11141D] text-white border-b border-blue-700 dark:border-white/10 px-2 sm:px-4 flex items-center justify-between gap-1.5 shrink-0 z-30 overflow-hidden shadow-md transition-colors">
        {/* Right Zone (RTL Start): Hamburger Menu (☰) + Room Selector + Primary Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setLeftNavOpen(!leftNavOpen)}
            className="p-2 rounded-xl bg-white/15 hover:bg-white/25 dark:bg-slate-800/80 dark:hover:bg-slate-700 text-white cursor-pointer shrink-0 transition-colors"
            title="القائمة الجانبية"
            aria-label="فتح القائمة الجانبية"
          >
            <Menu className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => setShowRoomsModal(true)}
            className="hidden lg:flex items-center gap-1.5 text-xs font-extrabold text-white bg-white/15 hover:bg-white/25 dark:bg-slate-800/70 px-3 py-1.5 rounded-xl border border-white/20 dark:border-white/10 cursor-pointer transition-colors shrink-0"
          >
            <span className="truncate max-w-[120px]">{currentRoom?.name || 'الغرفة العامة'}</span>
            {currentRoom?.is_private ? <Lock className="w-3 h-3 text-amber-300" /> : null}
          </button>

          {/* Admin Panel Button (Unified pill style matching video) */}
          {canAccessAdmin && (
            <button
              type="button"
              onClick={() => onOpenModal('admin')}
              className="px-2.5 py-1.5 rounded-xl bg-slate-950/85 hover:bg-slate-900 border border-amber-400/40 text-amber-300 text-[11px] font-extrabold flex items-center gap-1 shrink-0 cursor-pointer transition-colors shadow-xs"
            >
              <Shield className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">الإدارة</span>
            </button>
          )}

          {/* Live Stream Button (Unified across mobile & desktop) */}
          <button
            type="button"
            onClick={onNavigateLive}
            className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-[11px] sm:text-xs font-extrabold flex items-center gap-1.5 shadow-sm shadow-rose-950/30 shrink-0 cursor-pointer transition-transform active:scale-95"
          >
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span>البث المباشر</span>
          </button>
        </div>

        {/* Center/Left Unified Action Buttons (Same order & shape across Desktop & Mobile) */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Notifications / إشعار */}
          <button
            type="button"
            onClick={handleOpenNotifs}
            className="relative px-2 py-1 rounded-xl bg-white/10 hover:bg-white/20 dark:bg-slate-800/70 dark:hover:bg-slate-800 text-white flex flex-col items-center justify-center shrink-0 cursor-pointer transition-colors"
            title="الإشعارات"
          >
            <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-300" />
            <span className="text-[9px] sm:text-[10px] font-bold leading-tight">إشعار</span>
            {(user?.unreadNotifs || 0) > 0 && (
              <span className="absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-white/40" />
            )}
          </button>

          {/* Followers & Follow Back / المتابعون */}
          <button
            type="button"
            onClick={() => onOpenModal('friends')}
            className="relative px-2 py-1 rounded-xl bg-white/10 hover:bg-white/20 dark:bg-slate-800/70 dark:hover:bg-slate-800 text-white flex flex-col items-center justify-center shrink-0 cursor-pointer transition-colors"
            title="المتابعون ورد المتابعة"
          >
            <UserPlus className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-300" />
            <span className="text-[9px] sm:text-[10px] font-bold leading-tight">متابعون</span>
            {(user?.pendingFriendReqs || 0) > 0 && (
              <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center font-mono-num">
                {user?.pendingFriendReqs}
              </span>
            )}
          </button>

          {/* Private Messages / رسالة */}
          <button
            type="button"
            onClick={() => onOpenModal('pm')}
            className="relative px-2 py-1 rounded-xl bg-white/10 hover:bg-white/20 dark:bg-slate-800/70 dark:hover:bg-slate-800 text-white flex flex-col items-center justify-center shrink-0 cursor-pointer transition-colors"
            title="الرسائل الخاصة"
          >
            <Mail className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-sky-200 dark:text-indigo-400" />
            <span className="text-[9px] sm:text-[10px] font-bold leading-tight">رسالة</span>
            {(user?.unreadPm || 0) > 0 && (
              <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center font-mono-num">
                {user?.unreadPm}
              </span>
            )}
          </button>

          {/* Reels / ريلز */}
          <button
            type="button"
            onClick={() => onOpenModal('reels')}
            className="hidden xs:flex sm:flex px-2 py-1 rounded-xl bg-white/10 hover:bg-white/20 dark:bg-slate-800/70 dark:hover:bg-slate-800 text-white flex-col items-center justify-center shrink-0 cursor-pointer transition-colors"
            title="ريلز"
          >
            <Film className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-300" />
            <span className="text-[9px] sm:text-[10px] font-bold leading-tight">ريلز</span>
          </button>

          {/* Rankings / التفاعل */}
          <button
            type="button"
            onClick={() => onOpenModal('rankings')}
            className="hidden sm:flex px-2 py-1 rounded-xl bg-white/10 hover:bg-white/20 dark:bg-slate-800/70 dark:hover:bg-slate-800 text-white flex-col items-center justify-center shrink-0 cursor-pointer transition-colors"
            title="التفاعل والمتصدرين"
          >
            <Trophy className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-300" />
            <span className="text-[9px] sm:text-[10px] font-bold leading-tight">التفاعل</span>
          </button>

          {/* Stories / ستوري */}
          <button
            type="button"
            onClick={() => onOpenModal('stories')}
            className="hidden md:flex px-2 py-1 rounded-xl bg-white/10 hover:bg-white/20 dark:bg-slate-800/70 dark:hover:bg-slate-800 text-white flex-col items-center justify-center shrink-0 cursor-pointer transition-colors"
            title="القصص اليومية"
          >
            <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-pink-300" />
            <span className="text-[9px] sm:text-[10px] font-bold leading-tight">ستوري</span>
          </button>

          {/* Store / المتجر */}
          <button
            type="button"
            onClick={() => onOpenModal('store')}
            className="hidden md:flex px-2 py-1 rounded-xl bg-white/10 hover:bg-white/20 dark:bg-slate-800/70 dark:hover:bg-slate-800 text-white flex-col items-center justify-center shrink-0 cursor-pointer transition-colors"
            title="المتجر"
          >
            <ShoppingBag className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-300" />
            <span className="text-[9px] sm:text-[10px] font-bold leading-tight">المتجر</span>
          </button>

          {/* Theme Switcher Button (☀️ / 🌙) */}
          <button
            type="button"
            onClick={toggleTheme}
            className="px-2 py-1 rounded-xl bg-white/10 hover:bg-white/20 dark:bg-slate-800/70 dark:hover:bg-slate-800 text-white flex flex-col items-center justify-center shrink-0 cursor-pointer transition-colors"
            title={theme === 'dark' ? 'التبديل إلى الوضع النهاري' : 'التبديل إلى الوضع الليلي'}
          >
            {theme === 'dark' ? (
              <Sun className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-300" />
            ) : (
              <Moon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-200" />
            )}
            <span className="text-[9px] sm:text-[10px] font-bold leading-tight">
              {theme === 'dark' ? 'نهاري' : 'ليلي'}
            </span>
          </button>

          {/* Current User Profile & Settings Trigger */}
          {user && (
            <div className="pr-0.5 shrink-0">
              <AvatarWithFrame
                avatarUrl={user.avatar_url}
                displayName={user.display_name}
                gender={user.gender}
                activeFrame={user.active_frame}
                size="sm"
                showOnline
                onClick={() => onOpenProfile(user.id)}
              />
            </div>
          )}
        </div>
      </header>

      {/* Notifications Dropdown */}
      {showNotifs && (
        <div className="fixed top-16 left-4 right-4 sm:right-auto z-50 sm:w-80 max-h-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
          <div className="p-3 bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-white/10 flex items-center justify-between text-xs font-bold text-slate-900 dark:text-white">
            <span>الإشعارات والتنبيهات</span>
            <button
              type="button"
              onClick={() => setShowNotifs(false)}
              className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              إغلاق
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {notifsList.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">لا توجد إشعارات جديدة</p>
            ) : (
              notifsList.map((n) => (
                <div
                  key={n.id}
                  className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/5 text-xs space-y-1"
                >
                  <div className="font-bold text-amber-600 dark:text-amber-300">{n.title}</div>
                  <div className="text-slate-700 dark:text-slate-300">{n.body}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ====================================================================
          2. MAIN WORKSPACE (h-[calc(100vh-120px)] Stable Mobile Flex Layout)
         ==================================================================== */}
      <div className="flex-1 h-[calc(100vh-120px)] flex min-h-0 relative overflow-hidden">
        {/* Mobile Slide-Over Backdrop Overlay */}
        {leftNavOpen && (
          <div
            onClick={() => setLeftNavOpen(false)}
            className="fixed inset-0 z-30 bg-black/50 backdrop-blur-xs md:hidden"
          />
        )}

        {/* ==================================================================
            COLLAPSIBLE SLIDE-OVER SIDEBAR DRAWER (القائمة الجانبية)
            Contains all secondary actions on mobile + Theme Toggle
           ================================================================== */}
        {leftNavOpen && (
          <aside className="fixed md:relative inset-y-0 right-0 z-40 w-72 sm:w-68 bg-white dark:bg-[#131722] border-l border-slate-200 dark:border-white/10 flex flex-col justify-between p-4 shadow-2xl transition-all">
            <div className="space-y-3.5 overflow-y-auto min-h-0 flex-1 pr-0.5">
              {/* Drawer Top Header (Mobile Close + Theme Switcher) */}
              <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-white/10">
                <span className="text-xs font-extrabold text-slate-500 dark:text-slate-400">
                  القائمة الجانبية والتنقل
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                    title="تبديل المظهر"
                  >
                    {theme === 'dark' ? (
                      <>
                        <Sun className="w-3.5 h-3.5 text-amber-400" />
                        <span>الوضع النهاري</span>
                      </>
                    ) : (
                      <>
                        <Moon className="w-3.5 h-3.5 text-indigo-600" />
                        <span>الوضع الليلي</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLeftNavOpen(false)}
                    className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Current Room Box */}
              <div className="p-3.5 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">الغرفة الحالية</div>
                  <div className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                    {currentRoom?.name}
                  </div>
                  <div className="text-[10px] text-indigo-600 dark:text-indigo-300 font-mono-num">
                    Code: {currentRoom?.room_code}
                  </div>
                </div>
                {isRoomModOrOwner && (
                  <button
                    type="button"
                    onClick={() => {
                      if (currentRoom) {
                        setEditRoomName(currentRoom.name);
                        setEditRoomWelcome(currentRoom.welcome_message);
                        setEditRoomLocked(Boolean(currentRoom.is_locked));
                        setShowRoomSettings(true);
                        setLeftNavOpen(false);
                      }
                    }}
                    className="p-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/5 cursor-pointer shrink-0"
                    title="إعدادات الغرفة"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Navigation Items (Includes all Secondary Mobile Actions: الإدارة, الإشعار, ريلز, التفاعل, ستوري, المتجر) */}
              <nav className="space-y-1 text-xs font-bold">
                {canAccessAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenModal('admin');
                      setLeftNavOpen(false);
                    }}
                    className="w-full p-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-800 dark:text-amber-300 flex items-center justify-between cursor-pointer transition-colors"
                  >
                    <span>لوحة الإدارة والتحكم</span>
                    <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setLeftNavOpen(false);
                    handleOpenNotifs();
                  }}
                  className="w-full p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span>الإشعارات والتنبيهات</span>
                    {(user?.unreadNotifs || 0) > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-mono-num">
                        جديد
                      </span>
                    )}
                  </div>
                  <Bell className="w-4 h-4 text-amber-500 dark:text-amber-300" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onOpenModal('friends');
                    setLeftNavOpen(false);
                  }}
                  className="w-full p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span>طلبات الصداقة</span>
                    {(user?.pendingFriendReqs || 0) > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-mono-num">
                        {user?.pendingFriendReqs}
                      </span>
                    )}
                  </div>
                  <UserPlus className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onOpenModal('reels');
                    setLeftNavOpen(false);
                  }}
                  className="w-full p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span>فيديوهات قصيرة (ريلز)</span>
                  <Film className="w-4 h-4 text-sky-500 dark:text-sky-400" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onOpenModal('rankings');
                    setLeftNavOpen(false);
                  }}
                  className="w-full p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span>التفاعل والمتصدرين</span>
                  <Trophy className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onOpenModal('stories');
                    setLeftNavOpen(false);
                  }}
                  className="w-full p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span>القصص اليومية (ستوري)</span>
                  <Sparkles className="w-4 h-4 text-pink-500 dark:text-pink-400" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onOpenModal('store');
                    setLeftNavOpen(false);
                  }}
                  className="w-full p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span>المتجر والاقتصاد</span>
                  <ShoppingBag className="w-4 h-4 text-amber-500 dark:text-amber-300" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onOpenModal('wall');
                    setLeftNavOpen(false);
                  }}
                  className="w-full p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span>حائط الأصدقاء</span>
                  <Users className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowRoomsModal(true);
                    setLeftNavOpen(false);
                  }}
                  className="w-full p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span>قائمة الرومات والغرف الخاصة</span>
                  <Home className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLeftNavOpen(false);
                    onNavigateLive();
                  }}
                  className="w-full p-3 rounded-xl bg-rose-600/15 hover:bg-rose-600/25 text-rose-700 dark:text-rose-300 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span>البثوث المباشرة (LIVE)</span>
                  <Radio className="w-4 h-4 text-rose-500 dark:text-rose-400" />
                </button>
              </nav>
            </div>

            {/* Wallet & XP Summary in Drawer Footer */}
            {user && (
              <div className="p-3.5 rounded-2xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 space-y-2 text-xs shrink-0 mt-3">
                <div className="flex items-center justify-between font-mono-num">
                  <span className="text-slate-600 dark:text-slate-400 font-bold">المستوى {user.level}</span>
                  <span className="text-indigo-600 dark:text-indigo-300 font-extrabold">{user.xp} XP</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-300 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 dark:bg-indigo-500"
                    style={{ width: `${user.levelProgress?.progressPercent || 0}%` }}
                  />
                </div>
                <div className="flex items-center justify-between pt-1 font-mono-num font-extrabold">
                  <span className="text-amber-600 dark:text-amber-300">🪙 {user.gold} Gold</span>
                  <span className="text-cyan-600 dark:text-cyan-300">💎 {user.gems} Gems</span>
                </div>
              </div>
            )}
          </aside>
        )}

        {/* ==================================================================
            CENTER MAIN CHAT ROOM AREA (Floating Voice Seats + Messages + Input)
           ================================================================== */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 relative bg-[#F8FAFC] dark:bg-[#0E1118] transition-colors">
          {/* Subtle Room Banner Wallpaper */}
          {currentRoom?.banner_url && (
            <div className="absolute inset-0 pointer-events-none opacity-10">
              <img
                src={currentRoom.banner_url}
                alt=""
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* FLOATING VOICE SEATS PILL BAR */}
          <div className="relative z-20 flex flex-col items-center pt-2 px-2 sm:px-3 shrink-0">
            {!seatsCollapsed && (
              <div className="px-3 sm:px-4 py-2 rounded-full bg-white/95 dark:bg-slate-900/90 border border-slate-200 dark:border-white/15 backdrop-blur-xl shadow-lg flex items-center gap-1.5 sm:gap-3 max-w-full overflow-x-auto no-scrollbar transition-colors">
                {/* Headphones Listen Toggle */}
                <button
                  type="button"
                  onClick={() => setIsListeningRoomAudio(!isListeningRoomAudio)}
                  className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border transition-all cursor-pointer shrink-0 ${
                    isListeningRoomAudio
                      ? 'bg-rose-500/15 border-rose-400 text-rose-600 dark:text-rose-300'
                      : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-white/10 text-slate-500'
                  }`}
                  title={isListeningRoomAudio ? 'كتم الصوت الصادر من المقاعد' : 'تشغيل الاستماع للمقاعد'}
                >
                  {isListeningRoomAudio ? (
                    <Headphones className="w-4 h-4 sm:w-5 sm:h-5" />
                  ) : (
                    <VolumeX className="w-4 h-4 sm:w-5 sm:h-5" />
                  )}
                </button>

                {/* 5 Voice Seats */}
                {seats.map((seat) => {
                  const isOccupied = Boolean(seat.userId);
                  const isMine = seat.userId === user?.id;
                  return (
                    <div key={seat.seatIndex} className="relative flex flex-col items-center shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          if (!socket) return;
                          if (isMine) {
                            socket.emit('room:seat:action', {
                              roomId: activeRoomId,
                              seatIndex: seat.seatIndex,
                              action: 'leave'
                            });
                          } else if (!isOccupied) {
                            socket.emit('room:seat:action', {
                              roomId: activeRoomId,
                              seatIndex: seat.seatIndex,
                              action: 'join'
                            });
                          } else if (seat.userId) {
                            onOpenProfile(seat.userId);
                          }
                        }}
                        className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border transition-all cursor-pointer relative ${
                          isOccupied
                            ? seat.isSpeaking
                              ? 'border-emerald-500 ring-2 ring-emerald-400/60'
                              : 'border-indigo-500 dark:border-indigo-400'
                            : seat.isLocked
                            ? 'bg-amber-500/10 dark:bg-slate-950 border-amber-500/40 text-amber-600 dark:text-amber-400'
                            : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-950/90 dark:hover:bg-slate-800 border-slate-300 dark:border-white/15 text-slate-700 dark:text-slate-200'
                        }`}
                        title={
                          isOccupied
                            ? `${seat.displayName} (${isMine ? 'اضغط للنزول من المقعد' : 'اضغط لعرض البروفايل'})`
                            : `صعود للمقعد الصوتي ${seat.seatIndex + 1}`
                        }
                      >
                        {isOccupied ? (
                          <AvatarWithFrame
                            avatarUrl={seat.avatarUrl}
                            displayName={seat.displayName}
                            gender={seat.gender}
                            size="sm"
                            isSpeaking={seat.isSpeaking}
                          />
                        ) : seat.isLocked ? (
                          <Lock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        ) : (
                          <Mic className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        )}
                      </button>

                      {isOccupied && (
                        <span className="text-[9px] font-bold text-slate-700 dark:text-slate-200 truncate max-w-[46px] mt-0.5">
                          {seat.displayName}
                        </span>
                      )}

                      {isMine && (
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            socket?.emit('room:seat:action', {
                              roomId: activeRoomId,
                              seatIndex: seat.seatIndex,
                              action: 'toggle_mute'
                            });
                          }}
                          className={`mt-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold cursor-pointer ${
                            seat.isMuted ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
                          }`}
                        >
                          {seat.isMuted ? 'مكتوم' : 'نشط'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Collapse/Expand Handle */}
            <button
              type="button"
              onClick={() => setSeatsCollapsed(!seatsCollapsed)}
              className="mt-1 px-3 py-0.5 rounded-b-xl bg-white/90 dark:bg-slate-900/90 border border-t-0 border-slate-200 dark:border-white/15 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs cursor-pointer transition-colors"
            >
              {seatsCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          </div>

          {micError && (
            <div className="mx-3 mt-1.5 p-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-700 dark:text-rose-200 text-xs text-center z-20 shrink-0">
              {micError}
            </div>
          )}

          {/* Room Welcome Banner */}
          {currentRoom?.welcome_message && (
            <div className="mx-3 mt-1.5 px-3.5 py-2 rounded-xl bg-white/90 dark:bg-slate-900/80 border border-slate-200 dark:border-white/5 text-xs text-indigo-700 dark:text-indigo-200 flex items-center justify-between gap-2 z-10 shrink-0 transition-colors">
              <span className="truncate">📣 {currentRoom.welcome_message}</span>
              {currentRoom.is_locked ? (
                <span className="text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1 shrink-0">
                  <Lock className="w-3.5 h-3.5" /> الغرفة مقفلة
                </span>
              ) : null}
            </div>
          )}

          {/* CHAT MESSAGES STREAM (Stable Flex-1 Scrollable Area) */}
          <div className="flex-1 min-h-0 overflow-y-auto p-2.5 sm:p-3 space-y-2 z-10 select-text">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-xs space-y-1 text-center px-4">
                <p>لا توجد رسائل في هذه الغرفة بعد.</p>
                <p>ابدأ الحديث الآن واحصل على نقاط XP وعملات ذهبية مع تفاعلك!</p>
              </div>
            ) : (
              messages.map((msg) => {
                if (msg.is_system) {
                  return (
                    <div
                      key={msg.id}
                      className={`px-3.5 py-2 rounded-2xl border flex items-center justify-between gap-2 text-xs ${
                        msg.hasRoyalEntry
                          ? 'bg-gradient-to-r from-amber-500/20 via-purple-500/15 to-white dark:to-slate-900 border-amber-400/50 text-amber-800 dark:text-amber-200'
                          : 'bg-white/90 dark:bg-slate-900/70 border-slate-200 dark:border-white/5 text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <AvatarWithFrame
                          avatarUrl={msg.avatar_url}
                          displayName={msg.display_name}
                          size="xs"
                          onClick={() => onOpenProfile(msg.user_id)}
                        />
                        <span className="font-extrabold text-slate-900 dark:text-white shrink-0">
                          {msg.display_name} :
                        </span>
                        <span className="font-semibold truncate">{msg.content}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono-num shrink-0">
                        {new Date(msg.created_at).toLocaleTimeString('ar-SA', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id}
                    className="group px-3.5 py-2.5 rounded-2xl bg-white hover:bg-slate-50/90 dark:bg-slate-900/85 dark:hover:bg-slate-900 border border-slate-200/80 dark:border-white/5 flex items-start justify-between gap-3 shadow-2xs transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <AvatarWithFrame
                        avatarUrl={msg.avatar_url}
                        displayName={msg.display_name}
                        gender={msg.gender}
                        activeFrame={msg.active_frame}
                        size="md"
                        onClick={() => setSelectedContextUser(msg)}
                      />

                      <div className="min-w-0 flex-1">
                        {/* User Header Row: Role / VIP Badge + Name + Level */}
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          {(msg.active_badge || msg.role_label) && (
                            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-300">
                              {msg.active_badge || msg.role_label}
                            </span>
                          )}
                          <span aria-hidden="true" className="text-slate-400 dark:text-slate-600">
                            ·
                          </span>
                          <button
                            type="button"
                            onClick={() => setSelectedContextUser(msg)}
                            className="text-sm font-extrabold hover:underline cursor-pointer"
                            style={{
                              color: resolveLegibleColor(msg.name_color, '#FFFFFF', '#0F172A')
                            }}
                          >
                            {msg.display_name}
                          </button>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono-num">
                            Lv.{msg.level}
                          </span>
                        </div>

                        {/* Message Body */}
                        {msg.content && (
                          <p
                            className="text-sm font-medium leading-relaxed break-words"
                            style={{
                              color: resolveLegibleColor(msg.font_color, '#F1F5F9', '#1E293B')
                            }}
                          >
                            {msg.content}
                          </p>
                        )}

                        {msg.media_url && msg.media_type === 'image' && (
                          <img
                            src={msg.media_url}
                            alt="صورة مرفقة"
                            referrerPolicy="no-referrer"
                            className="mt-2 max-h-60 rounded-xl object-cover border border-slate-200 dark:border-white/10"
                          />
                        )}

                        {msg.media_url && msg.media_type === 'video' && (
                          <video src={msg.media_url} controls className="mt-2 max-h-60 rounded-xl" />
                        )}

                        {msg.media_url && msg.media_type === 'audio' && (
                          <audio src={msg.media_url} controls className="mt-2 h-9 w-56 max-w-full" />
                        )}
                      </div>
                    </div>

                    {/* Left Timestamp & Quick Moderation Actions */}
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono-num">
                        {new Date(msg.created_at).toLocaleTimeString('ar-SA', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>

                      <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                        <button
                          type="button"
                          onClick={() => {
                            setInputText((prev) =>
                              prev.includes(`@${msg.display_name}`)
                                ? prev
                                : `@${msg.display_name} ${prev}`
                            );
                          }}
                          className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-600 hover:text-white text-[10px] font-bold cursor-pointer"
                          title="رد على الرسالة"
                        >
                          رد
                        </button>
                        {isRoomModOrOwner && (
                          <button
                            type="button"
                            onClick={() =>
                              apiFetch(`/api/rooms/${activeRoomId}/messages/${msg.id}`, {
                                method: 'DELETE'
                              })
                            }
                            className="p-1 rounded bg-rose-600/15 text-rose-600 dark:text-rose-300 hover:bg-rose-600 hover:text-white cursor-pointer"
                            title="حذف الرسالة"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onOpenReport('message', msg.id)}
                          className="p-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-rose-500 cursor-pointer"
                          title="إبلاغ عن الرسالة"
                        >
                          <Flag className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatStreamEndRef} />
          </div>

          {/* BOTTOM CHAT INPUT BAR (Firmly Docked at Bottom) */}
          <form
            onSubmit={handleSendMessage}
            className="p-2 sm:p-3 bg-white dark:bg-[#12151F] border-t border-slate-200 dark:border-white/10 flex items-center gap-2 z-20 shrink-0 transition-colors"
          >
            <button
              type="submit"
              className="w-10 h-10 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shrink-0 shadow-md cursor-pointer"
              title="إرسال"
            >
              <Send className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={toggleVoiceClipRecording}
              className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                recordingClip
                  ? 'bg-rose-600 text-white animate-pulse'
                  : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-amber-600 dark:text-amber-400'
              }`}
              title="تسجيل رسالة صوتية"
            >
              {recordingClip ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            <label
              className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
              title="إرفاق صورة أو فيديو"
            >
              <ImageIcon className="w-4 h-4" />
              <input type="file" accept="image/*,video/*" onChange={handleImageAttachment} className="hidden" />
            </label>

            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="اكتب رسالتك هنا..."
              className="flex-1 min-w-0 px-4 py-2.5 rounded-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </form>
        </main>

        {/* ==================================================================
            ONLINE USERS & TOP PODIUMS SIDEBAR
           ================================================================== */}
        {rightUsersOpen && (
          <>
            <div
              onClick={() => setRightUsersOpen(false)}
              className="fixed inset-0 z-20 bg-black/40 backdrop-blur-xs md:hidden"
            />
            <aside className="fixed md:relative inset-y-0 left-0 z-30 w-72 sm:w-80 bg-slate-50 dark:bg-[#12151E] border-r border-slate-200 dark:border-white/10 flex flex-col shadow-2xl transition-colors">
              {/* Search & Filter Header */}
              <div className="p-2.5 border-b border-slate-200 dark:border-white/10 flex items-center gap-2 bg-white dark:bg-slate-950/60">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute right-3 top-2.5" />
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="بحث في المتصلين..."
                    className="w-full pr-8 pl-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white placeholder-slate-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setRightUsersOpen(false)}
                  className="md:hidden p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {/* Top 3 Podium Cards: تفاعل الإدارة & تفاعل الأعضاء */}
                {renderPodiumCard('تفاعل الإدارة 👑', podiums.topStaff, 'border-amber-500/30')}
                {renderPodiumCard('تفاعل الأعضاء 🏆', podiums.topMembers, 'border-indigo-500/30')}

                {/* Online Users Count Header */}
                <div className="flex items-center justify-between px-1 pt-2">
                  <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                    المتصلين الآن في الغرفة
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-sky-500/15 border border-sky-400/40 text-sky-700 dark:text-sky-300 text-xs font-extrabold font-mono-num">
                    {onlineUsers.length}
                  </span>
                </div>

                {/* Online Users List */}
                <div className="space-y-1.5">
                  {filteredOnlineUsers.map((u) => (
                    <div
                      key={u.id}
                      onClick={() => setSelectedContextUser(u)}
                      className="p-2.5 rounded-2xl bg-white hover:bg-slate-100 dark:bg-slate-900/90 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-white/5 flex items-center justify-between cursor-pointer transition-colors shadow-2xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <AvatarWithFrame
                          avatarUrl={u.avatar_url}
                          displayName={u.display_name}
                          gender={u.gender}
                          activeFrame={u.active_frame}
                          size="sm"
                          showOnline
                        />
                        <div className="min-w-0">
                          <div
                            className="text-xs font-extrabold truncate"
                            style={{
                              color: resolveLegibleColor(u.name_color, '#FFFFFF', '#0F172A')
                            }}
                          >
                            {u.display_name}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            {u.active_badge || u.roleLabel} · Lv.{u.level}
                          </div>
                        </div>
                      </div>

                      <span className="text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
                        {u.country}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </>
        )}
      </div>

      {/* ====================================================================
          3. BOTTOM ACTION BAR (Firmly Docked: المتجر | تحديث | بروفايل | الغرف | أعضاء)
         ==================================================================== */}
      <footer className="h-13 bg-white dark:bg-[#0D1017] border-t border-slate-200 dark:border-white/10 px-3 sm:px-4 flex items-center justify-between sm:justify-end gap-2 sm:gap-5 shrink-0 z-30 transition-colors">
        <button
          type="button"
          onClick={() => onOpenModal('store')}
          className="flex flex-col items-center justify-center text-slate-700 dark:text-slate-300 hover:text-amber-500 dark:hover:text-amber-400 cursor-pointer px-2"
        >
          <ShoppingBag className="w-4 h-4 text-rose-500 dark:text-rose-400" />
          <span className="text-[10px] font-bold mt-0.5">المتجر</span>
        </button>

        <button
          type="button"
          onClick={() => {
            refreshRooms();
            loadPodiums();
            addToast('تم تحديث بيانات الغرفة والمتصلين', 'info');
          }}
          className="flex flex-col items-center justify-center text-slate-700 dark:text-slate-300 hover:text-sky-500 dark:hover:text-sky-400 cursor-pointer px-2"
        >
          <RefreshCw className="w-4 h-4 text-sky-500 dark:text-sky-400" />
          <span className="text-[10px] font-bold mt-0.5">تحديث</span>
        </button>

        <button
          type="button"
          onClick={() => user && onOpenProfile(user.id)}
          className="flex flex-col items-center justify-center text-slate-700 dark:text-slate-300 hover:text-amber-500 dark:hover:text-amber-300 cursor-pointer px-2"
        >
          <UserIcon className="w-4 h-4 text-amber-500 dark:text-amber-400" />
          <span className="text-[10px] font-bold mt-0.5">بروفايل</span>
        </button>

        <button
          type="button"
          onClick={() => setShowRoomsModal(true)}
          className="flex flex-col items-center justify-center text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-white cursor-pointer px-2"
        >
          <Home className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
          <span className="text-[10px] font-bold mt-0.5">الغرف</span>
        </button>

        <button
          type="button"
          onClick={() => setRightUsersOpen(!rightUsersOpen)}
          className="flex flex-col items-center justify-center text-slate-700 dark:text-slate-300 hover:text-emerald-500 dark:hover:text-emerald-400 cursor-pointer px-2"
        >
          <Users className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
          <span className="text-[10px] font-bold mt-0.5">أعضاء ({onlineUsers.length})</span>
        </button>
      </footer>

      {/* ====================================================================
          USER CONTEXT MENU POPOVER
         ==================================================================== */}
      {selectedContextUser && (
        <div
          onClick={() => setSelectedContextUser(null)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/15 rounded-3xl w-72 overflow-hidden shadow-2xl"
          >
            <div className="p-4 bg-slate-50 dark:bg-slate-950 flex items-center justify-between border-b border-slate-200 dark:border-white/10">
              <div className="flex items-center gap-2.5">
                <AvatarWithFrame
                  avatarUrl={selectedContextUser.avatar_url}
                  displayName={selectedContextUser.display_name}
                  gender={selectedContextUser.gender}
                  size="md"
                />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    {selectedContextUser.display_name}
                  </div>
                  <div className="text-[11px] text-amber-600 dark:text-amber-300">
                    المستوى {selectedContextUser.level}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedContextUser(null)}
                className="p-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2 space-y-1 text-xs font-bold">
              <button
                type="button"
                onClick={() => {
                  const uid = selectedContextUser.user_id || selectedContextUser.id;
                  setSelectedContextUser(null);
                  onOpenProfile(uid);
                }}
                className="w-full p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-between cursor-pointer"
              >
                <span>عرض الملف الشخصي ومعلومات المستوى</span>
                <UserIcon className="w-4 h-4 text-sky-500 dark:text-sky-400" />
              </button>

              <button
                type="button"
                onClick={() => {
                  const uid = selectedContextUser.user_id || selectedContextUser.id;
                  setSelectedContextUser(null);
                  onOpenModal('pm', uid);
                }}
                className="w-full p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-between cursor-pointer"
              >
                <span>محادثة خاصة</span>
                <Mail className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
              </button>

              <button
                type="button"
                onClick={() => {
                  const uid = selectedContextUser.user_id || selectedContextUser.id;
                  const uname = selectedContextUser.display_name;
                  setSelectedContextUser(null);
                  onOpenGift(uid, uname, activeRoomId);
                }}
                className="w-full p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-amber-600 dark:text-amber-300 flex items-center justify-between cursor-pointer"
              >
                <span>إهداء هدية</span>
                <Gift className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              </button>

              {isRoomModOrOwner && (selectedContextUser.user_id || selectedContextUser.id) !== user?.id && (
                <div className="pt-2 mt-2 border-t border-slate-200 dark:border-white/10 space-y-1">
                  <div className="px-2 text-[10px] text-slate-400 dark:text-slate-500">أدوات إشراف الغرفة</div>
                  <button
                    type="button"
                    onClick={() =>
                      handleModerateUserInRoom(selectedContextUser.user_id || selectedContextUser.id, 'mute')
                    }
                    className="w-full p-2 rounded-xl hover:bg-amber-500/20 text-amber-600 dark:text-amber-300 flex items-center justify-between cursor-pointer"
                  >
                    <span>كتم في الغرفة</span>
                    <MicOff className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleModerateUserInRoom(selectedContextUser.user_id || selectedContextUser.id, 'kick')
                    }
                    className="w-full p-2 rounded-xl hover:bg-rose-500/20 text-rose-600 dark:text-rose-300 flex items-center justify-between cursor-pointer"
                  >
                    <span>طرد من الغرفة</span>
                    <X className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleModerateUserInRoom(selectedContextUser.user_id || selectedContextUser.id, 'ban')
                    }
                    className="w-full p-2 rounded-xl hover:bg-rose-600 text-rose-600 dark:text-rose-400 hover:text-white flex items-center justify-between cursor-pointer"
                  >
                    <span>حظر من الغرفة</span>
                    <Shield className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          ROOMS DIRECTORY & PRIVATE ROOM ACCESS MODAL
         ==================================================================== */}
      {showRoomsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/15 rounded-3xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-4 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">قائمة الغرف العامة والخاصة</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowRoomsModal(false);
                    setShowCreateRoomModal(true);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إنشاء غرفة جديدة</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowRoomsModal(false)}
                  className="p-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Direct Join Private Room by Room ID + Password */}
            <form
              onSubmit={handleVerifyPrivateRoom}
              className="p-4 bg-slate-100/70 dark:bg-slate-950/60 border-b border-slate-200 dark:border-white/10 flex flex-wrap items-center gap-2"
            >
              <span className="text-xs font-bold text-amber-700 dark:text-amber-300 w-full mb-1">
                🔒 دخول سريع لغرفة خاصة بواسطة المعرّف (Room ID) وكلمة المرور:
              </span>
              <input
                type="text"
                required
                value={privateRoomCodeInput}
                onChange={(e) => setPrivateRoomCodeInput(e.target.value)}
                placeholder="معرّف الغرفة (Room ID)"
                className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white w-full sm:w-40"
              />
              <input
                type="password"
                required
                value={privateRoomPwdInput}
                onChange={(e) => setPrivateRoomPwdInput(e.target.value)}
                placeholder="كلمة مرور الغرفة"
                className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white flex-1 min-w-[140px]"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold cursor-pointer"
              >
                دخول الغرفة الخاصة
              </button>
            </form>

            {/* Rooms List */}
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {rooms.map((r) => (
                <div
                  key={r.id}
                  onClick={() => handleSelectRoom(r)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                    r.id === activeRoomId
                      ? 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-500 dark:border-indigo-400'
                      : 'bg-slate-50 dark:bg-slate-950/80 hover:bg-slate-100 dark:hover:bg-slate-800/80 border-slate-200 dark:border-white/10'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <span>{r.name}</span>
                        {r.is_private ? <Lock className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" /> : null}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                        {r.description}
                      </p>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-xs font-bold font-mono-num shrink-0">
                      {r.onlineCount || 0} متصل
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-2 border-t border-slate-200 dark:border-white/5 font-mono-num">
                    <span>Room ID: {r.room_code}</span>
                    <span>{r.is_private ? 'غرفة خاصة محمية' : 'غرفة عامة'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* PRIVATE ROOM PASSWORD PROMPT */}
      {privatePromptRoom && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleVerifyPrivateRoom}
            className="bg-white dark:bg-slate-900 border border-amber-500/30 rounded-3xl max-w-sm w-full p-6 space-y-4"
          >
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              🔒 الغرفة "{privatePromptRoom.name}" محمية بكلمة مرور
            </h3>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                معرّف الغرفة (Room ID)
              </label>
              <input
                type="text"
                required
                value={privateRoomCodeInput}
                onChange={(e) => setPrivateRoomCodeInput(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white font-mono-num"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">كلمة المرور</label>
              <input
                type="password"
                required
                value={privateRoomPwdInput}
                onChange={(e) => setPrivateRoomPwdInput(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-extrabold cursor-pointer"
              >
                تحقق ودخول
              </button>
              <button
                type="button"
                onClick={() => setPrivatePromptRoom(null)}
                className="px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CREATE ROOM MODAL */}
      {showCreateRoomModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateRoom}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/15 rounded-3xl max-w-md w-full p-6 space-y-4"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-white">إنشاء غرفة دردشة جديدة</h3>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">اسم الغرفة</label>
              <input
                type="text"
                required
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                placeholder="مثال: ديوانية الأصدقاء"
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">وصف الغرفة</label>
              <input
                type="text"
                value={newRoomDesc}
                onChange={(e) => setNewRoomDesc(e.target.value)}
                placeholder="وصف مختصر للغرفة..."
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-amber-600 dark:text-amber-300 cursor-pointer">
              <input
                type="checkbox"
                checked={newRoomIsPrivate}
                onChange={(e) => setNewRoomIsPrivate(e.target.checked)}
              />
              <span>جعل الغرفة خاصة (محمية بـ Room ID وكلمة مرور)</span>
            </label>
            {newRoomIsPrivate && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Room ID مخصص</label>
                  <input
                    type="text"
                    required
                    value={newRoomCode}
                    onChange={(e) => setNewRoomCode(e.target.value)}
                    placeholder="مثال: VIP-777"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">كلمة مرور الغرفة</label>
                  <input
                    type="password"
                    required
                    value={newRoomPassword}
                    onChange={(e) => setNewRoomPassword(e.target.value)}
                    placeholder="كلمة المرور"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 pt-2">
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
              >
                إنشاء الغرفة
              </button>
              <button
                type="button"
                onClick={() => setShowCreateRoomModal(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ROOM SETTINGS MODAL */}
      {showRoomSettings && currentRoom && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await apiFetch(`/api/rooms/${currentRoom.id}`, {
                  method: 'PUT',
                  body: JSON.stringify({
                    name: editRoomName,
                    welcomeMessage: editRoomWelcome,
                    isLocked: editRoomLocked
                  })
                });
                await refreshRooms();
                setShowRoomSettings(false);
                addToast('تم حفظ إعدادات الغرفة بنجاح', 'success');
              } catch (err: any) {
                addToast(err.message, 'error');
              }
            }}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/15 rounded-3xl max-w-md w-full p-6 space-y-4"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              إدارة إعدادات الغرفة ({currentRoom.name})
            </h3>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">اسم الغرفة</label>
              <input
                type="text"
                value={editRoomName}
                onChange={(e) => setEditRoomName(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                رسالة الترحيب التلقائية
              </label>
              <input
                type="text"
                value={editRoomWelcome}
                onChange={(e) => setEditRoomWelcome(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-rose-600 dark:text-rose-300 cursor-pointer">
              <input
                type="checkbox"
                checked={editRoomLocked}
                onChange={(e) => setEditRoomLocked(e.target.checked)}
              />
              <span>قفل الدردشة العامة في الغرفة (للمشرفين فقط)</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold cursor-pointer"
              >
                حفظ التغييرات
              </button>
              <button
                type="button"
                onClick={() => setShowRoomSettings(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
