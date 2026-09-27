import React, { useState } from 'react';
import { AppProvider, useApp } from './contexts/AppContext';
import { LandingPage } from './components/LandingPage';
import { ProfileSetupModal } from './components/ProfileSetupModal';
import { ChatRoomView } from './components/ChatRoomView';
import { LiveStreamPage } from './components/LiveStreamPage';
import {
  PrivateMessagesModal,
  StoriesModal,
  ReelsModal,
  WallModal,
  RankingsModal,
  StoreModal,
  UserProfileModal,
  SendGiftModal,
  ReportModal
} from './components/SocialModals';
import { AdminPanelModal } from './components/AdminPanelModal';
import { AvatarWithFrame } from './components/AvatarWithFrame';

const MainRouter: React.FC = () => {
  const { user, loadingAuth, activeGiftAnimation, toasts, removeToast } = useApp();
  const [currentView, setCurrentView] = useState<'rooms' | 'live'>('rooms');
  const [activeModal, setActiveModal] = useState<
    'pm' | 'friends' | 'stories' | 'reels' | 'wall' | 'rankings' | 'store' | 'admin' | null
  >(null);
  const [pmPartnerId, setPmPartnerId] = useState<string | null>(null);
  const [profileTargetId, setProfileTargetId] = useState<string | null>(null);
  const [giftTarget, setGiftTarget] = useState<{
    receiverId: string;
    receiverName: string;
    contextType: 'room' | 'live';
    contextId: string;
  } | null>(null);
  const [reportTarget, setReportTarget] = useState<{ targetType: string; targetId: string } | null>(null);

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B0D13] text-slate-800 dark:text-slate-200 flex items-center justify-center transition-colors">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mx-auto" />
          <p className="text-xs text-slate-500 dark:text-slate-400">جاري تحميل منصة نبض المجالس...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Global Toast Notifications */}
      <div className="fixed bottom-16 right-4 z-[80] flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => removeToast(t.id)}
            className={`pointer-events-auto px-4 py-3 rounded-2xl border text-xs font-bold shadow-2xl backdrop-blur-xl cursor-pointer transition-all ${
              t.type === 'error'
                ? 'bg-rose-600 dark:bg-rose-950/90 border-rose-500/40 text-white dark:text-rose-200'
                : t.type === 'reward'
                ? 'bg-amber-500 dark:bg-amber-950/90 border-amber-400/50 text-slate-950 dark:text-amber-200'
                : t.type === 'success'
                ? 'bg-emerald-600 dark:bg-emerald-950/90 border-emerald-500/40 text-white dark:text-emerald-200'
                : 'bg-white/95 dark:bg-slate-900/95 border-slate-200 dark:border-white/15 text-slate-900 dark:text-slate-100'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>

      {/* Global Gift Animation Overlay (Lightweight GPU transform/opacity) */}
      {activeGiftAnimation && (
        <div className="fixed top-20 inset-x-0 z-[75] flex justify-center pointer-events-none px-4">
          <div
            className={`px-6 py-4 rounded-3xl bg-gradient-to-r ${activeGiftAnimation.effectClass} border-2 backdrop-blur-xl shadow-2xl flex items-center gap-4 animate-bounce`}
          >
            <span className="text-4xl sm:text-5xl">{activeGiftAnimation.giftEmoji}</span>
            <div>
              <div className="text-xs sm:text-sm font-extrabold text-white">
                {activeGiftAnimation.senderName} أرسل هدية{' '}
                <span className="text-amber-300">{activeGiftAnimation.giftName}</span> إلى{' '}
                {activeGiftAnimation.receiverName}!
              </div>
              <div className="text-[11px] font-bold text-emerald-300 font-mono-num mt-0.5">
                +{activeGiftAnimation.barPower.toLocaleString()} نقطة دعم في الشريط ⚡
              </div>
            </div>
            <AvatarWithFrame
              avatarUrl={activeGiftAnimation.senderAvatar}
              displayName={activeGiftAnimation.senderName}
              size="sm"
            />
          </div>
        </div>
      )}

      {!user ? (
        <LandingPage />
      ) : (
        <>
          {/* Post-Registration Profile Setup Modal */}
          {user.profile_completed === 0 && (
            <ProfileSetupModal onCompleted={() => {}} />
          )}

          {/* Main Active View: Chat Rooms OR Live Audio Streaming */}
          {currentView === 'live' ? (
            <LiveStreamPage
              onBackToRooms={() => setCurrentView('rooms')}
              onOpenProfile={(uid) => setProfileTargetId(uid)}
            />
          ) : (
            <ChatRoomView
              onNavigateLive={() => setCurrentView('live')}
              onOpenModal={(modal, extraUid) => {
                if (modal === 'pm' && extraUid) {
                  setPmPartnerId(extraUid);
                } else {
                  setPmPartnerId(null);
                }
                setActiveModal(modal);
              }}
              onOpenProfile={(uid) => setProfileTargetId(uid)}
              onOpenGift={(receiverId, receiverName, roomId) =>
                setGiftTarget({
                  receiverId,
                  receiverName,
                  contextType: 'room',
                  contextId: roomId
                })
              }
              onOpenReport={(targetType, targetId) => setReportTarget({ targetType, targetId })}
            />
          )}

          {/* Modals & Slide-overs */}
          {(activeModal === 'pm' || activeModal === 'friends') && (
            <PrivateMessagesModal
              initialPartnerId={pmPartnerId}
              initialTab={activeModal === 'friends' ? 'friends' : 'chats'}
              onClose={() => {
                setActiveModal(null);
                setPmPartnerId(null);
              }}
              onOpenProfile={(uid) => setProfileTargetId(uid)}
            />
          )}

          {activeModal === 'stories' && <StoriesModal onClose={() => setActiveModal(null)} />}

          {activeModal === 'reels' && (
            <ReelsModal
              onClose={() => setActiveModal(null)}
              onOpenProfile={(uid) => setProfileTargetId(uid)}
            />
          )}

          {activeModal === 'wall' && (
            <WallModal
              onClose={() => setActiveModal(null)}
              onOpenProfile={(uid) => setProfileTargetId(uid)}
            />
          )}

          {activeModal === 'rankings' && (
            <RankingsModal
              onClose={() => setActiveModal(null)}
              onOpenProfile={(uid) => setProfileTargetId(uid)}
            />
          )}

          {activeModal === 'store' && <StoreModal onClose={() => setActiveModal(null)} />}

          {activeModal === 'admin' && <AdminPanelModal onClose={() => setActiveModal(null)} />}

          {profileTargetId && (
            <UserProfileModal
              targetUserId={profileTargetId}
              onClose={() => setProfileTargetId(null)}
              onStartPrivateChat={(partnerId) => {
                setProfileTargetId(null);
                setPmPartnerId(partnerId);
                setActiveModal('pm');
              }}
              onOpenSendGift={(receiverId, receiverName) => {
                setProfileTargetId(null);
                setGiftTarget({
                  receiverId,
                  receiverName,
                  contextType: 'room',
                  contextId: 'room-general'
                });
              }}
              onOpenReport={(targetType, targetId) => {
                setProfileTargetId(null);
                setReportTarget({ targetType, targetId });
              }}
            />
          )}

          {giftTarget && (
            <SendGiftModal
              receiverId={giftTarget.receiverId}
              receiverName={giftTarget.receiverName}
              contextType={giftTarget.contextType}
              contextId={giftTarget.contextId}
              onClose={() => setGiftTarget(null)}
            />
          )}

          {reportTarget && (
            <ReportModal
              targetType={reportTarget.targetType}
              targetId={reportTarget.targetId}
              onClose={() => setReportTarget(null)}
            />
          )}
        </>
      )}
    </>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainRouter />
    </AppProvider>
  );
}
