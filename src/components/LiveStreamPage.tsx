import React, { useEffect, useState, useRef } from 'react';
import {
  Radio,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Heart,
  Gift,
  Swords,
  Crown,
  LogOut,
  Plus,
  Send,
  Sparkles,
  UserMinus,
  Video,
  VideoOff,
  Check,
  X,
  RefreshCw,
  Users,
  ChevronUp,
  ChevronDown,
  UserPlus,
  ShieldAlert,
  Flame,
  Eye
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { apiFetch } from '../services/api';
import {
  LiveStream,
  VoiceSeat,
  GuestJoinRequest,
  BattleMvpContributor,
  GiftAnimationEvent
} from '../types';
import { AvatarWithFrame } from './AvatarWithFrame';
import { useWebRTCAudio } from '../hooks/useWebRTCAudio';
import { SendGiftModal } from './SocialModals';

const FullscreenVideoFeed: React.FC<{
  stream: MediaStream;
  isLocal: boolean;
  className?: string;
}> = ({ stream, isLocal, className = 'w-full h-full object-cover' }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={isLocal}
      className={`${className} bg-black ${isLocal ? 'scale-x-[-1]' : ''}`}
    />
  );
};

interface EligibleOpponent {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  level: number;
  gender: 'male' | 'female';
  role: string;
  active_frame: string;
  live_id: string;
  live_title: string;
  viewer_count: number;
  battle_status: string;
  isOnline: boolean;
}

interface PendingBattleInvite {
  liveId: string;
  liveTitle: string;
  hostId: string;
  hostName: string;
  hostAvatar: string;
  mode: 'Classic' | 'Box' | 'Bear' | 'Triple';
  durationSeconds: number;
  expiresAt: number;
}

function formatTimerMmSs(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const LiveStreamPage: React.FC<{
  onBackToRooms: () => void;
  onOpenProfile: (userId: string) => void;
}> = ({ onBackToRooms, onOpenProfile }) => {
  const { user, socket, addToast } = useApp();
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [activeLive, setActiveLive] = useState<LiveStream | null>(null);
  const [seats, setSeats] = useState<VoiceSeat[]>([]);
  const [supporters, setSupporters] = useState<any[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  const [guestRequests, setGuestRequests] = useState<GuestJoinRequest[]>([]);
  const [hostMvp, setHostMvp] = useState<BattleMvpContributor[]>([]);
  const [opponentMvp, setOpponentMvp] = useState<BattleMvpContributor[]>([]);
  const [chatEvents, setChatEvents] = useState<any[]>([]);
  const [activeGiftBanner, setActiveGiftBanner] = useState<GiftAnimationEvent | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isListening, setIsListening] = useState(true);
  const [localTapCount, setLocalTapCount] = useState(0);
  const [tapParticles, setTapParticles] = useState<
    { id: number; x: number; y: number; color: string }[]
  >([]);
  const [supportTargetSide, setSupportTargetSide] = useState<'host' | 'opponent' | 'third'>('host');
  const [pendingSeatInvite, setPendingSeatInvite] = useState<{
    liveId: string;
    seatIndex: number;
    hostName: string;
  } | null>(null);

  // Start stream modal
  const [showStartModal, setShowStartModal] = useState(false);
  const [newLiveTitle, setNewLiveTitle] = useState('');
  const [newLiveTopic, setNewLiveTopic] = useState('بث مباشر وتحديات PK');
  const [startWithCamera, setStartWithCamera] = useState(false);

  // PK Battle modal (STRICTLY Active Live Stream Hosts only)
  const [showBattleModal, setShowBattleModal] = useState(false);
  const [battleMode, setBattleMode] = useState<'Classic' | 'Box' | 'Bear' | 'Triple'>('Classic');
  const [eligibleOpponents, setEligibleOpponents] = useState<EligibleOpponent[]>([]);
  const [loadingOpponents, setLoadingOpponents] = useState(false);
  const [selectedOpponentId, setSelectedOpponentId] = useState<string>('');
  const [selectedThirdId, setSelectedThirdId] = useState<string>('');
  const [battleDuration, setBattleDuration] = useState(300); // TikTok 5-minute default
  const [pendingBattleInvite, setPendingBattleInvite] = useState<PendingBattleInvite | null>(null);

  // Guest Join Request & Management Drawer
  const [showGuestDrawer, setShowGuestDrawer] = useState(false);
  const [showJoinRequestModal, setShowJoinRequestModal] = useState(false);

  // Gift modal
  const [showGiftModal, setShowGiftModal] = useState(false);

  // Countdown state for active/waiting battle & 3-minute punishment phase
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [punishmentRemainingSeconds, setPunishmentRemainingSeconds] = useState(0);
  const [autoStartMic, setAutoStartMic] = useState(true);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Vertical swipe gesture refs for switching between active live streams
  const touchStartYRef = useRef<number | null>(null);

  const loadStreams = async () => {
    try {
      const res = await apiFetch<{ streams: LiveStream[] }>('/api/live');
      setStreams(res.streams);
    } catch {
      // ignore
    }
  };

  const loadEligibleOpponents = async (liveId: string) => {
    setLoadingOpponents(true);
    try {
      const res = await apiFetch<{ opponents: EligibleOpponent[] }>(
        `/api/live/${liveId}/eligible-opponents`
      );
      const activeHostOpponents = res.opponents || [];
      setEligibleOpponents(activeHostOpponents);
      if (activeHostOpponents.length > 0) {
        setSelectedOpponentId((prev) =>
          activeHostOpponents.some((o) => o.id === prev) ? prev : activeHostOpponents[0].id
        );
        if (activeHostOpponents.length > 1) {
          setSelectedThirdId((prev) =>
            activeHostOpponents.some((o) => o.id === prev && o.id !== activeHostOpponents[0].id)
              ? prev
              : activeHostOpponents[1].id
          );
        } else {
          setSelectedThirdId('');
        }
      } else {
        setSelectedOpponentId('');
        setSelectedThirdId('');
      }
    } catch {
      setEligibleOpponents([]);
    } finally {
      setLoadingOpponents(false);
    }
  };

  useEffect(() => {
    loadStreams();
  }, []);

  // Listen for real-time PK battle invitations & guest request updates
  useEffect(() => {
    if (!socket) return;

    const handleBattleInvited = (payload: PendingBattleInvite) => {
      setPendingBattleInvite(payload);
      addToast(`⚔️ دعاك المضيف ${payload.hostName} إلى جولة PK مباشرة (${payload.mode})!`, 'info');
    };

    const handleBattleDeclined = (payload: { liveId: string; declinedByName: string }) => {
      addToast(`❌ اعتذر المضيف ${payload.declinedByName} عن قبول دعوة جولة PK.`, 'error');
    };

    const handleGuestRequested = (payload: { liveId: string; request: GuestJoinRequest }) => {
      if (activeLive && payload.liveId === activeLive.id) {
        addToast(`🙋‍♂️ طلب ${payload.request.displayName} الانضمام كضيف في المقاعد!`, 'info');
      }
    };

    const handleGuestApproved = (payload: {
      liveId: string;
      seatIndex: number;
      withCamera?: boolean;
    }) => {
      if (activeLive && payload.liveId === activeLive.id) {
        unlockAudioPlayback();
        setAutoStartMic(true);
        addToast(`✅ وافق المضيف على طلبك! أنت الآن ضيف متحدث على المقعد #${payload.seatIndex}`, 'success');
        if (payload.withCamera && !cameraActive) {
          setTimeout(() => {
            toggleCamera();
          }, 400);
        }
      }
    };

    const handleGuestRejected = (payload: { liveId: string }) => {
      if (activeLive && payload.liveId === activeLive.id) {
        addToast('اعتذر المضيف عن قبول طلب الانضمام للمقعد حالياً.', 'info');
      }
    };

    socket.on('live:battle:invited', handleBattleInvited);
    socket.on('live:battle:declined', handleBattleDeclined);
    socket.on('live:guest:requested', handleGuestRequested);
    socket.on('live:guest:approved', handleGuestApproved);
    socket.on('live:guest:rejected', handleGuestRejected);

    return () => {
      socket.off('live:battle:invited', handleBattleInvited);
      socket.off('live:battle:declined', handleBattleDeclined);
      socket.off('live:guest:requested', handleGuestRequested);
      socket.off('live:guest:approved', handleGuestApproved);
      socket.off('live:guest:rejected', handleGuestRejected);
    };
  }, [socket, activeLive?.id]);

  // Real WebRTC Audio + Optional Vertical Camera Hook
  const {
    micActive,
    micError,
    micVolumeLevel,
    remoteVolumeLevel,
    autoplayBlocked,
    connectedPeersCount,
    remoteAudioPeerIds,
    cameraActive,
    cameraError,
    localVideoStream,
    remoteVideoStreams,
    startMicrophone,
    toggleCamera,
    unlockAudioPlayback
  } = useWebRTCAudio({
    socket,
    currentUserId: user?.id || '',
    contextType: 'live',
    contextId: activeLive?.id || '',
    seats,
    isListening,
    isHost: Boolean(activeLive && activeLive.host_id === user?.id),
    autoStartMic
  });

  useEffect(() => {
    if (!socket || !activeLive) return;

    socket.emit('live:join', { liveId: activeLive.id });

    const handleLiveState = (payload: {
      stream: LiveStream;
      seats: VoiceSeat[];
      supporters: any[];
      viewerCount: number;
      guestRequests?: GuestJoinRequest[];
      hostMvp?: BattleMvpContributor[];
      opponentMvp?: BattleMvpContributor[];
    }) => {
      if (payload.stream.id !== activeLive.id) return;
      setActiveLive(payload.stream);
      setSeats(payload.seats);
      setSupporters(payload.supporters);
      setViewerCount(payload.viewerCount);
      if (payload.guestRequests) setGuestRequests(payload.guestRequests);
      if (payload.hostMvp) setHostMvp(payload.hostMvp);
      if (payload.opponentMvp) setOpponentMvp(payload.opponentMvp);
    };

    const handleSeatsUpdate = (payload: {
      contextType: string;
      contextId: string;
      seats: VoiceSeat[];
    }) => {
      if (payload.contextType === 'live' && payload.contextId === activeLive.id) {
        setSeats(payload.seats);
      }
    };

    const handleChatEvent = (ev: any) => {
      setChatEvents((prev) => [...prev.slice(-80), ev]);
    };

    const handleGiftAnimation = (giftEv: GiftAnimationEvent) => {
      setActiveGiftBanner(giftEv);
      setTimeout(() => {
        setActiveGiftBanner((prev) => (prev?.id === giftEv.id ? null : prev));
      }, 4500);
    };

    const handleTapBurst = (payload?: { targetSide?: 'host' | 'opponent' | 'third' }) => {
      const pid = Date.now() + Math.random();
      const isOpp = payload?.targetSide === 'opponent';
      const x = isOpp ? Math.floor(15 + Math.random() * 30) : Math.floor(55 + Math.random() * 30);
      const y = Math.floor(25 + Math.random() * 25);
      const color = isOpp ? 'text-rose-500' : 'text-sky-400';
      setTapParticles((prev) => [...prev.slice(-16), { id: pid, x, y, color }]);
      setTimeout(() => {
        setTapParticles((prev) => prev.filter((p) => p.id !== pid));
      }, 950);
    };

    const handleSeatInvited = (payload: { liveId: string; seatIndex: number; hostName: string }) => {
      if (payload.liveId === activeLive.id) {
        setPendingSeatInvite(payload);
      }
    };

    const handleLiveError = (payload: { message: string }) => {
      addToast(payload.message, 'error');
    };

    const handleLiveEnded = () => {
      addToast('انتهى البث المباشر.', 'info');
      setActiveLive(null);
      setSeats([]);
      loadStreams();
    };

    socket.on('live:state', handleLiveState);
    socket.on('voice:seats_update', handleSeatsUpdate);
    socket.on('live:chat_event', handleChatEvent);
    socket.on('live:gift_animation', handleGiftAnimation);
    socket.on('live:tap_burst', handleTapBurst);
    socket.on('live:seat:invited', handleSeatInvited);
    socket.on('live:error', handleLiveError);
    socket.on('live:ended', handleLiveEnded);

    return () => {
      socket.emit('live:leave', { liveId: activeLive.id });
      socket.off('live:state', handleLiveState);
      socket.off('voice:seats_update', handleSeatsUpdate);
      socket.off('live:chat_event', handleChatEvent);
      socket.off('live:gift_animation', handleGiftAnimation);
      socket.off('live:tap_burst', handleTapBurst);
      socket.off('live:seat:invited', handleSeatInvited);
      socket.off('live:error', handleLiveError);
      socket.off('live:ended', handleLiveEnded);
    };
  }, [socket, activeLive?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatEvents]);

  // Countdown timer for Active/Ending/Waiting Battle AND 3-Minute Punishment Phase
  useEffect(() => {
    if (!activeLive || activeLive.battle_status === 'Idle') {
      setRemainingSeconds(0);
      setPunishmentRemainingSeconds(0);
      return;
    }
    const tick = () => {
      const now = Date.now();
      if (activeLive.battle_status === 'Waiting') {
        const rem = Math.max(
          0,
          Math.ceil(((activeLive.battle_invite_expires_at || 0) - now) / 1000)
        );
        setRemainingSeconds(rem);
        setPunishmentRemainingSeconds(0);
      } else if (
        activeLive.battle_status === 'Active' ||
        activeLive.battle_status === 'Ending'
      ) {
        const rem = Math.max(0, Math.ceil(((activeLive.battle_ends_at || 0) - now) / 1000));
        setRemainingSeconds(rem);
        setPunishmentRemainingSeconds(0);
      } else if (activeLive.battle_status === 'Finished') {
        setRemainingSeconds(0);
        const punRem = Math.max(
          0,
          Math.ceil(((activeLive.battle_punishment_ends_at || 0) - now) / 1000)
        );
        setPunishmentRemainingSeconds(punRem);
      }
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [
    activeLive?.battle_status,
    activeLive?.battle_ends_at,
    activeLive?.battle_invite_expires_at,
    activeLive?.battle_punishment_ends_at
  ]);

  const handleStartLive = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      unlockAudioPlayback();
      const res = await apiFetch<{ stream: LiveStream }>('/api/live/start', {
        method: 'POST',
        body: JSON.stringify({ title: newLiveTitle, topic: newLiveTopic })
      });
      setShowStartModal(false);
      setChatEvents([]);
      setAutoStartMic(true);
      if (res.stream.seats) {
        setSeats(res.stream.seats.slice(0, 4));
      }
      setActiveLive(res.stream);
      addToast('بدأ بثك المباشر الآن! 🎥🎙️', 'success');
      if (startWithCamera) {
        setTimeout(() => {
          toggleCamera();
        }, 500);
      }
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleEndLive = async () => {
    if (!activeLive) return;
    try {
      await apiFetch(`/api/live/${activeLive.id}/end`, { method: 'POST' });
      setActiveLive(null);
      setSeats([]);
      loadStreams();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleStartBattle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLive) return;
    if (!selectedOpponentId) {
      addToast('يجب اختيار مضيف لديه بث مباشر نشط لإرسال دعوة التحدي (PK Battle).', 'error');
      return;
    }
    if (
      battleMode === 'Triple' &&
      (!selectedThirdId || selectedThirdId === selectedOpponentId)
    ) {
      addToast('في الجولة الثلاثية يجب اختيار مضيف ثالث مختلف لديه بث مباشر نشط.', 'error');
      return;
    }
    try {
      const res = await apiFetch<{ message: string }>(`/api/live/${activeLive.id}/battle/invite`, {
        method: 'POST',
        body: JSON.stringify({
          mode: battleMode,
          opponentId: selectedOpponentId,
          thirdId: battleMode === 'Triple' ? selectedThirdId : undefined,
          durationSeconds: battleDuration
        })
      });
      setShowBattleModal(false);
      addToast(res.message || 'تم إرسال دعوة جولة PK بنجاح!', 'success');
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleRespondBattleInvite = async (liveId: string, action: 'accept' | 'decline') => {
    try {
      unlockAudioPlayback();
      const res = await apiFetch<{
        message: string;
        status: string;
        opponentLiveId?: string;
      }>(`/api/live/${liveId}/battle/respond`, {
        method: 'POST',
        body: JSON.stringify({ action })
      });
      setPendingBattleInvite(null);
      addToast(res.message, action === 'accept' ? 'success' : 'info');

      if (action === 'accept' && !activeLive) {
        const liveList = await apiFetch<{ streams: LiveStream[] }>('/api/live');
        const myStream =
          liveList.streams.find((s) => s.host_id === user?.id) ||
          liveList.streams.find((s) => s.id === liveId);
        if (myStream) {
          setChatEvents([]);
          setAutoStartMic(myStream.host_id === user?.id);
          if (myStream.seats) setSeats(myStream.seats.slice(0, 4));
          setActiveLive(myStream);
        }
      }
    } catch (err: any) {
      setPendingBattleInvite(null);
      addToast(err.message, 'error');
    }
  };

  const handleNextBattleRound = async () => {
    if (!activeLive) return;
    try {
      const res = await apiFetch<{ message: string }>(
        `/api/live/${activeLive.id}/battle/next-round`,
        {
          method: 'POST'
        }
      );
      addToast(res.message || 'انطلقت الجولة التالية!', 'success');
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleTap = (e?: React.MouseEvent<HTMLElement>) => {
    if (!activeLive || !socket) return;
    if (autoplayBlocked) {
      unlockAudioPlayback();
    }
    setLocalTapCount((c) => c + 1);
    socket.emit('live:tap', { liveId: activeLive.id, targetSide: supportTargetSide });

    if (e) {
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = Math.max(10, Math.min(90, ((e.clientX - rect.left) / rect.width) * 100));
      const relY = Math.max(15, Math.min(80, ((rect.bottom - e.clientY) / rect.height) * 100));
      const pid = Date.now() + Math.random();
      setTapParticles((prev) => [
        ...prev.slice(-16),
        {
          id: pid,
          x: relX,
          y: relY,
          color: supportTargetSide === 'opponent' ? 'text-rose-500' : 'text-sky-400'
        }
      ]);
      setTimeout(() => {
        setTapParticles((prev) => prev.filter((p) => p.id !== pid));
      }, 900);
    }
  };

  const handleSendLiveChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLive || !socket || !chatInput.trim()) return;
    if (autoplayBlocked) {
      unlockAudioPlayback();
    }
    socket.emit('live:chat', { liveId: activeLive.id, content: chatInput.trim() });
    setChatInput('');
  };

  // Vertical Stream Switcher (Swipe Up / Down between active live streams)
  const switchLiveStreamByOffset = async (offset: number) => {
    try {
      const res = await apiFetch<{ streams: LiveStream[] }>('/api/live');
      const activeList = res.streams || [];
      setStreams(activeList);
      if (activeList.length <= 1 || !activeLive) {
        addToast('لا توجد بثوث مباشرة أخرى نشطة حالياً للتنقل إليها.', 'info');
        return;
      }
      const currentIdx = activeList.findIndex((s) => s.id === activeLive.id);
      const nextIdx =
        currentIdx >= 0
          ? (currentIdx + offset + activeList.length) % activeList.length
          : 0;
      const nextStream = activeList[nextIdx];
      if (nextStream && nextStream.id !== activeLive.id) {
        unlockAudioPlayback();
        setChatEvents([]);
        setAutoStartMic(nextStream.host_id === user?.id);
        if (nextStream.seats) setSeats(nextStream.seats.slice(0, 4));
        setActiveLive(nextStream);
      }
    } catch {
      // ignore
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartYRef.current === null) return;
    const deltaY = touchStartYRef.current - e.changedTouches[0].clientY;
    touchStartYRef.current = null;
    if (Math.abs(deltaY) > 95) {
      if (deltaY > 0) {
        switchLiveStreamByOffset(1); // Swipe Up -> Next Live Stream
      } else {
        switchLiveStreamByOffset(-1); // Swipe Down -> Previous Live Stream
      }
    }
  };

  // ==========================================================================
  // VIEW 1: TIKTOK-STYLE LIVE LOBBY
  // ==========================================================================
  if (!activeLive) {
    return (
      <div className="min-h-screen bg-[#07080D] text-slate-100 flex flex-col">
        {/* Top Bar */}
        <header className="px-6 py-4 bg-slate-950/90 backdrop-blur-md border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 text-white flex items-center justify-center shadow-lg shadow-rose-600/30">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-white font-display">
                نبض LIVE · البث المباشر وجولات PK
              </h1>
              <p className="text-xs text-slate-400">
                بثوث عمودية مباشرة بالصوت والكاميرا · جولات PK 50/50 بين المضيفين · مقاعد ضيوف تفاعلية
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowStartModal(true)}
              className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-lg shadow-rose-600/30 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>بدء بث مباشر (LIVE)</span>
            </button>
            <button
              type="button"
              onClick={onBackToRooms}
              className="px-4 py-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-white/10 text-slate-200 text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              العودة للغرف
            </button>
          </div>
        </header>

        {/* Real-Time PK Battle Invitation Banner in Lobby */}
        {pendingBattleInvite && (
          <div className="bg-gradient-to-r from-sky-900/60 via-slate-900 to-rose-900/60 border-b border-white/15 px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs">
              <Swords className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="font-bold text-white">
                ⚔️ دعاك المضيف <span className="text-sky-300 underline">{pendingBattleInvite.hostName}</span> لخوض جولة PK شاشة مقسومة 50/50 ({pendingBattleInvite.mode})!
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleRespondBattleInvite(pendingBattleInvite.liveId, 'accept')}
                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold flex items-center gap-1 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>قبول تحدي PK</span>
              </button>
              <button
                type="button"
                onClick={() => handleRespondBattleInvite(pendingBattleInvite.liveId, 'decline')}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>رفض</span>
              </button>
            </div>
          </div>
        )}

        {/* Active Vertical Streams Grid */}
        <main className="max-w-7xl w-full mx-auto p-6 flex-1">
          {streams.length === 0 ? (
            <div className="my-16 max-w-md mx-auto p-8 rounded-3xl bg-slate-900/80 border border-white/10 text-center space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-rose-500/20 to-pink-600/20 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
                <Radio className="w-8 h-8" />
              </div>
              <h2 className="text-base font-bold text-white">لا توجد بثوث مباشرة نشطة حالياً</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                افتح بثك المباشر الآن بالصوت أو الكاميرا بملء الشاشة العمودية، واستقبل الضيوف في المقاعد أو تحدَّ مضيفين آخرين في جولات PK حماسية!
              </p>
              <button
                type="button"
                onClick={() => setShowStartModal(true)}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white text-xs font-extrabold shadow-lg shadow-rose-600/30 cursor-pointer"
              >
                🎥 افتح بثاً مباشراً الآن
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {streams.map((s) => {
                const hostSeatSpeaking = Boolean(
                  s.seats?.some((seat) => seat.seatIndex === 0 && seat.isSpeaking)
                );
                const occupiedSeatsCount = s.seats
                  ? s.seats.slice(0, 4).filter((seat) => Boolean(seat.userId)).length
                  : 1;
                const isInPk =
                  s.battle_status === 'Active' ||
                  s.battle_status === 'Ending' ||
                  s.battle_status === 'Finished';

                return (
                  <div
                    key={s.id}
                    onClick={() => {
                      unlockAudioPlayback();
                      setChatEvents([]);
                      setAutoStartMic(
                        s.host_id === user?.id && (!s.viewerCount || s.viewerCount === 0)
                      );
                      if (s.seats) setSeats(s.seats.slice(0, 4));
                      setActiveLive(s);
                    }}
                    className="group relative aspect-[9/14] rounded-3xl bg-gradient-to-b from-slate-900 via-slate-950 to-black border border-white/10 hover:border-rose-500/50 overflow-hidden cursor-pointer flex flex-col justify-between p-4 shadow-2xl transition-all hover:-translate-y-1"
                  >
                    {/* Ambient Background Glow */}
                    <div
                      className={`absolute inset-0 opacity-35 transition-opacity group-hover:opacity-55 ${
                        isInPk
                          ? 'bg-gradient-to-r from-sky-600/40 via-transparent to-rose-600/40'
                          : 'bg-gradient-to-b from-rose-600/20 via-indigo-950/30 to-black'
                      }`}
                    />

                    {/* Top Row: LIVE Badge + Viewers */}
                    <div className="relative z-10 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="px-2.5 py-0.5 rounded-lg bg-rose-600 text-white text-[10px] font-extrabold tracking-wider">
                          LIVE
                        </span>
                        {isInPk && (
                          <span className="px-2 py-0.5 rounded-lg bg-gradient-to-r from-sky-500 to-rose-500 text-white text-[10px] font-extrabold">
                            ⚔️ PK
                          </span>
                        )}
                      </div>
                      <span className="px-2.5 py-0.5 rounded-lg bg-black/60 backdrop-blur-md text-slate-200 text-[11px] font-mono-num flex items-center gap-1">
                        <Eye className="w-3 h-3 text-rose-400" />
                        <span>{s.viewerCount || 0}</span>
                      </span>
                    </div>

                    {/* Center Avatar Stage Preview */}
                    <div className="relative z-10 my-auto flex flex-col items-center text-center gap-2.5">
                      {isInPk ? (
                        <div className="flex items-center gap-3">
                          <AvatarWithFrame
                            avatarUrl={s.host_avatar}
                            displayName={s.host_name}
                            gender={s.host_gender}
                            activeFrame={s.host_frame}
                            size="md"
                            isSpeaking={hostSeatSpeaking}
                          />
                          <span className="text-xs font-black italic text-amber-400">VS</span>
                          <AvatarWithFrame
                            avatarUrl={s.battle_opponent_avatar || ''}
                            displayName={s.battle_opponent_name || 'المنافس'}
                            gender="male"
                            size="md"
                          />
                        </div>
                      ) : (
                        <AvatarWithFrame
                          avatarUrl={s.host_avatar}
                          displayName={s.host_name}
                          gender={s.host_gender}
                          activeFrame={s.host_frame}
                          size="lg"
                          isSpeaking={hostSeatSpeaking}
                        />
                      )}
                      <div>
                        <h3 className="text-sm font-extrabold text-white line-clamp-1">{s.title}</h3>
                        <p className="text-xs text-slate-300 mt-0.5">
                          {s.host_name} · المستوى {s.host_level}
                        </p>
                      </div>
                    </div>

                    {/* Bottom Info */}
                    <div className="relative z-10 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-300">
                      <span>🎙️ {occupiedSeatsCount}/4 مقاعد</span>
                      <span className="text-amber-300 font-mono-num font-bold">
                        ⚡ {s.support_bar.toLocaleString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>

        {/* Start Live Modal */}
        {showStartModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <form
              onSubmit={handleStartLive}
              className="bg-slate-900 border border-white/15 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl"
            >
              <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                <Radio className="w-5 h-5 text-rose-500" />
                <span>بدء بث مباشر جديد (TikTok LIVE Style)</span>
              </h3>
              <div>
                <label className="block text-xs text-slate-400 mb-1">عنوان البث المباشر</label>
                <input
                  type="text"
                  required
                  value={newLiveTitle}
                  onChange={(e) => setNewLiveTitle(e.target.value)}
                  placeholder="مثال: سهرة وتحديات PK مباشرة 🔥"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">تصنيف البث</label>
                <select
                  value={newLiveTopic}
                  onChange={(e) => setNewLiveTopic(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-xs text-white"
                >
                  <option value="بث مباشر وتحديات PK">بث مباشر وتحديات PK</option>
                  <option value="سوالف وتحديات صوتية">سوالف وتحديات صوتية</option>
                  <option value="مسابقات وجولات حماسية">مسابقات وجولات حماسية</option>
                  <option value="مواهب وطرب مباشر">مواهب وطرب مباشر</option>
                </select>
              </div>
              <label className="flex items-center gap-2.5 p-3 rounded-2xl bg-slate-950 border border-white/10 cursor-pointer text-xs text-slate-200">
                <input
                  type="checkbox"
                  checked={startWithCamera}
                  onChange={(e) => setStartWithCamera(e.target.checked)}
                  className="rounded accent-rose-500"
                />
                <span>تشغيل الكاميرا بملء الشاشة العمودية فور بدء البث (اختياري)</span>
              </label>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white text-xs font-extrabold cursor-pointer"
                >
                  انطلاق البث المباشر الآن
                </button>
                <button
                  type="button"
                  onClick={() => setShowStartModal(false)}
                  className="px-4 py-3 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  // ==========================================================================
  // VIEW 2: FULL-SCREEN VERTICAL TIKTOK LIVE & 50/50 SPLIT-SCREEN PK BATTLE
  // ==========================================================================
  const isHost = activeLive.host_id === user?.id;
  const mySeat = seats.find((s) => s.userId === user?.id);
  const myPendingGuestRequest = guestRequests.find((r) => r.userId === user?.id);
  const hostSeat = seats.find((s) => s.seatIndex === 0);
  const guestSeats = seats.slice(1, 4);
  const occupiedGuestSeats = guestSeats.filter((s) => Boolean(s.userId));

  const isPkBattleActive =
    activeLive.battle_status === 'Active' ||
    activeLive.battle_status === 'Ending' ||
    activeLive.battle_status === 'Finished';

  const hostScore = Number(activeLive.battle_host_score) || 0;
  const opponentScore = Number(activeLive.battle_opponent_score) || 0;
  const totalPkScore = hostScore + opponentScore;
  const hostPercent =
    totalPkScore > 0 ? Math.max(8, Math.min(92, Math.round((hostScore / totalPkScore) * 100))) : 50;

  // Determine video streams for Host and PK Opponent
  const hostVideoStream =
    activeLive.host_id === user?.id && cameraActive && localVideoStream
      ? localVideoStream
      : remoteVideoStreams[activeLive.host_id] || null;

  const opponentVideoStream =
    activeLive.battle_opponent_id === user?.id && cameraActive && localVideoStream
      ? localVideoStream
      : activeLive.battle_opponent_id
      ? remoteVideoStreams[activeLive.battle_opponent_id] || null
      : null;

  const isHostWinner =
    activeLive.battle_status === 'Finished' && activeLive.battle_winner_id === activeLive.host_id;
  const isOpponentWinner =
    activeLive.battle_status === 'Finished' &&
    Boolean(activeLive.battle_opponent_id) &&
    activeLive.battle_winner_id === activeLive.battle_opponent_id;
  const isBattleDraw =
    activeLive.battle_status === 'Finished' && activeLive.battle_winner_id === 'draw';

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="h-screen w-full bg-black text-white overflow-hidden relative flex items-center justify-center select-none"
    >
      {/* Ambient Blurred Desktop Background */}
      <div className="hidden md:block absolute inset-0 bg-gradient-to-br from-slate-950 via-[#090B14] to-black pointer-events-none" />

      {/* Main 9:16 Full-Screen Vertical Container (100% width on Mobile, sleek vertical frame on Desktop) */}
      <div className="relative w-full md:max-w-[500px] lg:max-w-[540px] h-screen bg-[#080A12] md:border-x md:border-white/15 overflow-hidden flex flex-col justify-between shadow-2xl">
        {/* ================================================================
            BACKGROUND LAYER: FULLSCREEN CAMERA OR 50/50 PK SPLIT SCREEN
            ================================================================ */}
        {!isPkBattleActive ? (
          /* NORMAL LIVE MODE: FULL-SCREEN VERTICAL VIDEO (object-cover) OR AVATAR STAGE */
          <div
            onClick={handleTap}
            className="absolute inset-0 z-0 overflow-hidden cursor-pointer"
          >
            {hostVideoStream ? (
              <FullscreenVideoFeed
                stream={hostVideoStream}
                isLocal={activeLive.host_id === user?.id}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-b from-indigo-950/80 via-[#0B0E1A] to-black flex flex-col items-center justify-center p-6 relative">
                {/* Animated Audio Pulse Rings */}
                <div className="relative flex items-center justify-center">
                  {(hostSeat?.isSpeaking || (isHost && micVolumeLevel > 10)) && (
                    <>
                      <div className="absolute -inset-6 rounded-full border-2 border-rose-500/40 animate-ping" />
                      <div className="absolute -inset-3 rounded-full border border-indigo-400/50 animate-pulse" />
                    </>
                  )}
                  <AvatarWithFrame
                    avatarUrl={activeLive.host_avatar}
                    displayName={activeLive.host_name}
                    gender={activeLive.host_gender}
                    activeFrame={activeLive.host_frame}
                    size="xl"
                    isSpeaking={Boolean(hostSeat?.isSpeaking)}
                    onClick={() => onOpenProfile(activeLive.host_id)}
                  />
                </div>
                <h2 className="mt-4 text-base font-extrabold text-white">{activeLive.host_name}</h2>
                <p className="text-xs text-slate-300 mt-1">{activeLive.title}</p>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-emerald-300 font-mono-num">
                  <span>
                    {hostSeat?.isMuted
                      ? '🔇 الميكروفون مكتوم'
                      : hostSeat?.isSpeaking
                      ? '🎙️ يتحدث الآن مباشرة'
                      : '🎧 البث المباشر متصل'}
                  </span>
                  <span>·</span>
                  <span>⚡ {activeLive.support_bar.toLocaleString()}</span>
                </div>
              </div>
            )}
            {/* Top & Bottom Contrast Scrims for Legibility */}
            <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 via-black/35 to-transparent pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none" />
          </div>
        ) : (
          /* ================================================================
             PK BATTLE MODE: TIKTOK 50/50 SPLIT SCREEN + 2-COLOR POWER BAR
             ================================================================ */
          <div className="absolute inset-0 z-0 flex flex-col bg-[#06070C]">
            {/* Spacer for Top Floating Header */}
            <div className="h-16 shrink-0" />

            {/* 1. DYNAMIC 2-COLOR PK POWER BAR (Blue for Host on Right, Red for Opponent on Left) */}
            <div className="px-2.5 pt-1 pb-1.5 shrink-0 z-20">
              <div className="relative w-full h-6 rounded-full overflow-hidden flex border border-white/25 shadow-lg bg-rose-600">
                {/* Right Half (RTL Start): Host Blue Bar */}
                <div
                  className="h-full bg-gradient-to-l from-sky-400 via-blue-600 to-indigo-600 transition-all duration-300 flex items-center justify-start pr-3 relative"
                  style={{ width: `${hostPercent}%` }}
                >
                  <span className="text-xs font-black text-white font-mono-num drop-shadow whitespace-nowrap">
                    {hostScore.toLocaleString()}
                  </span>
                  {/* Glowing Collision Spark at the boundary */}
                  <div className="absolute left-0 top-0 bottom-0 w-2 bg-white shadow-[0_0_12px_4px_rgba(255,255,255,0.95)] animate-pulse" />
                </div>

                {/* Left Half (RTL End): Opponent Red Bar */}
                <div className="flex-1 h-full bg-gradient-to-r from-rose-600 via-red-500 to-pink-600 flex items-center justify-end pl-3">
                  <span className="text-xs font-black text-white font-mono-num drop-shadow whitespace-nowrap">
                    {opponentScore.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* 2. SPLIT SCREEN 50/50 VIDEO CONTAINER (Right 50% Host, Left 50% Opponent) */}
            <div
              onClick={handleTap}
              className="relative w-full h-[52vh] sm:h-[55vh] grid grid-cols-2 border-y border-white/15 overflow-hidden cursor-pointer shrink-0"
            >
              {/* CENTER VS BADGE + 5-MIN COUNTDOWN / 3-MIN PUNISHMENT PHASE TIMER */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-1 pointer-events-auto">
                <div className="px-3.5 py-1 rounded-full bg-black/85 backdrop-blur-md border border-white/25 shadow-xl flex items-center gap-2">
                  <span className="text-xs font-black italic bg-gradient-to-r from-sky-400 via-amber-300 to-rose-400 bg-clip-text text-transparent">
                    PK VS
                  </span>
                  <span className="text-xs font-extrabold font-mono-num text-white">
                    {activeLive.battle_status === 'Finished'
                      ? `حكم: ${formatTimerMmSs(punishmentRemainingSeconds)}`
                      : formatTimerMmSs(remainingSeconds)}
                  </span>
                </div>

                {/* Host Next Round / End PK Controls during Finished (Punishment Phase) */}
                {(isHost || user?.permissions?.can_manage_live) &&
                  activeLive.battle_status === 'Finished' && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1.5 bg-black/80 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/15"
                    >
                      <button
                        type="button"
                        onClick={handleNextBattleRound}
                        className="px-2.5 py-0.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-extrabold cursor-pointer"
                      >
                        جولة جديدة #{(activeLive.battle_round || 1) + 1}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          apiFetch(`/api/live/${activeLive.id}/battle/reset`, { method: 'POST' })
                        }
                        className="px-2 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 text-rose-300 text-[10px] font-bold cursor-pointer"
                      >
                        إنهاء PK
                      </button>
                    </div>
                  )}
              </div>

              {/* RIGHT HALF (50%): HOST */}
              <div className="relative w-full h-full border-l border-white/15 overflow-hidden bg-slate-950">
                {hostVideoStream ? (
                  <FullscreenVideoFeed
                    stream={hostVideoStream}
                    isLocal={activeLive.host_id === user?.id}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-b from-sky-950/70 via-slate-950 to-black flex flex-col items-center justify-center p-3">
                    <AvatarWithFrame
                      avatarUrl={activeLive.host_avatar}
                      displayName={activeLive.host_name}
                      gender={activeLive.host_gender}
                      activeFrame={activeLive.host_frame}
                      size="lg"
                      isSpeaking={Boolean(hostSeat?.isSpeaking)}
                    />
                    <span className="mt-2 text-xs font-extrabold text-white truncate max-w-[130px]">
                      {activeLive.host_name}
                    </span>
                  </div>
                )}

                {/* WIN / LOSE / DRAW Badge on Host Half */}
                {activeLive.battle_status === 'Finished' && (
                  <div className="absolute top-12 right-3 z-20">
                    {isHostWinner ? (
                      <div className="px-3 py-1 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 font-black text-xs shadow-lg flex items-center gap-1 animate-bounce">
                        <Crown className="w-3.5 h-3.5" />
                        <span>WIN · فوز</span>
                      </div>
                    ) : isBattleDraw ? (
                      <div className="px-3 py-1 rounded-xl bg-slate-800/90 text-amber-300 font-black text-xs border border-amber-400/40">
                        DRAW · تعادل
                      </div>
                    ) : (
                      <div className="px-3 py-1 rounded-xl bg-rose-950/90 text-rose-300 font-black text-xs border border-rose-500/40">
                        LOSE · حكم الجولة
                      </div>
                    )}
                  </div>
                )}

                {/* Host Name Tag + Top 3 MVP Contributors at Bottom of Right Half */}
                <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-sky-300 truncate">{activeLive.host_name}</span>
                    <span className="text-[10px] text-slate-300">
                      {hostSeat?.isMuted ? '🔇' : hostSeat?.isSpeaking ? '🎙️' : '🎧'}
                    </span>
                  </div>
                  {/* Top 3 MVP Contributors for Host */}
                  <div className="flex items-center gap-1.5">
                    {[0, 1, 2].map((idx) => {
                      const mvp = hostMvp[idx];
                      return mvp ? (
                        <div
                          key={mvp.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenProfile(mvp.id);
                          }}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-sky-500/20 border border-sky-400/40 text-[10px]"
                          title={`${mvp.display_name}: ${mvp.total_power}`}
                        >
                          <span className="text-amber-300 font-extrabold">#{idx + 1}</span>
                          <span className="truncate max-w-[46px] text-white font-bold">
                            {mvp.display_name}
                          </span>
                        </div>
                      ) : (
                        <div
                          key={idx}
                          className="w-6 h-6 rounded-full bg-white/10 border border-dashed border-white/20 flex items-center justify-center text-[9px] text-slate-400 font-mono-num"
                        >
                          {idx + 1}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* LEFT HALF (50%): OPPONENT LIVE STREAM HOST */}
              <div className="relative w-full h-full overflow-hidden bg-slate-950">
                {opponentVideoStream ? (
                  <FullscreenVideoFeed
                    stream={opponentVideoStream}
                    isLocal={activeLive.battle_opponent_id === user?.id}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-b from-rose-950/70 via-slate-950 to-black flex flex-col items-center justify-center p-3">
                    <AvatarWithFrame
                      avatarUrl={activeLive.battle_opponent_avatar || ''}
                      displayName={activeLive.battle_opponent_name || 'المنافس'}
                      gender="male"
                      size="lg"
                      isSpeaking={
                        Boolean(activeLive.battle_opponent_id) &&
                        remoteAudioPeerIds.includes(activeLive.battle_opponent_id)
                      }
                      onClick={() =>
                        activeLive.battle_opponent_id &&
                        onOpenProfile(activeLive.battle_opponent_id)
                      }
                    />
                    <span className="mt-2 text-xs font-extrabold text-white truncate max-w-[130px]">
                      {activeLive.battle_opponent_name}
                    </span>
                  </div>
                )}

                {/* WIN / LOSE / DRAW Badge on Opponent Half */}
                {activeLive.battle_status === 'Finished' && (
                  <div className="absolute top-12 left-3 z-20">
                    {isOpponentWinner ? (
                      <div className="px-3 py-1 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 font-black text-xs shadow-lg flex items-center gap-1 animate-bounce">
                        <Crown className="w-3.5 h-3.5" />
                        <span>WIN · فوز</span>
                      </div>
                    ) : isBattleDraw ? (
                      <div className="px-3 py-1 rounded-xl bg-slate-800/90 text-amber-300 font-black text-xs border border-amber-400/40">
                        DRAW · تعادل
                      </div>
                    ) : (
                      <div className="px-3 py-1 rounded-xl bg-rose-950/90 text-rose-300 font-black text-xs border border-rose-500/40">
                        LOSE · حكم الجولة
                      </div>
                    )}
                  </div>
                )}

                {/* Opponent Name Tag + Top 3 MVP Contributors at Bottom of Left Half */}
                <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-rose-300 truncate">
                      {activeLive.battle_opponent_name}
                    </span>
                    <span className="text-[10px] text-emerald-300">
                      {activeLive.battle_opponent_id &&
                      remoteAudioPeerIds.includes(activeLive.battle_opponent_id)
                        ? '🔊 متصل'
                        : '⚔️ PK'}
                    </span>
                  </div>
                  {/* Top 3 MVP Contributors for Opponent */}
                  <div className="flex items-center gap-1.5">
                    {[0, 1, 2].map((idx) => {
                      const mvp = opponentMvp[idx];
                      return mvp ? (
                        <div
                          key={mvp.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenProfile(mvp.id);
                          }}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-500/20 border border-rose-400/40 text-[10px]"
                          title={`${mvp.display_name}: ${mvp.total_power}`}
                        >
                          <span className="text-amber-300 font-extrabold">#{idx + 1}</span>
                          <span className="truncate max-w-[46px] text-white font-bold">
                            {mvp.display_name}
                          </span>
                        </div>
                      ) : (
                        <div
                          key={idx}
                          className="w-6 h-6 rounded-full bg-white/10 border border-dashed border-white/20 flex items-center justify-center text-[9px] text-slate-400 font-mono-num"
                        >
                          {idx + 1}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom space under 50/50 split screen for floating chat & controls */}
            <div className="flex-1 bg-gradient-to-b from-[#090B14] to-black" />
          </div>
        )}

        {/* FLOATING TAP HEARTS LAYER */}
        <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
          {tapParticles.map((p) => (
            <div
              key={p.id}
              style={{ left: `${p.x}%`, bottom: `${p.y}%` }}
              className={`absolute ${p.color} text-3xl animate-bounce drop-shadow-[0_4px_12px_rgba(244,63,94,0.6)]`}
            >
              ❤️
            </div>
          ))}
        </div>

        {/* ================================================================
            FOREGROUND LAYER 1: TIKTOK FLOATING TOP HEADER & BANNERS
            ================================================================ */}
        <div className="relative z-30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            {/* Host Capsule (Right in RTL) */}
            <div className="flex items-center gap-2 bg-black/55 backdrop-blur-md border border-white/15 rounded-full p-1 pr-1.5 pl-3">
              <AvatarWithFrame
                avatarUrl={activeLive.host_avatar}
                displayName={activeLive.host_name}
                gender={activeLive.host_gender}
                activeFrame={activeLive.host_frame}
                size="xs"
                isSpeaking={Boolean(hostSeat?.isSpeaking)}
                onClick={() => onOpenProfile(activeLive.host_id)}
              />
              <div
                onClick={() => onOpenProfile(activeLive.host_id)}
                className="cursor-pointer min-w-0"
              >
                <div className="text-xs font-extrabold text-white truncate max-w-[110px]">
                  {activeLive.host_name}
                </div>
                <div className="text-[10px] text-amber-300 font-mono-num flex items-center gap-1">
                  <Heart className="w-2.5 h-2.5 fill-rose-500 text-rose-500" />
                  <span>{activeLive.support_bar.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Top Supporters Mini Avatars + Viewer Count + Audio Toggle + Swipe + Leave */}
            <div className="flex items-center gap-1.5">
              {/* Top 3 Supporters Bubbles */}
              <div className="hidden sm:flex items-center -space-x-1.5 space-x-reverse">
                {supporters.slice(0, 3).map((sup) => (
                  <div
                    key={sup.id}
                    onClick={() => onOpenProfile(sup.id)}
                    className="cursor-pointer ring-2 ring-amber-400/60 rounded-full"
                    title={`${sup.display_name} (+${sup.total_power})`}
                  >
                    <AvatarWithFrame
                      avatarUrl={sup.avatar_url}
                      displayName={sup.display_name}
                      gender={sup.gender}
                      size="xs"
                    />
                  </div>
                ))}
              </div>

              {/* Viewer Count Pill */}
              <div className="px-2.5 py-1.5 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-[11px] font-bold font-mono-num flex items-center gap-1">
                <Eye className="w-3.5 h-3.5 text-rose-400" />
                <span>{viewerCount}</span>
              </div>

              {/* Vertical Stream Switcher Buttons */}
              {streams.length > 1 && (
                <div className="flex items-center bg-black/55 backdrop-blur-md border border-white/15 rounded-full p-0.5">
                  <button
                    type="button"
                    onClick={() => switchLiveStreamByOffset(-1)}
                    className="p-1 text-slate-200 hover:text-white cursor-pointer"
                    title="البث السابق"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => switchLiveStreamByOffset(1)}
                    className="p-1 text-slate-200 hover:text-white cursor-pointer"
                    title="البث التالي"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Speaker Audio Mute/Unmute */}
              <button
                type="button"
                onClick={() => {
                  const next = !isListening;
                  setIsListening(next);
                  if (next) unlockAudioPlayback();
                }}
                className="p-2 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-white cursor-pointer"
                title={isListening ? 'كتم السماعة' : 'تشغيل السماعة'}
              >
                {isListening ? (
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <VolumeX className="w-4 h-4 text-rose-400" />
                )}
              </button>

              {/* Leave / End Stream Button */}
              {isHost ? (
                <button
                  type="button"
                  onClick={handleEndLive}
                  className="px-3 py-1.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-extrabold cursor-pointer"
                >
                  إنهاء
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setActiveLive(null);
                    setSeats([]);
                    loadStreams();
                  }}
                  className="p-2 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-slate-200 hover:text-white cursor-pointer"
                  title="مغادرة البث"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Browser Autoplay Gesture Unlock Banner */}
          {autoplayBlocked && (
            <button
              type="button"
              onClick={unlockAudioPlayback}
              className="w-full py-2 px-4 rounded-2xl bg-emerald-500 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-2 shadow-lg animate-pulse cursor-pointer"
            >
              <Volume2 className="w-4 h-4" />
              <span>🔊 اضغط هنا لتفعيل سماع صوت البث المباشر</span>
            </button>
          )}

          {/* Waiting for PK Opponent Acceptance Banner */}
          {activeLive.battle_status === 'Waiting' && (
            <div className="px-3.5 py-2 rounded-2xl bg-black/75 backdrop-blur-md border border-amber-400/40 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-amber-200 font-bold truncate">
                <Swords className="w-4 h-4 text-amber-400 animate-pulse shrink-0" />
                <span className="truncate">
                  ⏳ بانتظار قبول المضيف {activeLive.battle_opponent_name} لجولة PK ({remainingSeconds}s)
                </span>
              </div>
              {(isHost || user?.permissions?.can_manage_live) && (
                <button
                  type="button"
                  onClick={() =>
                    apiFetch(`/api/live/${activeLive.id}/battle/reset`, { method: 'POST' })
                  }
                  className="px-2.5 py-1 rounded-xl bg-rose-600/30 text-rose-200 text-[10px] font-bold shrink-0 cursor-pointer"
                >
                  إلغاء
                </button>
              )}
            </div>
          )}

          {/* Incoming PK Battle Invitation Modal Banner for Active Host */}
          {(pendingBattleInvite ||
            (activeLive.battle_status === 'Waiting' &&
              activeLive.battle_opponent_id === user?.id &&
              !activeLive.battle_opponent_accepted)) && (
            <div className="p-3 rounded-2xl bg-gradient-to-r from-sky-900/90 via-slate-900/95 to-rose-900/90 backdrop-blur-md border border-amber-400/50 flex flex-wrap items-center justify-between gap-2 text-xs shadow-xl">
              <div className="flex items-center gap-2 font-bold text-white">
                <Swords className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  ⚔️ دعاك المضيف{' '}
                  <span className="text-sky-300">
                    {pendingBattleInvite?.hostName || activeLive.host_name}
                  </span>{' '}
                  إلى جولة PK شاشة مقسومة 50/50!
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    handleRespondBattleInvite(
                      pendingBattleInvite?.liveId || activeLive.id,
                      'accept'
                    )
                  }
                  className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold cursor-pointer"
                >
                  قبول PK
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleRespondBattleInvite(
                      pendingBattleInvite?.liveId || activeLive.id,
                      'decline'
                    )
                  }
                  className="px-2.5 py-1 rounded-xl bg-slate-800 text-slate-300 font-bold cursor-pointer"
                >
                  رفض
                </button>
              </div>
            </div>
          )}

          {/* Incoming Guest Seat Invite from Host */}
          {pendingSeatInvite && (
            <div className="p-2.5 rounded-2xl bg-indigo-950/90 backdrop-blur-md border border-indigo-400/40 flex items-center justify-between gap-2 text-xs">
              <span className="font-bold text-indigo-100">
                🎙️ دعاك المضيف ({pendingSeatInvite.hostName}) للانضمام كضيف على المقعد #{pendingSeatInvite.seatIndex}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    unlockAudioPlayback();
                    setAutoStartMic(true);
                    socket?.emit('live:seat:action', {
                      liveId: activeLive.id,
                      seatIndex: pendingSeatInvite.seatIndex,
                      action: 'join'
                    });
                    setPendingSeatInvite(null);
                  }}
                  className="px-3 py-1 rounded-xl bg-emerald-600 text-white font-bold cursor-pointer"
                >
                  قبول
                </button>
                <button
                  type="button"
                  onClick={() => setPendingSeatInvite(null)}
                  className="px-2.5 py-1 rounded-xl bg-slate-800 text-slate-300 font-bold cursor-pointer"
                >
                  رفض
                </button>
              </div>
            </div>
          )}

          {/* Mic or Camera Error Notice */}
          {(micError || cameraError) && (
            <div className="px-3 py-2 rounded-2xl bg-rose-950/85 border border-rose-500/40 text-rose-200 text-[11px] flex items-center justify-between gap-2">
              <span>{micError || cameraError}</span>
              {micError && mySeat && (
                <button
                  type="button"
                  onClick={startMicrophone}
                  className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-bold shrink-0 cursor-pointer"
                >
                  تفعيل الميكروفون
                </button>
              )}
            </div>
          )}
        </div>

        {/* ================================================================
            FLOATING MULTI-GUEST PIP WINDOWS (Left Side of Vertical Screen)
            ================================================================ */}
        {occupiedGuestSeats.length > 0 && (
          <div className="absolute left-3 top-28 z-20 flex flex-col gap-2">
            {occupiedGuestSeats.map((seat) => {
              const guestVideoStream =
                seat.userId === user?.id && cameraActive && localVideoStream
                  ? localVideoStream
                  : seat.userId && remoteVideoStreams[seat.userId]
                  ? remoteVideoStreams[seat.userId]
                  : null;

              return (
                <div
                  key={seat.seatIndex}
                  className="w-24 h-32 sm:w-28 sm:h-36 rounded-2xl bg-black/70 backdrop-blur-md border border-white/20 shadow-xl overflow-hidden relative flex flex-col items-center justify-center"
                >
                  {guestVideoStream ? (
                    <FullscreenVideoFeed
                      stream={guestVideoStream}
                      isLocal={seat.userId === user?.id}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <AvatarWithFrame
                      avatarUrl={seat.avatarUrl}
                      displayName={seat.displayName}
                      gender={seat.gender}
                      activeFrame={seat.activeFrame}
                      size="sm"
                      isSpeaking={seat.isSpeaking}
                      onClick={() => seat.userId && onOpenProfile(seat.userId)}
                    />
                  )}

                  {/* Guest Name & Status Overlay */}
                  <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-between text-[10px]">
                    <span className="font-bold text-white truncate max-w-[60px]">
                      {seat.displayName}
                    </span>
                    <span>{seat.isMuted ? '🔇' : seat.isSpeaking ? '🎙️' : '🎧'}</span>
                  </div>

                  {/* Host Moderation Controls on Guest Window */}
                  {(isHost || user?.permissions?.can_manage_live) && (
                    <div className="absolute top-1 left-1 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          socket?.emit('live:seat:action', {
                            liveId: activeLive.id,
                            seatIndex: seat.seatIndex,
                            action: 'force_mute'
                          })
                        }
                        className="p-1 rounded-md bg-black/60 text-amber-300 hover:bg-black cursor-pointer"
                        title="كتم الضيف"
                      >
                        <MicOff className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          socket?.emit('live:seat:action', {
                            liveId: activeLive.id,
                            seatIndex: seat.seatIndex,
                            action: 'kick'
                          })
                        }
                        className="p-1 rounded-md bg-rose-600/80 text-white hover:bg-rose-600 cursor-pointer"
                        title="إنزال الضيف"
                      >
                        <UserMinus className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ================================================================
            FOREGROUND LAYER 2: BOTTOM FLOATING GIFT BANNER, CHAT & CONTROLS
            ================================================================ */}
        <div className="relative z-30 p-3 space-y-2.5 mt-auto">
          {/* Floating Gift Notification Banner */}
          {activeGiftBanner && (
            <div className="inline-flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-gradient-to-r from-amber-500/90 via-rose-600/90 to-purple-700/90 backdrop-blur-md border border-amber-300/50 shadow-2xl animate-bounce">
              <span className="text-2xl">{activeGiftBanner.giftEmoji}</span>
              <div className="text-xs">
                <div className="font-extrabold text-white">
                  {activeGiftBanner.senderName}{' '}
                  <span className="text-amber-200 font-normal">أهدى</span>{' '}
                  {activeGiftBanner.receiverName}
                </div>
                <div className="text-[10px] font-bold text-amber-100">
                  {activeGiftBanner.giftName} (+{activeGiftBanner.barPower} Power)
                </div>
              </div>
            </div>
          )}

          {/* Transparent Floating Bottom-Right/Left Live Chat Overlay */}
          <div
            className="w-[78%] sm:w-[74%] max-h-[24vh] overflow-y-auto space-y-1.5 pr-1"
            style={{
              maskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 100%)',
              WebkitMaskImage:
                'linear-gradient(to bottom, transparent 0%, black 18%, black 100%)'
            }}
          >
            {chatEvents.map((ev) => (
              <div
                key={ev.id}
                className={`px-3 py-1.5 rounded-2xl text-xs flex items-center justify-between gap-2 backdrop-blur-sm ${
                  ev.type === 'gift'
                    ? 'bg-amber-500/25 border border-amber-400/40 text-amber-100'
                    : ev.type === 'system'
                    ? 'bg-indigo-600/25 border border-indigo-400/30 text-indigo-100'
                    : ev.type === 'join'
                    ? 'bg-black/35 text-slate-300'
                    : 'bg-black/45 text-white'
                }`}
              >
                <div className="min-w-0 flex-1 leading-snug">
                  <span
                    onClick={() => ev.userId && ev.userId !== 'system' && onOpenProfile(ev.userId)}
                    className="font-extrabold text-amber-300 ml-1.5 cursor-pointer hover:underline"
                  >
                    {ev.displayName}:
                  </span>
                  <span className="break-words">{ev.content}</span>
                  {ev.giftEmoji && (
                    <span className="mr-1 font-extrabold text-amber-200">
                      {ev.giftEmoji} +{ev.giftPower}
                    </span>
                  )}
                </div>

                {/* Host can invite a viewer from chat to an open Guest Seat (NEVER to a PK Battle) */}
                {isHost && ev.userId && ev.userId !== 'system' && ev.userId !== user?.id && (
                  <button
                    type="button"
                    onClick={() => {
                      const emptySeat = seats.find((s) => s.seatIndex > 0 && !s.userId);
                      if (!emptySeat) {
                        addToast('جميع مقاعد الضيوف (3 ضيوف) ممتلئة حالياً', 'error');
                        return;
                      }
                      socket?.emit('live:seat:action', {
                        liveId: activeLive.id,
                        seatIndex: emptySeat.seatIndex,
                        action: 'invite',
                        targetUserId: ev.userId
                      });
                      addToast(`تم إرسال دعوة انضمام كضيف إلى ${ev.displayName}`, 'success');
                    }}
                    className="px-2 py-0.5 rounded-full bg-white/15 hover:bg-white/25 text-[10px] font-bold text-white shrink-0 cursor-pointer"
                  >
                    + ضيف
                  </button>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* PK Support Side Selector (Blue for Host vs Red for Opponent during PK Battle) */}
          {isPkBattleActive && (
            <div className="flex items-center justify-between gap-2 bg-black/65 backdrop-blur-md border border-white/15 rounded-2xl p-1.5 text-xs">
              <span className="text-[11px] text-slate-300 pr-2 font-bold">توجيه الدعم والهدايا:</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSupportTargetSide('host')}
                  className={`px-3 py-1 rounded-xl font-extrabold text-[11px] cursor-pointer transition-all ${
                    supportTargetSide === 'host'
                      ? 'bg-sky-600 text-white shadow-md shadow-sky-600/40'
                      : 'bg-slate-900 text-slate-400'
                  }`}
                >
                  🛡️ {activeLive.host_name}
                </button>
                <button
                  type="button"
                  onClick={() => setSupportTargetSide('opponent')}
                  className={`px-3 py-1 rounded-xl font-extrabold text-[11px] cursor-pointer transition-all ${
                    supportTargetSide === 'opponent'
                      ? 'bg-rose-600 text-white shadow-md shadow-rose-600/40'
                      : 'bg-slate-900 text-slate-400'
                  }`}
                >
                  ⚔️ {activeLive.battle_opponent_name}
                </button>
              </div>
            </div>
          )}

          {/* Bottom Action Bar: Comment Input + Mic/Cam/Guest/PK Controls + Gift + Heart Tap */}
          <div className="flex items-center gap-2">
            {/* Chat Input Pill */}
            <form onSubmit={handleSendLiveChat} className="flex-1 flex items-center relative">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="إضافة تعليق..."
                className="w-full pl-9 pr-3.5 py-2.5 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:border-white/40"
              />
              <button
                type="submit"
                className="absolute left-2 p-1.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>

            {/* Seated Speaker (Host or Guest) Mic & Camera Controls */}
            {mySeat && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (!micActive) {
                      startMicrophone();
                    } else {
                      socket?.emit('live:seat:action', {
                        liveId: activeLive.id,
                        seatIndex: mySeat.seatIndex,
                        action: 'toggle_mute'
                      });
                    }
                  }}
                  className={`p-2.5 rounded-full border cursor-pointer ${
                    !micActive || mySeat.isMuted
                      ? 'bg-rose-600/90 border-rose-400 text-white'
                      : 'bg-emerald-600/90 border-emerald-400 text-white'
                  }`}
                  title={mySeat.isMuted ? 'إلغاء كتم الميكروفون' : 'كتم الميكروفون'}
                >
                  {!micActive || mySeat.isMuted ? (
                    <MicOff className="w-4 h-4" />
                  ) : (
                    <Mic className="w-4 h-4" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={toggleCamera}
                  className={`p-2.5 rounded-full border cursor-pointer ${
                    cameraActive
                      ? 'bg-indigo-600/90 border-indigo-400 text-white'
                      : 'bg-black/60 border-white/20 text-slate-200'
                  }`}
                  title={cameraActive ? 'إيقاف الكاميرا' : 'تشغيل الكاميرا'}
                >
                  {cameraActive ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                </button>

                {mySeat.seatIndex !== 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      socket?.emit('live:seat:action', {
                        liveId: activeLive.id,
                        seatIndex: mySeat.seatIndex,
                        action: 'leave'
                      })
                    }
                    className="px-2.5 py-2 rounded-full bg-slate-800/90 border border-white/20 text-rose-300 text-[10px] font-bold cursor-pointer whitespace-nowrap"
                    title="مغادرة مقعد الضيف"
                  >
                    نزول
                  </button>
                )}
              </>
            )}

            {/* VIEWER ONLY: "Request to Join as Guest" (طلب انضمام كضيف) */}
            {!isHost && !mySeat && (
              <button
                type="button"
                onClick={() => {
                  if (myPendingGuestRequest) {
                    socket?.emit('live:guest:cancel', { liveId: activeLive.id });
                    addToast('تم إلغاء طلب الانضمام كضيف.', 'info');
                  } else {
                    setShowJoinRequestModal(true);
                  }
                }}
                className={`px-3 py-2.5 rounded-full border text-xs font-extrabold flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  myPendingGuestRequest
                    ? 'bg-amber-500/25 border-amber-400 text-amber-200'
                    : 'bg-black/65 backdrop-blur-md border-white/20 hover:bg-white/15 text-white'
                }`}
                title="طلب انضمام كضيف في المقاعد"
              >
                <UserPlus className="w-4 h-4 text-indigo-400" />
                <span>{myPendingGuestRequest ? 'تم الطلب ⏳' : 'طلب قسط'}</span>
              </button>
            )}

            {/* HOST ONLY: Guest Requests Drawer & PK Battle Invite Button */}
            {(isHost || user?.permissions?.can_manage_live) && (
              <>
                <button
                  type="button"
                  onClick={() => setShowGuestDrawer(true)}
                  className="relative p-2.5 rounded-full bg-black/65 backdrop-blur-md border border-white/20 text-white cursor-pointer"
                  title="إدارة مقاعد الضيوف وطلبات الانضمام"
                >
                  <Users className="w-4 h-4 text-indigo-400" />
                  {guestRequests.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white text-[10px] font-black flex items-center justify-center">
                      {guestRequests.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    loadEligibleOpponents(activeLive.id);
                    setShowBattleModal(true);
                  }}
                  className="px-3 py-2.5 rounded-full bg-gradient-to-r from-sky-500 via-indigo-600 to-rose-600 text-white text-xs font-black flex items-center gap-1 shadow-lg cursor-pointer whitespace-nowrap"
                  title="تحدي مضيف آخر في جولة PK 50/50"
                >
                  <Swords className="w-4 h-4" />
                  <span>PK</span>
                </button>
              </>
            )}

            {/* Gift Box Button */}
            <button
              type="button"
              onClick={() => setShowGiftModal(true)}
              className="p-2.5 rounded-full bg-gradient-to-br from-amber-400 to-yellow-600 text-slate-950 shadow-lg shadow-amber-500/30 cursor-pointer"
              title="إرسال هدية"
            >
              <Gift className="w-4 h-4" />
            </button>

            {/* Tap / Like Heart Button */}
            <button
              type="button"
              onClick={handleTap}
              className="p-2.5 rounded-full bg-gradient-to-br from-rose-500 to-pink-600 active:scale-90 transition-transform text-white shadow-lg shadow-rose-600/40 cursor-pointer"
              title={`نقر دعم البث (${localTapCount})`}
            >
              <Heart className="w-4 h-4 fill-white" />
            </button>
          </div>
        </div>
      </div>

      {/* ====================================================================
          MODAL 1: VIEWER "REQUEST TO JOIN AS GUEST SPEAKER" (طلب انضمام كضيف)
          ==================================================================== */}
      {showJoinRequestModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/15 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-indigo-400" />
                <span>طلب انضمام كضيف في البث</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowJoinRequestModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              يمكنك الانضمام كضيف متحدث مع المضيف في أحد المقاعد الثلاثة المخصصة للضيوف (صوت فقط أو صوت وكاميرا).
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  unlockAudioPlayback();
                  socket?.emit('live:guest:request', {
                    liveId: activeLive.id,
                    withCamera: false
                  });
                  setShowJoinRequestModal(false);
                  addToast('تم إرسال طلب انضمام كضيف صوتي إلى المضيف! 🎙️', 'success');
                }}
                className="p-3.5 rounded-2xl bg-slate-950 hover:bg-indigo-950/60 border border-white/10 hover:border-indigo-500/50 flex flex-col items-center gap-2 text-xs font-bold text-white cursor-pointer"
              >
                <Mic className="w-5 h-5 text-emerald-400" />
                <span>انضمام صوتي فقط</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  unlockAudioPlayback();
                  socket?.emit('live:guest:request', {
                    liveId: activeLive.id,
                    withCamera: true
                  });
                  setShowJoinRequestModal(false);
                  addToast('تم إرسال طلب انضمام كضيف بالكاميرا والصوت إلى المضيف! 🎥', 'success');
                }}
                className="p-3.5 rounded-2xl bg-slate-950 hover:bg-indigo-950/60 border border-white/10 hover:border-indigo-500/50 flex flex-col items-center gap-2 text-xs font-bold text-white cursor-pointer"
              >
                <Video className="w-5 h-5 text-indigo-400" />
                <span>انضمام بالكاميرا</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL 2: HOST GUEST REQUESTS & SEATS DRAWER
          ==================================================================== */}
      {showGuestDrawer && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/15 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-400" />
                <span>طلبات الانضمام ومقاعد الضيوف (حتى 3 ضيوف)</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowGuestDrawer(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Pending Guest Requests */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-300">
                طلبات المشاهدين للانضمام كضيوف ({guestRequests.length})
              </div>
              {guestRequests.length === 0 ? (
                <div className="p-4 rounded-2xl bg-slate-950 border border-white/10 text-xs text-slate-400 text-center">
                  لا توجد طلبات انضمام معلقة حالياً.
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {guestRequests.map((req) => (
                    <div
                      key={req.userId}
                      className="p-3 rounded-2xl bg-slate-950 border border-white/10 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2.5">
                        <AvatarWithFrame
                          avatarUrl={req.avatarUrl}
                          displayName={req.displayName}
                          gender={req.gender}
                          activeFrame={req.activeFrame}
                          size="xs"
                        />
                        <div>
                          <div className="text-xs font-bold text-white">{req.displayName}</div>
                          <div className="text-[10px] text-slate-400">
                            المستوى {req.level} ·{' '}
                            {req.withCamera ? '🎥 فيديو + صوت' : '🎙️ صوت فقط'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            socket?.emit('live:guest:respond', {
                              liveId: activeLive.id,
                              targetUserId: req.userId,
                              action: 'approve'
                            })
                          }
                          className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                        >
                          قبول
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            socket?.emit('live:guest:respond', {
                              liveId: activeLive.id,
                              targetUserId: req.userId,
                              action: 'reject'
                            })
                          }
                          className="px-2.5 py-1 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold cursor-pointer"
                        >
                          رفض
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Active Guest Seats List */}
            <div className="space-y-2 pt-2 border-t border-white/10">
              <div className="text-xs font-bold text-slate-300">حالة مقاعد الضيوف الحالية</div>
              <div className="grid grid-cols-3 gap-2">
                {guestSeats.map((s) => (
                  <div
                    key={s.seatIndex}
                    className="p-2.5 rounded-2xl bg-slate-950 border border-white/10 text-center space-y-1"
                  >
                    <div className="text-[10px] text-slate-400">مقعد #{s.seatIndex}</div>
                    {s.userId ? (
                      <>
                        <div className="text-xs font-bold text-white truncate">{s.displayName}</div>
                        <button
                          type="button"
                          onClick={() =>
                            socket?.emit('live:seat:action', {
                              liveId: activeLive.id,
                              seatIndex: s.seatIndex,
                              action: 'kick'
                            })
                          }
                          className="px-2 py-0.5 rounded-lg bg-rose-600/20 text-rose-300 text-[10px] font-bold cursor-pointer"
                        >
                          إنزال
                        </button>
                      </>
                    ) : (
                      <div className="text-[11px] text-emerald-400 font-semibold">متاح</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL 3: PK BATTLE INVITATION (ACTIVE LIVE STREAM HOSTS ONLY)
          ==================================================================== */}
      {showBattleModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleStartBattle}
            className="bg-slate-900 border border-white/15 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                <Swords className="w-5 h-5 text-amber-400" />
                <span>تحدي مضيف في جولة PK (50/50)</span>
              </h3>
              <button
                type="button"
                onClick={() => loadEligibleOpponents(activeLive.id)}
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1 cursor-pointer"
                title="تحديث قائمة المضيفين النشطين"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingOpponents ? 'animate-spin' : ''}`} />
                <span>تحديث</span>
              </button>
            </div>

            <div className="p-3 rounded-2xl bg-sky-500/10 border border-sky-400/30 text-[11px] text-sky-200 leading-relaxed">
              ⚔️ نظام TikTok PK الرسمي: جولات التحدي تتم حصرياً بين <strong>مضيفين لديهما بث مباشر نشط حالياً</strong> بشاشة مقسومة 50/50 وشريط طاقة مزدوج.
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">نمط جولة PK</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'Classic', label: 'Classic (PK 50/50)' },
                  { id: 'Box', label: 'Box (صندوق الحظ)' },
                  { id: 'Bear', label: 'Bear (تحدي الدب)' },
                  { id: 'Triple', label: 'Triple (ثلاثية)' }
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setBattleMode(m.id as any)}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border cursor-pointer ${
                      battleMode === m.id
                        ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                        : 'bg-slate-950 border-white/10 text-slate-400'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {loadingOpponents ? (
              <div className="py-6 text-center text-xs text-slate-400">
                جاري البحث عن مضيفين لديهم بث مباشر نشط حالياً...
              </div>
            ) : eligibleOpponents.length === 0 ? (
              <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200 leading-relaxed">
                ⚠️ لا يوجد مضيفون آخرون يبثون مباشرة في هذه اللحظة (`status = active`). جولات PK متاحة فقط بين مستضيفين لديهما بث مباشر نشط، بينما يمكن للمشاهدين داخل بثك الانضمام كضيوف في المقاعد فقط.
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-xs text-slate-400">
                  اختر المضيف المنافس (جميعهم لديهم بث مباشر نشط الآن)
                </label>
                <div className="space-y-2 max-h-44 overflow-y-auto">
                  {eligibleOpponents.map((opp) => {
                    const isSelected = selectedOpponentId === opp.id;
                    return (
                      <div
                        key={opp.id}
                        onClick={() => setSelectedOpponentId(opp.id)}
                        className={`p-3 rounded-2xl border flex items-center justify-between cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-sky-600/20 border-sky-400'
                            : 'bg-slate-950 border-white/10 hover:border-white/25'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <AvatarWithFrame
                            avatarUrl={opp.avatar_url}
                            displayName={opp.display_name}
                            gender={opp.gender}
                            activeFrame={opp.active_frame}
                            size="sm"
                          />
                          <div>
                            <div className="text-xs font-extrabold text-white">
                              {opp.display_name} · المستوى {opp.level}
                            </div>
                            <div className="text-[10px] text-rose-400 font-semibold">
                              🔴 بث نشط: «{opp.live_title}» ({opp.viewer_count} مشاهد)
                            </div>
                          </div>
                        </div>
                        <div
                          className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                            isSelected ? 'border-sky-400 bg-sky-500' : 'border-slate-600'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {battleMode === 'Triple' && eligibleOpponents.length > 1 && (
                  <div className="pt-2">
                    <label className="block text-xs text-slate-400 mb-1">
                      اختر المضيف الثالث (بث مباشر نشط)
                    </label>
                    <select
                      required
                      value={selectedThirdId}
                      onChange={(e) => setSelectedThirdId(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-xs text-white"
                    >
                      <option value="">-- اختر المضيف الثالث --</option>
                      {eligibleOpponents
                        .filter((opp) => opp.id !== selectedOpponentId)
                        .map((opp) => (
                          <option key={opp.id} value={opp.id}>
                            {opp.display_name} — بث نشط: {opp.live_title}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                مدة جولة PK (يتبعها 3 دقائق مرحلة حكم للفائز)
              </label>
              <select
                value={battleDuration}
                onChange={(e) => setBattleDuration(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-xs text-white"
              >
                <option value={300}>5 دقائق (300 ثانية - TikTok PK الرسمي)</option>
                <option value={180}>3 دقائق (180 ثانية)</option>
                <option value={120}>دقيقتان (120 ثانية)</option>
                <option value={60}>دقيقة سريعة (60 ثانية)</option>
              </select>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="submit"
                disabled={
                  eligibleOpponents.length === 0 ||
                  !selectedOpponentId ||
                  (battleMode === 'Triple' && !selectedThirdId)
                }
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-rose-600 hover:from-sky-400 hover:to-rose-500 disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-extrabold cursor-pointer"
              >
                إرسال دعوة تحدي PK للمضيف
              </button>
              <button
                type="button"
                onClick={() => setShowBattleModal(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Send Gift Modal */}
      {showGiftModal && (
        <SendGiftModal
          receiverId={
            isPkBattleActive &&
            supportTargetSide === 'opponent' &&
            activeLive.battle_opponent_id
              ? activeLive.battle_opponent_id
              : isPkBattleActive &&
                supportTargetSide === 'third' &&
                activeLive.battle_third_id
              ? activeLive.battle_third_id
              : activeLive.host_id
          }
          receiverName={
            isPkBattleActive &&
            supportTargetSide === 'opponent' &&
            activeLive.battle_opponent_name
              ? activeLive.battle_opponent_name
              : isPkBattleActive &&
                supportTargetSide === 'third' &&
                activeLive.battle_third_name
              ? activeLive.battle_third_name
              : activeLive.host_name
          }
          contextType="live"
          contextId={activeLive.id}
          battleSide={supportTargetSide}
          onClose={() => setShowGiftModal(false)}
        />
      )}
    </div>
  );
};
