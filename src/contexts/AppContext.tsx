import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { GiftAnimationEvent, GiftItem, Room, User } from '../types';
import { apiFetch, doesTabNeedSessionClone, getStoredToken, setStoredToken, setTabOnlyToken } from '../services/api';
import { playGiftSound, playNotificationSound } from '../services/soundEffects';

export type ThemeMode = 'dark' | 'light';

interface ToastMsg {
  id: string;
  text: string;
  type: 'info' | 'success' | 'error' | 'reward';
}

interface AppContextValue {
  user: User | null;
  loadingAuth: boolean;
  socket: Socket | null;
  rooms: Room[];
  giftsCatalog: GiftItem[];
  activeGiftAnimation: GiftAnimationEvent | null;
  toasts: ToastMsg[];
  theme: ThemeMode;
  sessionEntryTime: number;
  toggleTheme: () => void;
  setTheme: (theme: ThemeMode) => void;
  addToast: (text: string, type?: 'info' | 'success' | 'error' | 'reward') => void;
  removeToast: (id: string) => void;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  refreshUser: () => Promise<void>;
  refreshRooms: () => Promise<void>;
  logout: () => Promise<void>;
  triggerGiftQueue: (anim: GiftAnimationEvent) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

const THEME_STORAGE_KEY = 'nabd_theme_mode';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [giftsCatalog, setGiftsCatalog] = useState<GiftItem[]>([]);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [giftQueue, setGiftQueue] = useState<GiftAnimationEvent[]>([]);
  const [activeGiftAnimation, setActiveGiftAnimation] = useState<GiftAnimationEvent | null>(null);
  const [sessionEntryTime] = useState<number>(() => Date.now());
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // ignore storage errors
    }
    return 'dark';
  });
  const giftTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync Tailwind `dark` class on <html> and <body>
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
      body.classList.add('dark');
      body.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
      body.classList.add('light');
      body.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const setTheme = useCallback((nextTheme: ThemeMode) => {
    setThemeState(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const addToast = useCallback((text: string, type: 'info' | 'success' | 'error' | 'reward' = 'info') => {
    const id = `${Date.now()}_${Math.random()}`;
    setToasts((prev) => [...prev.slice(-3), { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const triggerGiftQueue = useCallback((anim: GiftAnimationEvent) => {
    setGiftQueue((prev) => [...prev, anim]);
  }, []);

  useEffect(() => {
    if (!activeGiftAnimation && giftQueue.length > 0) {
      const next = giftQueue[0];
      setGiftQueue((prev) => prev.slice(1));
      setActiveGiftAnimation(next);
      playGiftSound(next.tier);
      if (giftTimerRef.current) clearTimeout(giftTimerRef.current);
      const duration = next.currency === 'gems' ? 4500 : 3000;
      giftTimerRef.current = setTimeout(() => {
        setActiveGiftAnimation(null);
      }, duration);
    }
  }, [activeGiftAnimation, giftQueue]);

  const refreshUser = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: User }>('/api/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }, []);

  const refreshRooms = useCallback(async () => {
    try {
      const data = await apiFetch<{ rooms: Room[] }>('/api/rooms');
      setRooms(data.rooms);
    } catch {
      // ignore if unauthenticated
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const headers: Record<string, string> = {};
        if (doesTabNeedSessionClone()) {
          headers['X-Clone-Session'] = '1';
        }
        const data = await apiFetch<{ user: User; clonedToken?: string }>('/api/auth/me', { headers });
        if (data.clonedToken) {
          setTabOnlyToken(data.clonedToken);
        }
        if (isMounted) {
          setUser(data.user);
          setLoadingAuth(false);
        }
        return;
      } catch {
        // Fallback to Firebase Auth browserLocalPersistence if signed in via Firebase
      }

      const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
        if (!isMounted) return;
        if (fbUser) {
          try {
            const res = await apiFetch<{ token: string; user: User }>('/api/auth/firebase', {
              method: 'POST',
              body: JSON.stringify({
                uid: fbUser.uid,
                email: fbUser.email,
                displayName: fbUser.displayName,
                photoURL: fbUser.photoURL
              })
            });
            setStoredToken(res.token);
            if (isMounted) setUser(res.user);
          } catch {
            if (isMounted) setUser(null);
          }
        } else {
          setUser(null);
        }
        if (isMounted) setLoadingAuth(false);
      });

      return () => unsubscribe();
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  // Connect Socket.io & Load Initial Catalogs when authenticated
  useEffect(() => {
    if (!user) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      return;
    }

    refreshRooms();
    apiFetch<{ gifts: GiftItem[] }>('/api/gifts')
      .then((res) => setGiftsCatalog(res.gifts))
      .catch(() => {});

    const token = getStoredToken();
    const newSocket = io(window.location.origin, {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    newSocket.on('economy:update', (payload: any) => {
      setUser((prev) =>
        prev
          ? {
              ...prev,
              gold: payload.gold ?? prev.gold,
              gems: payload.gems ?? prev.gems,
              xp: payload.xp ?? prev.xp,
              level: payload.level ?? prev.level,
              levelProgress: payload.levelProgress ?? prev.levelProgress
            }
          : prev
      );
      if (payload.toast) {
        addToast(payload.toast, 'reward');
      }
    });

    newSocket.on('notification:new', (payload: { title: string; body: string }) => {
      playNotificationSound();
      addToast(`${payload.title}: ${payload.body}`, 'info');
      refreshUser();
    });

    newSocket.on('pm:new', (msg: any) => {
      if (msg.receiver_id === user.id) {
        playNotificationSound();
        addToast(`💬 رسالة خاصة جديدة من ${msg.sender_name}`, 'info');
        refreshUser();
      }
    });

    newSocket.on('room:gift_animation', (anim: GiftAnimationEvent) => {
      triggerGiftQueue(anim);
    });

    newSocket.on('live:gift_animation', (anim: GiftAnimationEvent) => {
      triggerGiftQueue(anim);
    });

    newSocket.on('auth:banned', (payload: { reason: string }) => {
      addToast(`تم حظر حسابك: ${payload.reason}`, 'error');
      setStoredToken(null);
      setUser(null);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [user?.id]);

  // Server-Authoritative 60-Second XP Heartbeat (+1 XP per minute inside platform)
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(async () => {
      try {
        const res = await apiFetch<{ awarded: boolean; user: User }>('/api/economy/heartbeat', {
          method: 'POST'
        });
        if (res.user) {
          setUser(res.user);
        }
      } catch {
        // ignore network hiccup
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [user?.id]);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
    setStoredToken(null);
    setUser(null);
  }, []);

  return (
    <AppContext.Provider
      value={{
        user,
        loadingAuth,
        socket,
        rooms,
        giftsCatalog,
        activeGiftAnimation,
        toasts,
        theme,
        sessionEntryTime,
        toggleTheme,
        setTheme,
        addToast,
        removeToast,
        setUser,
        refreshUser,
        refreshRooms,
        logout,
        triggerGiftQueue
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
