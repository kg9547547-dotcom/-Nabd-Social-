import React, { useEffect, useState, useRef } from 'react';
import {
  X, Send, Image as ImageIcon, Mic, Square, Heart, MessageCircle, Share2,
  Eye, Plus, Trash2, Trophy, ShoppingBag, Coins, Gem, Sparkles, UserPlus,
  UserCheck, Ban, Flag, Gift as GiftIcon, Settings, LogOut, Palette, Lock
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { apiFetch, uploadMediaFile } from '../services/api';
import { AvatarWithFrame } from './AvatarWithFrame';
import { StoreItem, User } from '../types';
import {
  getSoundPreferences,
  saveSoundPreferences,
  playRoomJoinSound,
  SoundPreferences
} from '../services/soundEffects';

// ============================================================================
// 1. PRIVATE MESSAGES & FRIENDS MODAL
// ============================================================================
export const PrivateMessagesModal: React.FC<{
  initialPartnerId?: string | null;
  initialTab?: 'chats' | 'friends';
  onClose: () => void;
  onOpenProfile: (userId: string) => void;
}> = ({ initialPartnerId = null, initialTab = 'chats', onClose, onOpenProfile }) => {
  const { user, socket, addToast, refreshUser } = useApp();
  const [tab, setTab] = useState<'chats' | 'friends'>(initialTab);
  const [conversations, setConversations] = useState<any[]>([]);
  const [activePartnerId, setActivePartnerId] = useState<string | null>(initialPartnerId);
  const [partnerInfo, setPartnerInfo] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [msgText, setMsgText] = useState('');
  const [friendsList, setFriendsList] = useState<any[]>([]);
  const [ignoredList, setIgnoredList] = useState<any[]>([]);
  const [followersList, setFollowersList] = useState<any[]>([]);
  const [followingList, setFollowingList] = useState<any[]>([]);
  const [suggestionsList, setSuggestionsList] = useState<any[]>([]);
  const [socialSubTab, setSocialSubTab] = useState<'followers' | 'following' | 'discover'>('followers');
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadConversations = async () => {
    try {
      const res = await apiFetch<{ conversations: any[] }>('/api/messages/conversations');
      setConversations(res.conversations);
    } catch {
      // ignore
    }
  };

  const loadFriends = async () => {
    try {
      const [resFriends, resFollows] = await Promise.all([
        apiFetch<{ friends: any[]; ignored: any[] }>('/api/friends'),
        apiFetch<{ followers: any[]; following: any[]; suggestions: any[]; ignored: any[] }>('/api/follows')
      ]);
      setFriendsList(resFriends.friends || []);
      setIgnoredList(resFollows.ignored || resFriends.ignored || []);
      setFollowersList(resFollows.followers || []);
      setFollowingList(resFollows.following || []);
      setSuggestionsList(resFollows.suggestions || []);
    } catch {
      // ignore
    }
  };

  const handleToggleFollow = async (targetUserId: string) => {
    try {
      const res = await apiFetch<{ isFollowing: boolean; isMutual?: boolean; message: string }>('/api/follows/toggle', {
        method: 'POST',
        body: JSON.stringify({ targetUserId })
      });
      addToast(res.message, 'success');
      loadFriends();
      refreshUser();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const loadMessages = async (partnerId: string) => {
    try {
      const res = await apiFetch<{ messages: any[]; partner: any }>(`/api/messages/${partnerId}`);
      setMessages(res.messages);
      setPartnerInfo(res.partner);
      refreshUser();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  useEffect(() => {
    loadConversations();
    loadFriends();
  }, []);

  useEffect(() => {
    if (activePartnerId) {
      loadMessages(activePartnerId);
    }
  }, [activePartnerId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!socket) return;
    const handleNewPm = (msg: any) => {
      loadConversations();
      if (
        activePartnerId &&
        (msg.sender_id === activePartnerId || msg.receiver_id === activePartnerId)
      ) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    };
    socket.on('pm:new', handleNewPm);
    return () => {
      socket.off('pm:new', handleNewPm);
    };
  }, [socket, activePartnerId]);

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePartnerId || !msgText.trim()) return;
    const text = msgText.trim();
    setMsgText('');
    try {
      await apiFetch(`/api/messages/${activePartnerId}`, {
        method: 'POST',
        body: JSON.stringify({ content: text, mediaType: 'text' })
      });
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activePartnerId) return;
    try {
      const uploaded = await uploadMediaFile(file);
      const mType = uploaded.mimeType.startsWith('video/')
        ? 'video'
        : uploaded.mimeType.startsWith('audio/')
        ? 'audio'
        : 'image';
      await apiFetch(`/api/messages/${activePartnerId}`, {
        method: 'POST',
        body: JSON.stringify({ content: '', mediaUrl: uploaded.url, mediaType: mType })
      });
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const toggleVoiceRecord = async () => {
    if (!activePartnerId) return;
    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
        try {
          const uploaded = await uploadMediaFile(file);
          await apiFetch(`/api/messages/${activePartnerId}`, {
            method: 'POST',
            body: JSON.stringify({ content: 'رسالة صوتية 🎙️', mediaUrl: uploaded.url, mediaType: 'audio' })
          });
        } catch (err: any) {
          addToast(err.message, 'error');
        }
      };
      mr.start();
      setRecording(true);
    } catch {
      addToast('تعذر الوصول إلى الميكروفون لتسجيل الرسالة الصوتية', 'error');
    }
  };

  const handleFriendRespond = async (requestId: string, action: 'accept' | 'reject') => {
    try {
      await apiFetch('/api/friends/respond', {
        method: 'POST',
        body: JSON.stringify({ requestId, action })
      });
      loadFriends();
      refreshUser();
      addToast(action === 'accept' ? 'تم قبول طلب الصداقة!' : 'تم رفض الطلب', 'success');
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-end">
      <div className="bg-slate-900 border-r border-white/10 w-full max-w-md h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTab('chats');
                setActivePartnerId(null);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                tab === 'chats' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              الرسائل الخاصة
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('friends');
                setActivePartnerId(null);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                tab === 'friends' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              المتابعون والمتابعة ({followersList.length})
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        {tab === 'friends' ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Sub-tabs: المتابعون | أتابعهم | اكتشف ورد المتابعة */}
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-slate-950 border border-white/10 text-xs font-bold">
              <button
                type="button"
                onClick={() => setSocialSubTab('followers')}
                className={`py-2 rounded-xl cursor-pointer transition-colors ${
                  socialSubTab === 'followers' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                المتابعون ({followersList.length})
              </button>
              <button
                type="button"
                onClick={() => setSocialSubTab('following')}
                className={`py-2 rounded-xl cursor-pointer transition-colors ${
                  socialSubTab === 'following' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                أتابعهم ({followingList.length})
              </button>
              <button
                type="button"
                onClick={() => setSocialSubTab('discover')}
                className={`py-2 rounded-xl cursor-pointer transition-colors ${
                  socialSubTab === 'discover' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                اقتراحات
              </button>
            </div>

            {/* Followers Tab (with Follow Back / رد المتابعة button) */}
            {socialSubTab === 'followers' && (
              <div className="space-y-2">
                {followersList.length === 0 ? (
                  <p className="text-xs text-slate-400 py-8 text-center bg-slate-950/40 rounded-2xl border border-white/5">
                    لا يوجد متابعون حتى الآن. شارك في الغرف والبثوث المباشرة لكسب المتابعين!
                  </p>
                ) : (
                  followersList.map((f) => (
                    <div
                      key={f.id}
                      className="p-3 rounded-2xl bg-slate-950/70 border border-white/10 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <AvatarWithFrame
                          avatarUrl={f.avatar_url}
                          displayName={f.display_name}
                          gender={f.gender}
                          activeFrame={f.active_frame}
                          size="sm"
                          showOnline={f.isOnline}
                          onClick={() => onOpenProfile(f.id)}
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">{f.display_name}</div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                            <span>Lv.{f.level}</span>
                            {f.isMutual && (
                              <span className="text-emerald-400 font-bold">· متابعان لبعضكما 🤝</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {!f.isFollowing ? (
                          <button
                            type="button"
                            onClick={() => handleToggleFollow(f.id)}
                            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold cursor-pointer shadow-sm"
                          >
                            رد المتابعة 🤝
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setTab('chats');
                                setActivePartnerId(f.id);
                              }}
                              className="px-2.5 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600 text-indigo-200 hover:text-white text-xs font-bold cursor-pointer"
                            >
                              مراسلة
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleFollow(f.id)}
                              className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-600/30 text-slate-300 hover:text-rose-300 text-[11px] font-bold cursor-pointer"
                            >
                              تتابعه ✓
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Following Tab */}
            {socialSubTab === 'following' && (
              <div className="space-y-2">
                {followingList.length === 0 ? (
                  <p className="text-xs text-slate-400 py-8 text-center bg-slate-950/40 rounded-2xl border border-white/5">
                    أنت لا تتابع أي عضو حالياً. تصفح قسم الاقتراحات أو الغرف لمتابعة الأعضاء!
                  </p>
                ) : (
                  followingList.map((f) => (
                    <div
                      key={f.id}
                      className="p-3 rounded-2xl bg-slate-950/70 border border-white/10 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <AvatarWithFrame
                          avatarUrl={f.avatar_url}
                          displayName={f.display_name}
                          gender={f.gender}
                          activeFrame={f.active_frame}
                          size="sm"
                          showOnline={f.isOnline}
                          onClick={() => onOpenProfile(f.id)}
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">{f.display_name}</div>
                          <div className="text-[10px] text-slate-400">
                            Lv.{f.level} {f.followsMe ? '· يتابعك أيضاً 🤝' : ''}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setTab('chats');
                            setActivePartnerId(f.id);
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600 text-indigo-200 hover:text-white text-xs font-bold cursor-pointer"
                        >
                          مراسلة
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleFollow(f.id)}
                          className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-600/30 text-slate-300 hover:text-rose-300 text-[11px] font-bold cursor-pointer"
                        >
                          إلغاء المتابعة
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Suggestions / Discover Tab */}
            {socialSubTab === 'discover' && (
              <div className="space-y-2">
                {suggestionsList.map((s) => (
                  <div
                    key={s.id}
                    className="p-3 rounded-2xl bg-slate-950/70 border border-white/10 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AvatarWithFrame
                        avatarUrl={s.avatar_url}
                        displayName={s.display_name}
                        gender={s.gender}
                        activeFrame={s.active_frame}
                        size="sm"
                        showOnline={s.isOnline}
                        onClick={() => onOpenProfile(s.id)}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">{s.display_name}</div>
                        <div className="text-[10px] text-slate-400">
                          Lv.{s.level} {s.followsMe ? '· يتابعك (رد المتابعة)' : ''}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleFollow(s.id)}
                      className={`px-3 py-1.5 rounded-xl text-white text-xs font-bold cursor-pointer ${
                        s.followsMe ? 'bg-rose-600 hover:bg-rose-500' : 'bg-indigo-600 hover:bg-indigo-500'
                      }`}
                    >
                      {s.followsMe ? 'رد المتابعة 🤝' : '+ متابعة'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {ignoredList.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-slate-400 mb-3">قائمة التجاهل</h4>
                <div className="space-y-2">
                  {ignoredList.map((ig) => (
                    <div
                      key={ig.ignored_user_id}
                      className="p-2.5 rounded-xl bg-slate-950 border border-white/5 flex items-center justify-between text-xs"
                    >
                      <span className="text-slate-300">{ig.display_name}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch('/api/friends/ignore', {
                            method: 'POST',
                            body: JSON.stringify({ targetUserId: ig.ignored_user_id })
                          });
                          loadFriends();
                        }}
                        className="text-rose-400 hover:underline cursor-pointer"
                      >
                        إلغاء التجاهل
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : !activePartnerId ? (
          /* Conversation List */
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {conversations.length === 0 ? (
              <div className="text-center py-14 text-slate-500 text-xs space-y-2">
                <MessageCircle className="w-8 h-8 mx-auto text-slate-600" />
                <p>لا توجد محادثات خاصة بعد.</p>
                <p>اضغط على أي مستخدم داخل الغرفة لبدء محادثة خاصة فورية.</p>
              </div>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.partnerId}
                  type="button"
                  onClick={() => setActivePartnerId(c.partnerId)}
                  className="w-full p-3 rounded-2xl bg-slate-950/60 hover:bg-slate-800/70 border border-white/5 flex items-center justify-between text-right transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <AvatarWithFrame
                      avatarUrl={c.partnerAvatar}
                      displayName={c.partnerName}
                      gender={c.partnerGender}
                      activeFrame={c.partnerFrame}
                      size="md"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white truncate">{c.partnerName}</div>
                      <div className="text-xs text-slate-400 truncate">{c.lastMessage}</div>
                    </div>
                  </div>
                  {c.unreadCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[11px] font-bold font-mono-num">
                      {c.unreadCount}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        ) : (
          /* Active 1-on-1 Chat View */
          <div className="flex-1 flex flex-col min-h-0">
            {/* Partner Bar */}
            <div className="px-4 py-2.5 bg-slate-950/80 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setActivePartnerId(null)}
                  className="text-xs text-indigo-400 hover:underline ml-2 cursor-pointer"
                >
                  ← رجوع
                </button>
                {partnerInfo && (
                  <div
                    onClick={() => onOpenProfile(partnerInfo.id)}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <AvatarWithFrame
                      avatarUrl={partnerInfo.avatar_url}
                      displayName={partnerInfo.display_name}
                      gender={partnerInfo.gender}
                      size="xs"
                    />
                    <div>
                      <div className="text-xs font-bold text-white">{partnerInfo.display_name}</div>
                      <div className="text-[10px] text-slate-400">{partnerInfo.status_text}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Messages Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((m) => {
                const isMine = m.sender_id === user?.id;
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${isMine ? 'items-start' : 'items-end'}`}
                  >
                    <div
                      className={`max-w-[82%] rounded-2xl p-3 text-xs leading-relaxed ${
                        isMine
                          ? 'bg-indigo-600 text-white rounded-tr-none'
                          : 'bg-slate-800 text-slate-100 rounded-tl-none border border-white/5'
                      }`}
                    >
                      {m.content && <p>{m.content}</p>}
                      {m.media_url && m.media_type === 'image' && (
                        <img
                          src={m.media_url}
                          alt="مرفق"
                          referrerPolicy="no-referrer"
                          className="mt-1.5 rounded-xl max-h-52 object-cover"
                        />
                      )}
                      {m.media_url && m.media_type === 'video' && (
                        <video
                          src={m.media_url}
                          controls
                          className="mt-1.5 rounded-xl max-h-52 w-full"
                        />
                      )}
                      {m.media_url && m.media_type === 'audio' && (
                        <audio src={m.media_url} controls className="mt-1.5 h-8 w-48" />
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 mt-1 font-mono-num">
                      {new Date(m.created_at).toLocaleTimeString('ar-SA', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <form onSubmit={handleSendText} className="p-3 bg-slate-950 border-t border-white/10 flex items-center gap-2">
              <label className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer shrink-0">
                <ImageIcon className="w-4 h-4" />
                <input type="file" accept="image/*,video/*" onChange={handleFileUpload} className="hidden" />
              </label>

              <button
                type="button"
                onClick={toggleVoiceRecord}
                className={`p-2.5 rounded-xl shrink-0 cursor-pointer transition-colors ${
                  recording ? 'bg-rose-600 text-white animate-pulse' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                }`}
                title="تسجيل رسالة صوتية"
              >
                {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              <input
                type="text"
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                placeholder="اكتب رسالتك الخاصة..."
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-900 border border-white/10 text-xs text-white focus:outline-none focus:border-indigo-500"
              />

              <button
                type="submit"
                className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shrink-0 cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 2. STORIES MODAL (24 HOURS EPHEMERAL STORIES)
// ============================================================================
export const StoriesModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { user, addToast } = useApp();
  const [stories, setStories] = useState<any[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [creating, setCreating] = useState(false);
  const [caption, setCaption] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState<'text' | 'image' | 'video'>('text');
  const [viewers, setViewers] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);

  const loadStories = async () => {
    try {
      const res = await apiFetch<{ stories: any[] }>('/api/stories');
      setStories(res.stories);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadStories();
  }, []);

  const currentStory = stories[activeIndex];

  useEffect(() => {
    if (currentStory) {
      apiFetch<{ viewers: any[] }>(`/api/stories/${currentStory.id}/interact`, {
        method: 'POST',
        body: JSON.stringify({})
      })
        .then((res) => setViewers(res.viewers || []))
        .catch(() => {});
    }
  }, [currentStory?.id]);

  const handleUploadStoryMedia = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadMediaFile(file);
      setMediaUrl(res.url);
      setMediaType(res.mimeType.startsWith('video/') ? 'video' : 'image');
      addToast('تم إرفاق ملف القصة بنجاح', 'success');
    } catch (err: any) {
      addToast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handlePublishStory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/stories', {
        method: 'POST',
        body: JSON.stringify({ mediaUrl, mediaType, caption })
      });
      addToast('تم نشر القصة (تظهر لمدة 24 ساعة)! +10 XP', 'success');
      setCreating(false);
      setCaption('');
      setMediaUrl('');
      setMediaType('text');
      loadStories();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleLikeStory = async () => {
    if (!currentStory) return;
    try {
      const nextLike = !currentStory.viewer_liked;
      await apiFetch(`/api/stories/${currentStory.id}/interact`, {
        method: 'POST',
        body: JSON.stringify({ like: nextLike })
      });
      loadStories();
    } catch {
      // ignore
    }
  };

  const handleDeleteStory = async () => {
    if (!currentStory) return;
    try {
      await apiFetch(`/api/stories/${currentStory.id}`, { method: 'DELETE' });
      addToast('تم حذف القصة بنجاح', 'info');
      setActiveIndex(0);
      loadStories();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-white/10 rounded-3xl max-w-md w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Top Bar */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-950">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>القصص اليومية (Stories - 24h)</span>
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCreating(!creating)}
              className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>نشر ستوري</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-slate-800 text-slate-300 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {creating ? (
          <form onSubmit={handlePublishStory} className="p-5 space-y-4">
            <h4 className="text-sm font-bold text-white">إنشاء قصة جديدة (تختفي تلقائياً بعد 24 ساعة)</h4>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">نص القصة أو الوصف</label>
              <textarea
                rows={3}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="شارك لحظتك أو اكتب نصاً..."
                className="w-full p-3 rounded-xl bg-slate-950 border border-white/10 text-xs text-white"
              />
            </div>

            <div className="flex items-center gap-3">
              <label className="flex-1 py-3 px-4 rounded-xl bg-slate-950 border border-dashed border-white/20 hover:border-indigo-400 text-xs text-slate-300 flex items-center justify-center gap-2 cursor-pointer">
                <ImageIcon className="w-4 h-4 text-indigo-400" />
                <span>{uploading ? 'جاري الرفع...' : mediaUrl ? 'تم إرفاق ملف (تغيير)' : 'رفع صورة أو فيديو (اختياري)'}</span>
                <input type="file" accept="image/*,video/*" onChange={handleUploadStoryMedia} className="hidden" />
              </label>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="submit"
                disabled={uploading}
                className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
              >
                نشر القصة الآن
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="px-4 py-3 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </form>
        ) : stories.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <p className="text-sm text-slate-300 font-bold">لا توجد قصص نشطة خلال الـ 24 ساعة الماضية</p>
            <p className="text-xs text-slate-500">كن أول من يشارك قصة مصورة أو نصية مع مجتمع نبض المجالس!</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            {/* Story Strip */}
            <div className="px-4 py-2.5 bg-slate-950/60 border-b border-white/5 flex items-center gap-2 overflow-x-auto">
              {stories.map((s, idx) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveIndex(idx)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs shrink-0 cursor-pointer border ${
                    idx === activeIndex
                      ? 'bg-indigo-600/25 border-indigo-400 text-white'
                      : 'bg-slate-900 border-white/10 text-slate-400'
                  }`}
                >
                  <AvatarWithFrame avatarUrl={s.avatar_url} displayName={s.display_name} gender={s.gender} size="xs" />
                  <span className="truncate max-w-[80px]">{s.display_name}</span>
                </button>
              ))}
            </div>

            {/* Active Story Display */}
            {currentStory && (
              <div className="relative flex-1 min-h-[360px] bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 flex flex-col justify-between p-5">
                <div className="flex items-center justify-between z-10">
                  <div className="flex items-center gap-2.5">
                    <AvatarWithFrame
                      avatarUrl={currentStory.avatar_url}
                      displayName={currentStory.display_name}
                      gender={currentStory.gender}
                      size="sm"
                    />
                    <div>
                      <div className="text-xs font-bold text-white">{currentStory.display_name}</div>
                      <div className="text-[10px] text-slate-400 font-mono-num">
                        ينتهي بعد {Math.max(1, Math.ceil((currentStory.expires_at - Date.now()) / 3600000))} ساعة
                      </div>
                    </div>
                  </div>
                  {(currentStory.user_id === user?.id || user?.permissions?.can_moderate_chat) && (
                    <button
                      type="button"
                      onClick={handleDeleteStory}
                      className="p-2 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white cursor-pointer"
                      title="حذف القصة"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Media / Text Content */}
                <div className="my-auto py-4 flex flex-col items-center justify-center text-center">
                  {currentStory.media_url && currentStory.media_type === 'image' && (
                    <img
                      src={currentStory.media_url}
                      alt="Story"
                      referrerPolicy="no-referrer"
                      className="max-h-64 rounded-2xl object-contain mx-auto mb-3 shadow-lg"
                    />
                  )}
                  {currentStory.media_url && currentStory.media_type === 'video' && (
                    <video
                      src={currentStory.media_url}
                      controls
                      autoPlay
                      className="max-h-64 rounded-2xl mx-auto mb-3 shadow-lg"
                    />
                  )}
                  {currentStory.caption && (
                    <p className="text-base font-bold text-white leading-relaxed px-4 py-2 rounded-2xl bg-black/40 backdrop-blur-xs">
                      {currentStory.caption}
                    </p>
                  )}
                </div>

                {/* Footer Stats & Like */}
                <div className="flex items-center justify-between pt-3 border-t border-white/10 z-10">
                  <div className="flex items-center gap-4 text-xs text-slate-300 font-mono-num">
                    <span className="flex items-center gap-1">
                      <Eye className="w-4 h-4 text-sky-400" />
                      {currentStory.views_count || viewers.length} مشاهدة
                    </span>
                    <span className="flex items-center gap-1">
                      <Heart className="w-4 h-4 text-rose-400" />
                      {currentStory.likes_count || 0} إعجاب
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleLikeStory}
                    className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                      currentStory.viewer_liked
                        ? 'bg-rose-600 text-white'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                    }`}
                  >
                    <Heart className="w-4 h-4" />
                    <span>{currentStory.viewer_liked ? 'أعجبني' : 'إعجاب'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 3. SHORT VIDEOS / REELS DRAWER (VERTICAL VIDEO FEED)
// ============================================================================
export const ReelsModal: React.FC<{ onClose: () => void; onOpenProfile: (uid: string) => void }> = ({
  onClose,
  onOpenProfile
}) => {
  const { addToast } = useApp();
  const [reels, setReels] = useState<any[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [commentText, setCommentText] = useState('');

  const loadReels = async () => {
    try {
      const res = await apiFetch<{ reels: any[] }>('/api/reels');
      setReels(res.reels);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadReels();
  }, []);

  const currentReel = reels[activeIndex];

  useEffect(() => {
    if (currentReel) {
      apiFetch(`/api/reels/${currentReel.id}/view`, { method: 'POST' }).catch(() => {});
      if (showComments) {
        apiFetch<{ comments: any[] }>(`/api/reels/${currentReel.id}/comments`)
          .then((r) => setComments(r.comments))
          .catch(() => {});
      }
    }
  }, [currentReel?.id, showComments]);

  const handleVideoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadMediaFile(file);
      setVideoUrl(res.url);
      addToast('تم رفع الفيديو القصير بنجاح', 'success');
    } catch (err: any) {
      addToast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handlePublishReel = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/reels', {
        method: 'POST',
        body: JSON.stringify({ videoUrl, title, description })
      });
      addToast('تم نشر الريلز بنجاح! +15 XP', 'success');
      setCreating(false);
      setTitle('');
      setDescription('');
      setVideoUrl('');
      loadReels();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleToggleLike = async () => {
    if (!currentReel) return;
    try {
      await apiFetch(`/api/reels/${currentReel.id}/like`, { method: 'POST' });
      loadReels();
    } catch {
      // ignore
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentReel || !commentText.trim()) return;
    try {
      await apiFetch(`/api/reels/${currentReel.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content: commentText })
      });
      setCommentText('');
      const r = await apiFetch<{ comments: any[] }>(`/api/reels/${currentReel.id}/comments`);
      setComments(r.comments);
      loadReels();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-end">
      <div className="bg-slate-950 border-r border-white/10 w-full max-w-md h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-3.5 border-b border-white/10 flex items-center justify-between bg-slate-900">
          <span className="text-sm font-bold text-white">ريلز نبض المجالس (Reels)</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCreating(!creating)}
              className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>نشر فيديو</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-slate-800 text-slate-300 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {creating ? (
          <form onSubmit={handlePublishReel} className="p-5 space-y-4">
            <h4 className="text-sm font-bold text-white">رفع فيديو قصير عمودي (Reel)</h4>
            <div>
              <label className="block text-xs text-slate-400 mb-1">عنوان الفيديو</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: أجواء السهرة اليوم 🔥"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-white/10 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">الوصف / الهاشتاقات</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="#نبض_المجالس #ريلز"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-white/10 text-xs text-white"
              />
            </div>
            <label className="block py-6 px-4 rounded-2xl bg-slate-900 border border-dashed border-white/20 text-center text-xs text-slate-300 cursor-pointer hover:border-indigo-500">
              {uploading ? 'جاري رفع الفيديو...' : videoUrl ? '✅ تم رفع الفيديو بنجاح' : 'اضغط لاختيار ملف فيديو (MP4 / WebM)'}
              <input type="file" accept="video/*" onChange={handleVideoFile} className="hidden" />
            </label>
            <button
              type="submit"
              disabled={!videoUrl || uploading}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
            >
              نشر الفيديو الآن
            </button>
          </form>
        ) : reels.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
            <p className="text-sm font-bold text-slate-200">لا توجد فيديوهات قصيرة منشورة حالياً</p>
            <p className="text-xs text-slate-400">
              ارفع أول فيديو قصير لك واحصل على جواهر نادرة (Gems) عند تفاعل الأعضاء مع محتواك!
            </p>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold cursor-pointer"
            >
              + نشر أول فيديو
            </button>
          </div>
        ) : (
          <div className="flex-1 relative bg-black flex flex-col justify-between overflow-hidden">
            {currentReel && (
              <>
                <video
                  key={currentReel.video_url}
                  src={currentReel.video_url}
                  controls
                  autoPlay
                  loop
                  playsInline
                  className="w-full h-full object-contain my-auto"
                />

                {/* Right Action Column (Like, Comment, Share, Next/Prev) */}
                <div className="absolute left-3 bottom-20 flex flex-col items-center gap-4 z-20">
                  <button
                    type="button"
                    onClick={handleToggleLike}
                    className="flex flex-col items-center gap-1 cursor-pointer"
                  >
                    <div
                      className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-md border border-white/15 ${
                        currentReel.is_liked ? 'bg-rose-600 text-white' : 'bg-black/60 text-white'
                      }`}
                    >
                      <Heart className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-bold text-white font-mono-num">{currentReel.likes_count}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowComments(!showComments)}
                    className="flex flex-col items-center gap-1 cursor-pointer"
                  >
                    <div className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-md border border-white/15 flex items-center justify-center text-white">
                      <MessageCircle className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-bold text-white font-mono-num">{currentReel.comments_count}</span>
                  </button>

                  <div className="flex flex-col items-center gap-1">
                    <div className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-md border border-white/15 flex items-center justify-center text-sky-400">
                      <Eye className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-bold text-white font-mono-num">{currentReel.views_count}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(window.location.href);
                      addToast('تم نسخ رابط المشاركة!', 'success');
                    }}
                    className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-md border border-white/15 flex items-center justify-center text-white cursor-pointer"
                  >
                    <Share2 className="w-5 h-5" />
                  </button>
                </div>

                {/* Bottom Creator & Title Overlay */}
                <div className="p-4 bg-gradient-to-t from-black/90 via-black/60 to-transparent z-10 flex items-center justify-between">
                  <div
                    onClick={() => onOpenProfile(currentReel.user_id)}
                    className="flex items-center gap-2.5 cursor-pointer"
                  >
                    <AvatarWithFrame
                      avatarUrl={currentReel.avatar_url}
                      displayName={currentReel.display_name}
                      gender={currentReel.gender}
                      size="sm"
                    />
                    <div>
                      <div className="text-xs font-bold text-white">@{currentReel.username}</div>
                      <div className="text-xs text-slate-200 font-semibold">{currentReel.title}</div>
                      {currentReel.description && (
                        <div className="text-[11px] text-slate-400">{currentReel.description}</div>
                      )}
                    </div>
                  </div>

                  {reels.length > 1 && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setActiveIndex((prev) => (prev - 1 + reels.length) % reels.length)}
                        className="px-2.5 py-1 rounded-lg bg-white/10 text-white text-xs cursor-pointer"
                      >
                        السابق
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveIndex((prev) => (prev + 1) % reels.length)}
                        className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-xs cursor-pointer"
                      >
                        التالي
                      </button>
                    </div>
                  )}
                </div>

                {/* Comments Drawer Overlay */}
                {showComments && (
                  <div className="absolute inset-x-0 bottom-0 h-2/3 bg-slate-900/95 backdrop-blur-xl rounded-t-3xl border-t border-white/15 z-30 flex flex-col p-4">
                    <div className="flex items-center justify-between pb-3 border-b border-white/10">
                      <span className="text-xs font-bold text-white">التعليقات ({comments.length})</span>
                      <button
                        type="button"
                        onClick={() => setShowComments(false)}
                        className="text-xs text-slate-400 cursor-pointer"
                      >
                        إغلاق
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto py-3 space-y-2.5">
                      {comments.map((c) => (
                        <div key={c.id} className="flex items-start gap-2 text-xs">
                          <AvatarWithFrame
                            avatarUrl={c.avatar_url}
                            displayName={c.display_name}
                            gender={c.gender}
                            size="xs"
                          />
                          <div className="bg-slate-950/70 rounded-xl p-2.5 flex-1">
                            <div className="font-bold text-white">{c.display_name}</div>
                            <p className="text-slate-300 mt-0.5">{c.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <form onSubmit={handleAddComment} className="flex items-center gap-2 pt-2 border-t border-white/10">
                      <input
                        type="text"
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="أضف تعليقاً..."
                        className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-xs text-white"
                      />
                      <button
                        type="submit"
                        className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold cursor-pointer"
                      >
                        إرسال
                      </button>
                    </form>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 4. ROOM WALL / حائط الأصدقاء DRAWER
// ============================================================================
export const WallModal: React.FC<{ onClose: () => void; onOpenProfile: (uid: string) => void }> = ({
  onClose,
  onOpenProfile
}) => {
  const { addToast } = useApp();
  const [posts, setPosts] = useState<any[]>([]);
  const [content, setContent] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [uploading, setUploading] = useState(false);

  const loadWall = async () => {
    try {
      const res = await apiFetch<{ posts: any[] }>('/api/wall');
      setPosts(res.posts);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadWall();
  }, []);

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadMediaFile(file);
      setMediaUrl(res.url);
    } catch (err: any) {
      addToast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() && !mediaUrl) return;
    try {
      await apiFetch('/api/wall', {
        method: 'POST',
        body: JSON.stringify({ content, mediaUrl })
      });
      setContent('');
      setMediaUrl('');
      loadWall();
      addToast('تم النشر على حائط الأصدقاء!', 'success');
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-end">
      <div className="bg-slate-900 border-r border-white/10 w-full max-w-md h-full flex flex-col shadow-2xl">
        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-950">
          <span className="text-sm font-bold text-white">حائط الأصدقاء (Room Wall)</span>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800 text-slate-300 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 bg-amber-500/10 border-b border-amber-500/20 text-amber-200 text-xs text-center font-semibold">
          ممنوع نشر أي محتوى مخالف أو مسيء — الاحترام المتبادل أساس مجتمعنا
        </div>

        <form onSubmit={handlePublish} className="p-4 border-b border-white/10 space-y-2.5 bg-slate-950/40">
          <textarea
            rows={2}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="شارك كلمة أو منشوراً جديداً على الحائط..."
            className="w-full p-3 rounded-xl bg-slate-950 border border-white/10 text-xs text-white resize-none"
          />
          <div className="flex items-center justify-between">
            <label className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1.5 cursor-pointer">
              <ImageIcon className="w-3.5 h-3.5 text-indigo-400" />
              <span>{uploading ? 'جاري الرفع...' : mediaUrl ? 'تم إرفاق صورة' : 'إرفاق صورة'}</span>
              <input type="file" accept="image/*" onChange={handleUploadImage} className="hidden" />
            </label>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
            >
              نشر على الحائط
            </button>
          </div>
        </form>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {posts.map((p) => (
            <div key={p.id} className="p-4 rounded-2xl bg-slate-950/80 border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <div
                  onClick={() => onOpenProfile(p.user_id)}
                  className="flex items-center gap-2.5 cursor-pointer"
                >
                  <AvatarWithFrame
                    avatarUrl={p.avatar_url}
                    displayName={p.display_name}
                    gender={p.gender}
                    size="sm"
                  />
                  <div>
                    <div className="text-xs font-bold text-white">{p.display_name}</div>
                    <div className="text-[10px] text-slate-500 font-mono-num">
                      {new Date(p.created_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/wall/${p.id}/like`, { method: 'POST' });
                    loadWall();
                  }}
                  className={`px-2.5 py-1 rounded-xl text-xs flex items-center gap-1 cursor-pointer ${
                    p.is_liked ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  <Heart className="w-3.5 h-3.5" />
                  <span className="font-mono-num">{p.likes_count}</span>
                </button>
              </div>
              {p.content && <p className="text-xs text-slate-200 leading-relaxed">{p.content}</p>}
              {p.media_url && (
                <img
                  src={p.media_url}
                  alt="منشور"
                  referrerPolicy="no-referrer"
                  className="w-full max-h-60 object-cover rounded-xl"
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 5. STORE & ECONOMY MODAL
// ============================================================================
export const StoreModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { user, setUser, addToast } = useApp();
  const [items, setItems] = useState<StoreItem[]>([]);
  const [activeTab, setActiveTab] = useState<'store' | 'exchange'>('store');
  const [xpToConvert, setXpToConvert] = useState(40);

  const loadStore = async () => {
    try {
      const res = await apiFetch<{ items: StoreItem[] }>('/api/store');
      setItems(res.items);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadStore();
  }, []);

  const handleBuy = async (itemId: string) => {
    try {
      const res = await apiFetch<{ message: string; user: User }>('/api/store/buy', {
        method: 'POST',
        body: JSON.stringify({ itemId })
      });
      setUser(res.user);
      addToast(res.message, 'success');
      loadStore();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleEquip = async (itemId: string) => {
    try {
      const res = await apiFetch<{ message: string; user: User }>('/api/store/equip', {
        method: 'POST',
        body: JSON.stringify({ itemId })
      });
      setUser(res.user);
      addToast(res.message, 'success');
      loadStore();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleDailyClaim = async () => {
    try {
      const res = await apiFetch<{ message: string; user: User }>('/api/economy/daily-claim', {
        method: 'POST'
      });
      setUser(res.user);
      addToast(res.message, 'reward');
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleConvertXp = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ message: string; user: User }>('/api/economy/convert-xp', {
        method: 'POST',
        body: JSON.stringify({ xpAmount: xpToConvert })
      });
      setUser(res.user);
      addToast(res.message, 'reward');
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-white/10 rounded-3xl max-w-3xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 bg-slate-950">
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="w-5 h-5 text-amber-400" />
            <h3 className="text-base font-bold text-white font-display">متجر نبض المجالس والاقتصاد</h3>
          </div>

          {/* Wallet Balances */}
          <div className="flex items-center gap-4 text-xs font-mono-num">
            <span className="text-amber-300 font-bold">🪙 {user?.gold || 0} Gold</span>
            <span className="text-cyan-300 font-bold">💎 {user?.gems || 0} Gems</span>
            <span className="text-indigo-300 font-bold">⚡ {user?.xp || 0} XP</span>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-slate-800 text-slate-300 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sub-nav */}
        <div className="px-5 py-3 bg-slate-950/50 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('store')}
              className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer ${
                activeTab === 'store' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              الأوسمة والإطارات والتأثيرات
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('exchange')}
              className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer ${
                activeTab === 'exchange' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              المكافآت وتحويل الـ XP
            </button>
          </div>

          <button
            type="button"
            onClick={handleDailyClaim}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold cursor-pointer"
          >
            🎁 استلام المكافأة اليومية
          </button>
        </div>

        {/* Content */}
        {activeTab === 'store' ? (
          <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-2xl bg-slate-950/80 border border-white/10 flex flex-col justify-between gap-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-white">{item.name}</span>
                    <span className="text-xs font-bold font-mono-num text-amber-300">
                      {item.currency === 'gold' ? `🪙 ${item.price} Gold` : `💎 ${item.price} Gems`}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{item.description}</p>
                  <div className="text-[11px] text-slate-500">
                    المستوى المطلوب: {item.min_level} · النوع: {item.item_type}
                  </div>
                </div>

                <div className="pt-2">
                  {item.isOwned ? (
                    <button
                      type="button"
                      onClick={() => handleEquip(item.id)}
                      className={`w-full py-2.5 rounded-xl text-xs font-bold cursor-pointer ${
                        item.isEquipped
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                      }`}
                    >
                      {item.isEquipped ? '✓ مفعل حالياً (اضغط للإلغاء)' : 'تفعيل على حسابي'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleBuy(item.id)}
                      className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
                    >
                      شراء الآن
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 space-y-6 overflow-y-auto">
            <div className="p-5 rounded-2xl bg-slate-950 border border-white/10 space-y-3">
              <h4 className="text-sm font-bold text-white">نظام الاقتصاد المتوازن في المنصة</h4>
              <ul className="text-xs text-slate-300 space-y-2 leading-relaxed">
                <li>• <strong>نقاط الخبرة (XP):</strong> تحصل على +1 XP تلقائياً من السيرفر عن كل دقيقة تقضيها داخل الموقع، بالإضافة إلى نقاط التفاعل.</li>
                <li>• <strong>العملات الذهبية (Gold Coins):</strong> العملة الاجتماعية اليومية؛ تحصل على +1 Gold كل 20 رسالة عامة غير مكررة، ومن مكافأة الدخول اليومي.</li>
                <li>• <strong>الجواهر النادرة (Gems):</strong> العملة النادرة؛ تحصل عليها عندما يشاهد أو يعجب أو يعلق أعضاء آخرون على قصصك وفيديوهاتك القصيرة (Reels).</li>
              </ul>
            </div>

            <form onSubmit={handleConvertXp} className="p-5 rounded-2xl bg-slate-950 border border-white/10 space-y-4">
              <h4 className="text-sm font-bold text-white">تحويل جزء من XP إلى عملات ذهبية (بحد يومي متوازن)</h4>
              <p className="text-xs text-slate-400">
                معدل التحويل: كل 20 XP تمنحك 10 عملات ذهبية (الحد الأقصى للتحويل اليومي هو 200 XP للحفاظ على توازن الاقتصاد).
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  step={20}
                  min={20}
                  max={200}
                  value={xpToConvert}
                  onChange={(e) => setXpToConvert(Number(e.target.value))}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 border border-white/10 text-sm text-white font-mono-num w-36"
                />
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
                >
                  تحويل إلى ذهب ({Math.floor(xpToConvert / 2)} Gold)
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 6. RANKINGS / LEADERBOARD MODAL (قائمة التصنيف)
// ============================================================================
export const RankingsModal: React.FC<{ onClose: () => void; onOpenProfile: (uid: string) => void }> = ({
  onClose,
  onOpenProfile
}) => {
  const [data, setData] = useState<any>(null);
  const [category, setCategory] = useState<'topXp' | 'topSupporters' | 'richestGold' | 'mostActive' | 'topCreators'>('topXp');

  useEffect(() => {
    apiFetch('/api/rankings')
      .then((res) => setData(res))
      .catch(() => {});
  }, []);

  const currentList: any[] = data ? data[category] || [] : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-white/10 rounded-3xl max-w-xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-950">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-bold text-white">قائمة المتصدرين والتفاعل</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800 text-slate-300 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 bg-slate-950/60 border-b border-white/5 flex items-center gap-1.5 overflow-x-auto">
          {[
            { id: 'topXp', label: 'أعلى XP ومستوى' },
            { id: 'topSupporters', label: 'أكثر الداعمين' },
            { id: 'richestGold', label: 'أغنى المستخدمين' },
            { id: 'mostActive', label: 'الأكثر نشاطاً' },
            { id: 'topCreators', label: 'صناع المحتوى' }
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setCategory(t.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer ${
                category === t.id ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {currentList.map((u, idx) => (
            <div
              key={u.id}
              onClick={() => onOpenProfile(u.id)}
              className="p-3 rounded-2xl bg-slate-950/70 hover:bg-slate-800/60 border border-white/5 flex items-center justify-between cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold font-mono-num ${
                    idx === 0
                      ? 'bg-amber-400 text-slate-950'
                      : idx === 1
                      ? 'bg-slate-300 text-slate-950'
                      : idx === 2
                      ? 'bg-amber-700 text-white'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {idx + 1}
                </span>
                <AvatarWithFrame
                  avatarUrl={u.avatar_url}
                  displayName={u.display_name}
                  gender={u.gender}
                  activeFrame={u.active_frame}
                  size="sm"
                />
                <div>
                  <div className="text-xs font-bold text-white">{u.display_name}</div>
                  <div className="text-[11px] text-slate-400">المستوى {u.level}</div>
                </div>
              </div>

              <div className="text-xs font-bold font-mono-num text-amber-300">
                {category === 'topXp' && `${u.xp} XP`}
                {category === 'topSupporters' && `${u.total_support_power} دعم`}
                {category === 'richestGold' && `🪙 ${u.gold} · 💎 ${u.gems}`}
                {category === 'mostActive' && `${u.public_msg_count} رسالة`}
                {category === 'topCreators' && `${u.creator_score} نقطة`}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 7. USER PROFILE & ACCOUNT SETTINGS MODAL (MATCHES VIDEO 3-TAB DESIGN)
// ============================================================================
export const UserProfileModal: React.FC<{
  targetUserId: string;
  onClose: () => void;
  onStartPrivateChat: (partnerId: string) => void;
  onOpenSendGift: (receiverId: string, receiverName: string) => void;
  onOpenReport: (targetType: string, targetId: string) => void;
}> = ({ targetUserId, onClose, onStartPrivateChat, onOpenSendGift, onOpenReport }) => {
  const { user, setUser, addToast, logout } = useApp();
  const [profile, setProfile] = useState<any>(null);
  const [tab, setTab] = useState<'account' | 'gifts' | 'more'>('account');
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editNameColor, setEditNameColor] = useState('');
  const [editFontColor, setEditFontColor] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const isMyProfile = user?.id === targetUserId;

  const loadProfile = async () => {
    try {
      const res = await apiFetch<{ profile: any }>(`/api/users/${targetUserId}/profile`);
      setProfile(res.profile);
      setEditName(res.profile.display_name);
      setEditBio(res.profile.bio || '');
      setEditStatus(res.profile.status_text || 'متصل الآن');
      setEditNameColor(res.profile.name_color || '');
      setEditFontColor(res.profile.font_color || '');
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  useEffect(() => {
    loadProfile();
  }, [targetUserId]);

  if (!profile) return null;

  const isFemale = profile.gender === 'female';
  const genderAccent = isFemale ? 'border-pink-500/40' : 'border-sky-500/40';

  const handleSaveMySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ user: User }>('/api/profile/customize', {
        method: 'PUT',
        body: JSON.stringify({
          displayName: editName,
          bio: editBio,
          statusText: editStatus,
          nameColor: editNameColor,
          fontColor: editFontColor,
          newPassword: newPassword || undefined
        })
      });
      setUser(res.user);
      setNewPassword('');
      addToast('تم حفظ تعديلات حسابك بنجاح!', 'success');
      loadProfile();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleUploadAvatarOrBanner = async (e: React.ChangeEvent<HTMLInputElement>, field: 'avatarUrl' | 'bannerUrl') => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const uploaded = await uploadMediaFile(file);
      const res = await apiFetch<{ user: User }>('/api/profile/customize', {
        method: 'PUT',
        body: JSON.stringify({ [field]: uploaded.url })
      });
      setUser(res.user);
      addToast('تم التحديث بنجاح!', 'success');
      loadProfile();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className={`bg-slate-900 border ${genderAccent} rounded-3xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl`}>
        {/* Banner & Avatar Header */}
        <div className="relative h-36 bg-gradient-to-r from-slate-800 via-indigo-950 to-slate-900 shrink-0">
          {profile.banner_url && (
            <img
              src={profile.banner_url}
              alt="غلاف"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          )}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 p-2 rounded-full bg-black/60 text-white hover:bg-black/80 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>

          {isMyProfile && (
            <label className="absolute top-3 left-3 px-3 py-1 rounded-xl bg-black/60 text-white text-[11px] cursor-pointer">
              تغيير الغلاف
              <input type="file" accept="image/*" onChange={(e) => handleUploadAvatarOrBanner(e, 'bannerUrl')} className="hidden" />
            </label>
          )}

          <div className="absolute -bottom-10 inset-x-0 flex flex-col items-center">
            <div className="relative">
              <AvatarWithFrame
                avatarUrl={profile.avatar_url}
                displayName={profile.display_name}
                gender={profile.gender}
                activeFrame={profile.active_frame}
                size="xl"
              />
              {isMyProfile && (
                <label className="absolute bottom-0 right-0 px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold cursor-pointer">
                  صورة
                  <input type="file" accept="image/*" onChange={(e) => handleUploadAvatarOrBanner(e, 'avatarUrl')} className="hidden" />
                </label>
              )}
            </div>
          </div>
        </div>

        {/* Identity & Level Bar */}
        <div className="pt-12 px-5 pb-3 text-center border-b border-white/10 space-y-2 shrink-0">
          <div className="flex items-center justify-center gap-2">
            <h3 className="text-lg font-extrabold text-white" style={{ color: profile.name_color || undefined }}>
              {profile.display_name}
            </h3>
            <span className="text-xs text-slate-400">{profile.roleLabel}</span>
          </div>

          <div className="text-xs text-slate-400">
            @{profile.username} · {profile.country} · {profile.age} سنة · {profile.gender === 'female' ? 'أنثى' : 'ذكر'}
          </div>

          {profile.bio && <p className="text-xs text-slate-300 max-w-md mx-auto">{profile.bio}</p>}

          {/* XP Progress Bar */}
          <div className="max-w-xs mx-auto pt-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1 font-mono-num">
              <span>المستوى {profile.level}</span>
              <span>
                {profile.levelProgress?.currentLevelXp || 0} / {profile.levelProgress?.nextLevelXp || 100} XP
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden border border-white/5">
              <div
                className={`h-full rounded-full ${isFemale ? 'bg-pink-500' : 'bg-sky-500'}`}
                style={{ width: `${profile.levelProgress?.progressPercent || 0}%` }}
              />
            </div>
          </div>

          {/* Quick Actions when viewing another user */}
          {!isMyProfile && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onStartPrivateChat(profile.id);
                }}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
              >
                💬 محادثة خاصة
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSendGift(profile.id, profile.display_name);
                }}
                className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer"
              >
                🎁 إرسال هدية
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await apiFetch('/api/friends/request', {
                      method: 'POST',
                      body: JSON.stringify({ targetUserId: profile.id })
                    });
                    addToast('تم إرسال طلب الصداقة!', 'success');
                  } catch (err: any) {
                    addToast(err.message, 'error');
                  }
                }}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold cursor-pointer"
              >
                + صداقة
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenReport('user', profile.id);
                }}
                className="p-2 rounded-xl bg-rose-600/20 text-rose-300 hover:bg-rose-600 hover:text-white cursor-pointer"
                title="إبلاغ"
              >
                <Flag className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* 3-Tab Switcher matching Reference Video (حساب | الهدايا | المزيد) */}
        <div className="grid grid-cols-3 border-b border-white/10 bg-slate-950/60 text-xs font-bold shrink-0">
          <button
            type="button"
            onClick={() => setTab('account')}
            className={`py-3 cursor-pointer border-b-2 transition-colors ${
              tab === 'account' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-400'
            }`}
          >
            حساب
          </button>
          <button
            type="button"
            onClick={() => setTab('gifts')}
            className={`py-3 cursor-pointer border-b-2 transition-colors ${
              tab === 'gifts' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-400'
            }`}
          >
            الهدايا ({profile.receivedGifts?.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setTab('more')}
            className={`py-3 cursor-pointer border-b-2 transition-colors ${
              tab === 'more' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-400'
            }`}
          >
            المزيد
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'account' && (
            isMyProfile ? (
              <form onSubmit={handleSaveMySettings} className="space-y-3.5 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">تغيير الاسم المعروض</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">تعديل الحالة (Status)</label>
                  <input
                    type="text"
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">تعديل النبذة (Bio)</label>
                  <textarea
                    rows={2}
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-white resize-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">لون اسم المستخدم</label>
                    <input
                      type="color"
                      value={editNameColor || '#ffffff'}
                      onChange={(e) => setEditNameColor(e.target.value)}
                      className="w-full h-9 rounded-xl bg-slate-950 border border-white/10 cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">لون خط الرسائل</label>
                    <input
                      type="color"
                      value={editFontColor || '#f1f5f9'}
                      onChange={(e) => setEditFontColor(e.target.value)}
                      className="w-full h-9 rounded-xl bg-slate-950 border border-white/10 cursor-pointer"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">تغيير كلمة المرور (اختياري)</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="اتركه فارغاً لعدم التغيير"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-white"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold cursor-pointer"
                >
                  حفظ التعديلات
                </button>
              </form>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-white/5">
                  <div className="text-slate-400">نقاط الخبرة (XP)</div>
                  <div className="text-base font-bold text-white font-mono-num mt-1">{profile.xp}</div>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-white/5">
                  <div className="text-slate-400">قوة الدعم الكلية</div>
                  <div className="text-base font-bold text-amber-400 font-mono-num mt-1">{profile.total_support_power}</div>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-white/5">
                  <div className="text-slate-400">العملات الذهبية</div>
                  <div className="text-base font-bold text-amber-300 font-mono-num mt-1">🪙 {profile.gold}</div>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-white/5">
                  <div className="text-slate-400">الجواهر النادرة</div>
                  <div className="text-base font-bold text-cyan-300 font-mono-num mt-1">💎 {profile.gems}</div>
                </div>
              </div>
            )
          )}

          {tab === 'gifts' && (
            profile.receivedGifts?.length === 0 ? (
              <div className="text-center py-10 text-xs text-slate-500">
                حالياً لا توجد هدايا مستلمة لعرضها
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {profile.receivedGifts.map((g: any) => (
                  <div
                    key={g.id}
                    className="p-3 rounded-2xl bg-slate-950 border border-white/10 text-center space-y-1"
                  >
                    <div className="text-2xl">{g.icon_emoji}</div>
                    <div className="text-xs font-bold text-white">{g.name_ar}</div>
                    <div className="text-[10px] text-slate-400">من: {g.sender_name}</div>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === 'more' && (
            <div className="space-y-3 text-xs">
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-white/5 flex items-center justify-between">
                <span className="text-slate-300">عدد الأصدقاء</span>
                <span className="font-bold text-white font-mono-num">{profile.friendsCount || 0}</span>
              </div>
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-white/5 flex items-center justify-between">
                <span className="text-slate-300">الفيديوهات القصيرة (Reels)</span>
                <span className="font-bold text-white font-mono-num">{profile.reels?.length || 0}</span>
              </div>
              {isMyProfile && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    logout();
                  }}
                  className="w-full py-3 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>تسجيل الخروج من الحساب</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 8. SEND GIFT MODAL (GOLD GIFTS + RARE GEM GIFTS)
// ============================================================================
export const SendGiftModal: React.FC<{
  receiverId: string;
  receiverName: string;
  contextType: 'room' | 'live';
  contextId: string;
  battleSide?: 'host' | 'opponent' | 'third';
  onClose: () => void;
}> = ({ receiverId, receiverName, contextType, contextId, battleSide = 'host', onClose }) => {
  const { user, setUser, giftsCatalog, addToast } = useApp();
  const [currencyTab, setCurrencyTab] = useState<'gold' | 'gems'>('gold');
  const [sending, setSending] = useState(false);

  const filteredGifts = giftsCatalog.filter((g) => g.currency === currencyTab);

  const handleSendGift = async (giftId: string) => {
    setSending(true);
    try {
      const res = await apiFetch<{ user: User }>('/api/gifts/send', {
        method: 'POST',
        body: JSON.stringify({
          giftId,
          receiverId,
          contextType,
          contextId,
          battleSide
        })
      });
      setUser(res.user);
      addToast(`تم إرسال الهدية إلى ${receiverName}!`, 'reward');
      onClose();
    } catch (err: any) {
      addToast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-white/15 rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-950">
          <div>
            <h3 className="text-sm font-bold text-white">إرسال هدية دعم إلى {receiverName}</h3>
            <div className="text-[11px] text-slate-400 font-mono-num mt-0.5">
              رصيدك: 🪙 {user?.gold || 0} Gold · 💎 {user?.gems || 0} Gems
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-xl bg-slate-800 text-slate-300 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 p-2 bg-slate-950/60 border-b border-white/5 gap-2">
          <button
            type="button"
            onClick={() => setCurrencyTab('gold')}
            className={`py-2 rounded-xl text-xs font-bold cursor-pointer ${
              currencyTab === 'gold' ? 'bg-amber-500 text-slate-950' : 'text-slate-400'
            }`}
          >
            🪙 هدايا العملات الذهبية (Gold)
          </button>
          <button
            type="button"
            onClick={() => setCurrencyTab('gems')}
            className={`py-2 rounded-xl text-xs font-bold cursor-pointer ${
              currencyTab === 'gems' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400'
            }`}
          >
            💎 الهدايا الماسية النادرة (Gems)
          </button>
        </div>

        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
          {filteredGifts.map((g) => (
            <button
              key={g.id}
              type="button"
              disabled={sending}
              onClick={() => handleSendGift(g.id)}
              className={`p-3.5 rounded-2xl bg-gradient-to-b ${g.effect_class} border flex flex-col items-center text-center gap-1.5 hover:scale-[1.03] transition-transform cursor-pointer`}
            >
              <span className="text-3xl">{g.icon_emoji}</span>
              <span className="text-xs font-bold text-white">{g.name_ar}</span>
              <span className="text-[11px] font-bold font-mono-num text-amber-200">
                {g.currency === 'gold' ? `🪙 ${g.cost} Gold` : `💎 ${g.cost} Gems`}
              </span>
              <span className="text-[10px] text-emerald-300 font-mono-num">
                +{g.bar_power.toLocaleString()} Bar Power
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 9. REPORT MODAL (إبلاغ للإدارة)
// ============================================================================
export const ReportModal: React.FC<{
  targetType: string;
  targetId: string;
  onClose: () => void;
}> = ({ targetType, targetId, onClose }) => {
  const { addToast } = useApp();
  const [reason, setReason] = useState('إساءة أو ألفاظ غير لائقة');
  const [details, setDetails] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ message: string }>('/api/reports', {
        method: 'POST',
        body: JSON.stringify({ targetType, targetId, reason, details })
      });
      addToast(res.message, 'success');
      onClose();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-slate-900 border border-white/10 rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Flag className="w-4 h-4 text-rose-400" />
            <span>تقديم بلاغ للإدارة ({targetType})</span>
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">سبب البلاغ</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-xs text-white"
          >
            <option value="إساءة أو ألفاظ غير لائقة">إساءة أو ألفاظ غير لائقة</option>
            <option value="سبام أو إعلانات مزعجة">سبام أو إعلانات مزعجة</option>
            <option value="محتوى غير ملائم">محتوى غير ملائم</option>
            <option value="انتحال شخصية">انتحال شخصية</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">تفاصيل إضافية</label>
          <textarea
            rows={3}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="اشرح تفاصيل المخالفة ليتمكن المشرفون من اتخاذ الإجراء المناسب..."
            className="w-full p-3 rounded-xl bg-slate-950 border border-white/10 text-xs text-white resize-none"
          />
        </div>

        <button
          type="submit"
          className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
        >
          إرسال البلاغ الآن
        </button>
      </form>
    </div>
  );
};
