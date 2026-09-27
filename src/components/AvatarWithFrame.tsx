import React, { useState } from 'react';

interface AvatarWithFrameProps {
  avatarUrl?: string;
  displayName: string;
  gender?: 'male' | 'female' | string;
  activeFrame?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showOnline?: boolean;
  isSpeaking?: boolean;
  className?: string;
  onClick?: () => void;
}

const SIZE_CLASSES = {
  xs: 'w-7 h-7 text-xs',
  sm: 'w-9 h-9 text-sm',
  md: 'w-11 h-11 text-base',
  lg: 'w-16 h-16 text-xl',
  xl: 'w-24 h-24 text-3xl'
};

export const AvatarWithFrame: React.FC<AvatarWithFrameProps> = ({
  avatarUrl,
  displayName,
  gender = 'male',
  activeFrame = '',
  size = 'md',
  showOnline = false,
  isSpeaking = false,
  className = '',
  onClick
}) => {
  const [imgError, setImgError] = useState(false);

  const isFemale = gender === 'female';
  // Gender visual identity accent: Blue for Male, Pink for Female
  const genderBorder = isFemale
    ? 'border-2 border-pink-400/80 shadow-[0_0_10px_rgba(244,114,182,0.25)]'
    : 'border-2 border-sky-400/80 shadow-[0_0_10px_rgba(56,189,248,0.25)]';

  const fallbackGradient = isFemale
    ? 'bg-gradient-to-br from-pink-600/40 via-rose-800/50 to-slate-900 text-pink-200'
    : 'bg-gradient-to-br from-sky-600/40 via-indigo-900/50 to-slate-900 text-sky-200';

  const initial = (displayName || 'م').trim().charAt(0).toUpperCase();

  return (
    <div
      onClick={onClick}
      className={`relative inline-flex items-center justify-center rounded-full shrink-0 select-none ${
        SIZE_CLASSES[size]
      } ${activeFrame || genderBorder} ${
        isSpeaking ? 'ring-4 ring-emerald-400/90 animate-pulse' : ''
      } ${onClick ? 'cursor-pointer hover:scale-105 transition-transform' : ''} ${className}`}
    >
      {avatarUrl && !imgError ? (
        <img
          src={avatarUrl}
          alt={displayName}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="w-full h-full object-cover rounded-full"
        />
      ) : (
        <div className={`w-full h-full rounded-full flex items-center justify-center font-bold ${fallbackGradient}`}>
          {initial}
        </div>
      )}

      {showOnline && (
        <span
          title="متصل الآن"
          className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0B0D13]"
        />
      )}
    </div>
  );
};
