import { uploadFileToFirebaseStorage } from '../firebase';

const TOKEN_KEY = 'nabd_auth_token';
const TAB_TOKEN_KEY = 'nabd_tab_auth_token';

let currentToken: string | null = null;

if (typeof window !== 'undefined') {
  try {
    const savedLocal = localStorage.getItem(TOKEN_KEY);
    const savedTab = sessionStorage.getItem(TAB_TOKEN_KEY);
    currentToken = savedLocal || savedTab || null;
    if (currentToken) {
      localStorage.setItem(TOKEN_KEY, currentToken);
      sessionStorage.setItem(TAB_TOKEN_KEY, currentToken);
    }
  } catch {
    // ignore storage access issues
  }
}

export function doesTabNeedSessionClone(): boolean {
  return false;
}

export function setTabOnlyToken(token: string) {
  setStoredToken(token);
}

export function getStoredToken(): string | null {
  if (currentToken) return currentToken;
  if (typeof window !== 'undefined') {
    try {
      const localTok = localStorage.getItem(TOKEN_KEY);
      if (localTok) {
        currentToken = localTok;
        sessionStorage.setItem(TAB_TOKEN_KEY, localTok);
        return localTok;
      }
      const tabTok = sessionStorage.getItem(TAB_TOKEN_KEY);
      if (tabTok) {
        currentToken = tabTok;
        localStorage.setItem(TOKEN_KEY, tabTok);
        return tabTok;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export function setStoredToken(token: string | null) {
  currentToken = token;
  if (typeof window !== 'undefined') {
    try {
      if (token) {
        localStorage.setItem(TOKEN_KEY, token);
        sessionStorage.setItem(TAB_TOKEN_KEY, token);
      } else {
        localStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(TAB_TOKEN_KEY);
      }
    } catch {
      // ignore
    }
  }
}

export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {})
  };

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include'
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'حدث خطأ في الاتصال بالخادم');
  }
  return data as T;
}

export async function uploadMediaFile(file: File): Promise<{ url: string; mimeType: string }> {
  try {
    const firebaseUrl = await uploadFileToFirebaseStorage(file);
    if (firebaseUrl) {
      return { url: firebaseUrl, mimeType: file.type || 'application/octet-stream' };
    }
  } catch {
    // Fallback to permanent server disk storage
  }
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch<{ url: string; mimeType: string }>('/api/upload', {
    method: 'POST',
    body: formData
  });
}
