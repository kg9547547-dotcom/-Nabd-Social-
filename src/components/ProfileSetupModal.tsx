import React, { useState } from 'react';
import { Camera, Image as ImageIcon, CheckCircle2 } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { apiFetch, uploadMediaFile } from '../services/api';
import { User } from '../types';
import { AvatarWithFrame } from './AvatarWithFrame';

const ARAB_COUNTRIES = [
  'السعودية', 'الإمارات', 'الكويت', 'قطر', 'البحرين', 'عُمان',
  'مصر', 'الأردن', 'العراق', 'الجزائر', 'المغرب', 'تونس',
  'لبنان', 'فلسطين', 'سوريا', 'اليمن', 'السودان', 'ليبيا', 'موريتانيا'
];

export const ProfileSetupModal: React.FC<{ onCompleted: () => void }> = ({ onCompleted }) => {
  const { user, setUser, addToast } = useApp();
  if (!user) return null;

  const [displayName, setDisplayName] = useState(user.display_name);
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.bio || 'أهلاً بكم في ملفي الشخصي على نبض المجالس ✨');
  const [country, setCountry] = useState(user.country || 'السعودية');
  const [age, setAge] = useState(user.age || 22);
  const [gender, setGender] = useState<'male' | 'female'>(user.gender || 'male');
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url || '');
  const [bannerUrl, setBannerUrl] = useState(user.banner_url || '');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadMediaFile(file);
      setAvatarUrl(res.url);
      addToast('تم رفع الصورة الشخصية بنجاح', 'success');
    } catch (err: any) {
      addToast(err.message || 'فشل رفع الصورة', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadMediaFile(file);
      setBannerUrl(res.url);
      addToast('تم رفع غلاف البروفايل بنجاح', 'success');
    } catch (err: any) {
      addToast(err.message || 'فشل رفع الغلاف', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch<{ user: User }>('/api/profile/setup', {
        method: 'POST',
        body: JSON.stringify({
          displayName,
          username,
          bio,
          country,
          age,
          gender,
          avatarUrl,
          bannerUrl
        })
      });
      setUser(res.user);
      addToast('تم حفظ إعدادات ملفك الشخصي بنجاح!', 'success');
      onCompleted();
    } catch (err: any) {
      addToast(err.message || 'تعذر حفظ الملف الشخصي', 'error');
    } finally {
      setSaving(false);
    }
  };

  const isFemale = gender === 'female';
  const accentBorder = isFemale ? 'border-pink-500/40' : 'border-sky-500/40';
  const accentBtn = isFemale
    ? 'bg-pink-600 hover:bg-pink-500 shadow-pink-600/25'
    : 'bg-sky-600 hover:bg-sky-500 shadow-sky-600/25';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className={`bg-slate-900 border ${accentBorder} rounded-3xl max-w-xl w-full overflow-hidden shadow-2xl my-8`}>
        {/* Banner Preview */}
        <div className="relative h-36 bg-gradient-to-r from-slate-800 via-indigo-950 to-slate-900">
          {bannerUrl && (
            <img
              src={bannerUrl}
              alt="Banner"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          )}
          <label className="absolute top-3 left-3 px-3 py-1.5 rounded-xl bg-black/60 hover:bg-black/80 text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer backdrop-blur-sm border border-white/10">
            <ImageIcon className="w-3.5 h-3.5" />
            <span>تغيير الغلاف (Banner)</span>
            <input type="file" accept="image/*" onChange={handleBannerUpload} className="hidden" />
          </label>

          {/* Avatar Preview */}
          <div className="absolute -bottom-10 right-6 flex items-end gap-3">
            <div className="relative">
              <AvatarWithFrame
                avatarUrl={avatarUrl}
                displayName={displayName}
                gender={gender}
                size="xl"
              />
              <label className="absolute bottom-0 left-0 w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center cursor-pointer shadow-lg border border-white/20">
                <Camera className="w-4 h-4" />
                <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
              </label>
            </div>
          </div>
        </div>

        <form onSubmit={handleSave} className="p-6 pt-14 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white font-display">إعداد الملف الشخصي</h2>
              <p className="text-xs text-slate-400">أكمل بياناتك الأساسية لتظهر بهويتك المميزة داخل الغرف</p>
            </div>
            <span
              className={`text-xs font-bold px-3 py-1 rounded-xl border ${
                isFemale
                  ? 'bg-pink-500/15 text-pink-300 border-pink-400/30'
                  : 'bg-sky-500/15 text-sky-300 border-sky-400/30'
              }`}
            >
              {isFemale ? 'هوية أنثى (وردي)' : 'هوية ذكر (أزرق)'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">الاسم المعروض</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">اسم المستخدم (Username)</label>
              <input
                type="text"
                required
                dir="ltr"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-sm text-white text-right"
              />
            </div>
          </div>

          {/* Gender Selection with Blue / Pink Visual Identity */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">الجنس (يحدد لون الإطار والتفاصيل البصرية)</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setGender('male')}
                className={`py-3 px-4 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  gender === 'male'
                    ? 'bg-sky-500/20 border-sky-400 text-sky-200 shadow-[0_0_15px_rgba(56,189,248,0.2)]'
                    : 'bg-slate-950 border-white/10 text-slate-400'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
                <span>ذكر — تفاصيل زرقاء</span>
              </button>

              <button
                type="button"
                onClick={() => setGender('female')}
                className={`py-3 px-4 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  gender === 'female'
                    ? 'bg-pink-500/20 border-pink-400 text-pink-200 shadow-[0_0_15px_rgba(244,114,182,0.2)]'
                    : 'bg-slate-950 border-white/10 text-slate-400'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-pink-400" />
                <span>أنثى — تفاصيل وردية</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">الدولة</label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-sm text-white"
              >
                {ARAB_COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">العمر</label>
              <input
                type="number"
                min={13}
                max={99}
                value={age}
                onChange={(e) => setAge(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-sm text-white font-mono-num"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">النبذة الشخصية (Bio)</label>
            <textarea
              rows={2}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="اكتب نبذة مختصرة تعبر عنك..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-sm text-white resize-none"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="submit"
              disabled={saving || uploading}
              className={`w-full py-3 px-6 rounded-xl text-white font-bold text-sm transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer ${accentBtn}`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{saving ? 'جاري الحفظ...' : 'حفظ والدخول إلى الغرف'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
