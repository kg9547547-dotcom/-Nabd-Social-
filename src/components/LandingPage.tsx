import React, { useState } from 'react';
import { LogIn, UserPlus, UserCheck, ShieldCheck, Mic, Radio, Sparkles, Compass } from 'lucide-react';
import { apiFetch, setStoredToken } from '../services/api';
import { signInWithFirebaseGoogle } from '../firebase';
import { useApp } from '../contexts/AppContext';
import { User } from '../types';

export const LandingPage: React.FC = () => {
  const { setUser, addToast } = useApp();
  const [mode, setMode] = useState<'login' | 'register' | 'guest'>('login');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [guestNickname, setGuestNickname] = useState('');
  const [guestGender, setGuestGender] = useState<'male' | 'female'>('male');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      if (mode === 'register') {
        const res = await apiFetch<{ token: string; user: User }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ displayName, username, password })
        });
        setStoredToken(res.token);
        setUser(res.user);
        addToast('تم إنشاء حسابك بنجاح! أكمل إعداد ملفك الشخصي.', 'success');
      } else if (mode === 'login') {
        const res = await apiFetch<{ token: string; user: User }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password })
        });
        setStoredToken(res.token);
        setUser(res.user);
        addToast(`أهلاً بعودتك ${res.user.display_name}!`, 'success');
      } else if (mode === 'guest') {
        const res = await apiFetch<{ token: string; user: User }>('/api/auth/guest', {
          method: 'POST',
          body: JSON.stringify({ nickname: guestNickname, gender: guestGender })
        });
        setStoredToken(res.token);
        setUser(res.user);
        addToast('تم الدخول كضيف بنجاح.', 'info');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'حدث خطأ أثناء المتابعة');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const fbUser = await signInWithFirebaseGoogle();
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
      setUser(res.user);
      addToast(`أهلاً بك ${res.user.display_name}!`, 'success');
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر تسجيل الدخول عبر حساب Google حالياً.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0D13] text-slate-100 flex flex-col justify-between relative overflow-hidden">
      {/* Subtle Ambient Background */}
      <div className="absolute inset-0 pointer-events-none">
        <img
          src="/src/assets/images/landing_hero_lounge_1790452745506.jpg"
          alt="خلفية نبض المجالس"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover opacity-20 scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0B0D13]/90 via-[#0B0D13]/85 to-[#0B0D13]" />
        <div className="absolute -top-40 right-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl" />
      </div>

      {/* Top Navigation Contract: 3 Zones */}
      <header className="relative z-10 max-w-7xl w-full mx-auto px-6 py-5 flex items-center justify-between border-b border-white/5">
        <a href="#top" className="text-xl font-bold tracking-tight text-white font-display">
          نبض المجالس
        </a>

        <nav className="hidden md:flex items-center gap-8 text-sm text-slate-300">
          <a href="#features" className="hover:text-white transition-colors">الغرف الصوتية</a>
          <a href="#live" className="hover:text-white transition-colors">البث المباشر</a>
          <a href="#economy" className="hover:text-white transition-colors">نظام المستويات</a>
          <a href="#security" className="hover:text-white transition-colors">الحماية والرتب</a>
        </nav>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setErrorMsg(null);
            }}
            className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors whitespace-nowrap cursor-pointer"
          >
            انضم الآن
          </button>
        </div>
      </header>

      {/* Main Content Split */}
      <main className="relative z-10 max-w-7xl w-full mx-auto px-6 py-10 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center flex-1">
        {/* Right Column (RTL): Editorial Hero Proposition */}
        <div className="lg:col-span-7 space-y-6">
          <div className="inline-flex items-center gap-2 text-xs text-indigo-300/90 font-medium">
            <span>مجتمع صوتي ومرئي عربي متكامل</span>
            <span aria-hidden="true">·</span>
            <span>بثوث مباشرة وجولات تنافسية</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold text-white leading-tight font-display">
            مساحتك العربية الأرقى للدردشة الصوتية، البث المباشر، والتفاعل الحي
          </h1>

          <p className="text-slate-300 text-base sm:text-lg leading-relaxed max-w-2xl">
            اجتمع مع أصدقائك في غرف عامة وخاصة، اصعد للمقاعد الصوتية المباشرة بتقنية WebRTC، شارك يومياتك عبر القصص والريلز، وتنافس في جولات البث المباشر ونظام المستويات الحقيقي.
          </p>

          <div id="features" className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
            <div className="p-4 rounded-2xl bg-slate-900/70 border border-white/10 backdrop-blur-md">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/15 text-indigo-300 flex items-center justify-center mb-3">
                <Mic className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white mb-1">غرف ومقاعد صوتية</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                غرف عامة وخاصة محمية بكلمة مرور مع 5 مقاعد صوتية حقيقية وإدارة متكاملة.
              </p>
            </div>

            <div id="live" className="p-4 rounded-2xl bg-slate-900/70 border border-white/10 backdrop-blur-md">
              <div className="w-9 h-9 rounded-xl bg-rose-500/15 text-rose-300 flex items-center justify-center mb-3">
                <Radio className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white mb-1">بث مباشر وجولات</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                بثوث صوتية تفاعلية، شريط دعم متحرك، نقرات، وهدايا ذهبية وماسية بتأثيرات حية.
              </p>
            </div>

            <div id="economy" className="p-4 rounded-2xl bg-slate-900/70 border border-white/10 backdrop-blur-md">
              <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-300 flex items-center justify-center mb-3">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white mb-1">اقتصاد ومستويات عادلة</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                نظام XP لكل دقيقة تواجد، عملات ذهبية، وجواهر نادرة مع متجر أوسمة وإطارات.
              </p>
            </div>
          </div>
        </div>

        {/* Left Column (RTL): Authentication Card */}
        <div className="lg:col-span-5">
          <div className="bg-slate-900/85 border border-white/10 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl">
            {/* Mode Switcher Tabs */}
            <div className="grid grid-cols-3 gap-1.5 p-1.5 bg-slate-950/80 rounded-2xl mb-6 border border-white/5">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMsg(null);
                }}
                className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5 ${
                  mode === 'login'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>تسجيل الدخول</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setErrorMsg(null);
                }}
                className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5 ${
                  mode === 'register'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>إنشاء حساب</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode('guest');
                  setErrorMsg(null);
                }}
                className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5 ${
                  mode === 'guest'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>دخول كضيف</span>
              </button>
            </div>

            {errorMsg && (
              <div className="mb-5 p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs leading-relaxed">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    الاسم المعروض
                  </label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="مثال: صقر العرب"
                    className="w-full px-4 py-3 rounded-xl bg-slate-950/90 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              {mode !== 'guest' ? (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      اسم المستخدم (Username)
                    </label>
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="بدون مسافات، مثال: saqr_99"
                      dir="ltr"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950/90 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-right"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      كلمة المرور
                    </label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="6 أحرف على الأقل"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950/90 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      اللقب المؤقت (اختياري)
                    </label>
                    <input
                      type="text"
                      value={guestNickname}
                      onChange={(e) => setGuestNickname(e.target.value)}
                      placeholder="اتركه فارغاً لتوليد لقب تلقائي"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950/90 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      الجنس (لتخصيص الهوية البصرية)
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setGuestGender('male')}
                        className={`py-2.5 px-4 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                          guestGender === 'male'
                            ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                            : 'bg-slate-950/60 border-white/10 text-slate-400'
                        }`}
                      >
                        ذكر (هوية زرقاء)
                      </button>
                      <button
                        type="button"
                        onClick={() => setGuestGender('female')}
                        className={`py-2.5 px-4 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                          guestGender === 'female'
                            ? 'bg-pink-500/20 border-pink-400 text-pink-200'
                            : 'bg-slate-950/60 border-white/10 text-slate-400'
                        }`}
                      >
                        أنثى (هوية وردية)
                      </button>
                    </div>
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-sm transition-all shadow-lg shadow-indigo-600/25 cursor-pointer"
              >
                {submitting
                  ? 'جاري المعالجة...'
                  : mode === 'register'
                  ? 'إنشاء حساب جديد'
                  : mode === 'login'
                  ? 'دخول إلى المنصة'
                  : 'الدخول السريع كضيف'}
              </button>
            </form>

            {/* Divider */}
            <div className="my-5 flex items-center gap-3">
              <div className="h-px bg-white/10 flex-1" />
              <span className="text-xs text-slate-500">أو المتابعة عبر</span>
              <div className="h-px bg-white/10 flex-1" />
            </div>

            {/* Google Sign-In Button */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="w-full py-3 px-4 rounded-xl bg-slate-950 hover:bg-slate-800 border border-white/10 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
            >
              <Compass className="w-4 h-4 text-sky-400" />
              <span>تسجيل الدخول بواسطة Google</span>
            </button>

            <p id="security" className="mt-5 text-[11px] text-slate-400 text-center leading-relaxed flex items-center justify-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>جميع كلمات المرور مشفرة، وأول حساب مسجل يحصل تلقائياً على رتبة المالك (Owner).</span>
            </p>
          </div>
        </div>
      </main>

      {/* Quiet Footer */}
      <footer className="relative z-10 max-w-7xl w-full mx-auto px-6 py-4 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
        <span>منصة نبض المجالس — جميع الحقوق محفوظة © {new Date().getFullYear()}</span>
        <span>واجهة عربية متكاملة · غرف صوتية · بث مباشر</span>
      </footer>
    </div>
  );
};
