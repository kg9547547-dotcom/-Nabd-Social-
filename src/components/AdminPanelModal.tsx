import React, { useEffect, useState } from 'react';
import {
  X,
  Shield,
  Users,
  Crown,
  Flag,
  Coins,
  BarChart3,
  Settings,
  Search,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { apiFetch } from '../services/api';

const RBAC_PERMISSION_COLUMNS = [
  { key: 'can_manage_users', camel: 'canManageUsers', label: 'إدارة المستخدمين' },
  { key: 'can_manage_roles', camel: 'canManageRoles', label: 'إدارة الرتب' },
  { key: 'can_manage_rooms', camel: 'canManageRooms', label: 'إدارة الغرف' },
  { key: 'can_moderate_chat', camel: 'canModerateChat', label: 'إشراف الدردشة' },
  { key: 'can_manage_live', camel: 'canManageLive', label: 'إدارة البثوث' },
  { key: 'can_manage_economy', camel: 'canManageEconomy', label: 'إدارة الاقتصاد' },
  { key: 'can_view_reports', camel: 'canViewReports', label: 'مراجعة البلاغات' },
  { key: 'can_access_admin', camel: 'canAccessAdmin', label: 'دخول لوحة الإدارة' }
] as const;

export const AdminPanelModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { user, addToast, refreshUser } = useApp();
  const [tab, setTab] = useState<
    'dashboard' | 'users' | 'roles' | 'reports' | 'economy' | 'settings'
  >('dashboard');
  const [data, setData] = useState<any>(null);
  const [searchUser, setSearchUser] = useState('');
  const [selectedUserForEcon, setSelectedUserForEcon] = useState<string>('');
  const [goldDelta, setGoldDelta] = useState(100);
  const [gemsDelta, setGemsDelta] = useState(10);
  const [xpDelta, setXpDelta] = useState(50);

  // Store item creation
  const [newItemName, setNewItemName] = useState('');
  const [newItemDesc, setNewItemDesc] = useState('');
  const [newItemType, setNewItemType] = useState('badge');
  const [newItemCurrency, setNewItemCurrency] = useState('gold');
  const [newItemPrice, setNewItemPrice] = useState(200);
  const [newItemCss, setNewItemCss] = useState('🌟 وسام خاص');

  const loadAdminOverview = async () => {
    try {
      const res = await apiFetch('/api/admin/overview');
      setData(res);
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  useEffect(() => {
    loadAdminOverview();
  }, []);

  if (!data) {
    return (
      <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl p-8 text-sm font-bold text-slate-700 dark:text-slate-200 shadow-2xl">
          جاري تحميل لوحة الإدارة...
        </div>
      </div>
    );
  }

  const handleUserAction = async (targetUserId: string, action: string, extra: any = {}) => {
    try {
      await apiFetch('/api/admin/users/action', {
        method: 'POST',
        body: JSON.stringify({ targetUserId, action, ...extra })
      });
      addToast('تم تنفيذ الإجراء الإداري بنجاح', 'success');
      loadAdminOverview();
      refreshUser();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleToggleRolePermission = async (roleObj: any, camelKey: string, checked: boolean) => {
    const updated = {
      badgeLabel: roleObj.badge_label,
      canManageUsers: Boolean(roleObj.can_manage_users),
      canManageRoles: Boolean(roleObj.can_manage_roles),
      canManageRooms: Boolean(roleObj.can_manage_rooms),
      canModerateChat: Boolean(roleObj.can_moderate_chat),
      canManageLive: Boolean(roleObj.can_manage_live),
      canManageEconomy: Boolean(roleObj.can_manage_economy),
      canViewReports: Boolean(roleObj.can_view_reports),
      canAccessAdmin: Boolean(roleObj.can_access_admin),
      [camelKey]: checked
    };
    try {
      await apiFetch(`/api/admin/roles/${roleObj.role_name}`, {
        method: 'PUT',
        body: JSON.stringify(updated)
      });
      loadAdminOverview();
      addToast(`تم تحديث صلاحيات رتبة ${roleObj.role_name}`, 'success');
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleCreateStoreItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/store/item', {
        method: 'POST',
        body: JSON.stringify({
          name: newItemName,
          description: newItemDesc,
          itemType: newItemType,
          currency: newItemCurrency,
          price: newItemPrice,
          cssValue: newItemCss
        })
      });
      addToast('تمت إضافة العنصر إلى المتجر بنجاح!', 'success');
      setNewItemName('');
      setNewItemDesc('');
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(data.settings)
      });
      addToast('تم حفظ إعدادات النظام بنجاح', 'success');
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const filteredUsers = (data.users || []).filter(
    (u: any) =>
      u.display_name.toLowerCase().includes(searchUser.toLowerCase()) ||
      u.username.toLowerCase().includes(searchUser.toLowerCase())
  );

  const navTabs = [
    { id: 'dashboard', label: 'الإحصائيات والملخص', icon: BarChart3 },
    { id: 'users', label: 'إدارة المستخدمين', icon: Users },
    { id: 'roles', label: 'الرتب والصلاحيات', icon: Crown },
    { id: 'reports', label: `البلاغات (${data.stats?.pendingReports || 0})`, icon: Flag },
    { id: 'economy', label: 'الاقتصاد والمتجر', icon: Coins },
    { id: 'settings', label: 'إعدادات المنصة', icon: Settings }
  ] as const;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4">
      <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/15 rounded-2xl sm:rounded-3xl max-w-6xl w-full h-[94dvh] sm:h-[90vh] flex flex-col overflow-hidden shadow-2xl transition-colors">
        {/* Header */}
        <div className="px-4 py-3.5 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-amber-500 dark:text-amber-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white font-display leading-normal truncate">
                لوحة الإدارة والتحكم الشامل
              </h2>
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 leading-normal">
                رتبتك الحالية: <span className="text-indigo-600 dark:text-amber-300">{user?.role}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer shrink-0 transition-colors"
            title="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mobile Top Tabs Bar (visible on < md) */}
        <div className="md:hidden bg-white dark:bg-slate-950/90 border-b border-slate-200 dark:border-white/10 px-3 py-2 flex items-center gap-1.5 overflow-x-auto shrink-0">
          {navTabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Desktop Sidebar Navigation (md+) */}
          <aside className="hidden md:flex md:flex-col w-56 bg-white dark:bg-slate-950/80 border-l border-slate-200 dark:border-white/10 p-3 space-y-1.5 overflow-y-auto shrink-0">
            {navTabs.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 leading-normal transition-colors cursor-pointer ${
                    active
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </aside>

          {/* Main Tab Viewport */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-6">
            {/* ==============================================================
                TAB 1: DASHBOARD METRICS
               ============================================================== */}
            {tab === 'dashboard' && (
              <div className="space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white leading-normal">
                    إحصائيات المنصة الحقيقية (Real-Time Database Metrics)
                  </h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                  {[
                    { label: 'إجمالي الحسابات', val: data.stats.totalUsers },
                    { label: 'المتصلون الآن فعلياً', val: data.stats.onlineNow },
                    { label: 'عدد الغرف', val: data.stats.totalRooms },
                    { label: 'رسائل الغرف', val: data.stats.totalMessages },
                    { label: 'المحادثات الخاصة', val: data.stats.totalPrivateMessages },
                    { label: 'البثوث المباشرة النشطة', val: data.stats.activeLives },
                    { label: 'القصص النشطة (24h)', val: data.stats.totalStories },
                    { label: 'فيديوهات الريلز', val: data.stats.totalReels },
                    { label: 'إجمالي عمليات الإهداء', val: data.stats.totalGiftTx },
                    { label: 'الذهب المتداول (Gold)', val: data.stats.totalGoldCirculating },
                    { label: 'الماس المتداول (Gems)', val: data.stats.totalGemsCirculating },
                    { label: 'البلاغات قيد المراجعة', val: data.stats.pendingReports }
                  ].map((s, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 flex flex-col justify-between gap-1.5 shadow-xs"
                    >
                      <div className="text-xs font-bold text-slate-500 dark:text-slate-400 leading-normal">
                        {s.label}
                      </div>
                      <div className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white font-mono-num leading-normal">
                        {Number(s.val || 0).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ==============================================================
                TAB 2: USERS MANAGEMENT
               ============================================================== */}
            {tab === 'users' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white leading-normal">
                    إدارة المستخدمين، الرتب، والعقوبات
                  </h3>
                  <div className="relative w-full sm:w-72">
                    <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5 pointer-events-none" />
                    <input
                      type="text"
                      value={searchUser}
                      onChange={(e) => setSearchUser(e.target.value)}
                      placeholder="بحث بالاسم أو اسم المستخدم..."
                      className="w-full pr-9 pl-3.5 py-2 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950/60 shadow-xs">
                  <table className="w-full table-auto text-right text-xs border-collapse min-w-[680px]">
                    <thead className="bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-white/10">
                      <tr>
                        <th className="p-3.5 font-extrabold whitespace-nowrap leading-normal">المستخدم</th>
                        <th className="p-3.5 font-extrabold whitespace-nowrap leading-normal">الرتبة</th>
                        <th className="p-3.5 font-extrabold whitespace-nowrap leading-normal">المستوى / الرصيد</th>
                        <th className="p-3.5 font-extrabold whitespace-nowrap leading-normal">الحالة</th>
                        <th className="p-3.5 font-extrabold whitespace-nowrap leading-normal">إجراءات الإدارة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                      {filteredUsers.map((u: any) => (
                        <tr
                          key={u.id}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="p-3.5 whitespace-nowrap">
                            <div className="font-extrabold text-slate-900 dark:text-white leading-normal">
                              {u.display_name}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
                              @{u.username}
                            </div>
                          </td>
                          <td className="p-3.5 whitespace-nowrap">
                            <select
                              value={u.role}
                              onChange={(e) =>
                                handleUserAction(u.id, 'set_role', { roleName: e.target.value })
                              }
                              className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-xs font-bold text-slate-900 dark:text-white"
                            >
                              {[
                                'Owner',
                                'Super Admin',
                                'Admin',
                                'Moderator',
                                'Room Moderator',
                                'VIP',
                                'Member',
                                'Guest'
                              ].map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-3.5 font-mono-num text-[11px] whitespace-nowrap leading-normal">
                            <div className="font-bold text-slate-800 dark:text-slate-200">
                              Lv.{u.level} ({u.xp} XP)
                            </div>
                            <div className="text-amber-600 dark:text-amber-300 font-bold">
                              🪙 {u.gold} · 💎 {u.gems}
                            </div>
                          </td>
                          <td className="p-3.5 whitespace-nowrap">
                            {u.is_banned ? (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 font-bold text-[11px]">
                                محظور
                              </span>
                            ) : u.is_muted ? (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold text-[11px]">
                                مكتوم
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold text-[11px]">
                                نشط
                              </span>
                            )}
                          </td>
                          <td className="p-3.5 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {u.is_muted ? (
                                <button
                                  type="button"
                                  onClick={() => handleUserAction(u.id, 'unmute')}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 font-bold cursor-pointer"
                                >
                                  فك الكتم
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleUserAction(u.id, 'mute', { durationHours: 12 })}
                                  className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 font-bold cursor-pointer"
                                >
                                  كتم
                                </button>
                              )}

                              {u.is_banned ? (
                                <button
                                  type="button"
                                  onClick={() => handleUserAction(u.id, 'unban')}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
                                >
                                  رفع الحظر
                                </button>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUserAction(u.id, 'temp_ban', {
                                        durationHours: 24,
                                        reason: 'مخالفة قواعد الدردشة (حظر 24 ساعة)'
                                      })
                                    }
                                    className="px-2.5 py-1.5 rounded-lg bg-rose-600/15 text-rose-700 dark:text-rose-300 font-bold cursor-pointer"
                                  >
                                    حظر مؤقت
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUserAction(u.id, 'perm_ban', {
                                        reason: 'حظر نهائي من الإدارة'
                                      })
                                    }
                                    className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white font-bold cursor-pointer"
                                  >
                                    حظر دائم
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ==============================================================
                TAB 3: ROLES & RBAC MATRIX (FIXED TYPOGRAPHY & OVERFLOW)
               ============================================================== */}
            {tab === 'roles' && (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white leading-normal">
                    مصفوفة الرتب والصلاحيات (Server-Side RBAC Matrix)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
                    تحكم كامل في صلاحيات كل رتبة على مستوى الخادم مع حفظ فوري.
                  </p>
                </div>

                {/* Responsive Scrollable RBAC Table (`table-auto` + `overflow-x-auto`) */}
                <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950 shadow-xs">
                  <table className="w-full table-auto text-right text-xs border-collapse min-w-[760px]">
                    <thead className="bg-slate-100 dark:bg-slate-900/90 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-white/10">
                      <tr>
                        <th className="p-3.5 font-extrabold whitespace-nowrap leading-normal">الرتبة والوسام</th>
                        <th className="p-3.5 font-extrabold whitespace-nowrap leading-normal text-center">
                          القوة (Rank)
                        </th>
                        {RBAC_PERMISSION_COLUMNS.map((col) => (
                          <th
                            key={col.key}
                            className="p-3 font-extrabold whitespace-nowrap leading-normal text-center"
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                      {(data.roles || []).map((r: any) => (
                        <tr
                          key={r.role_name}
                          className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
                        >
                          <td className="p-3.5 whitespace-nowrap">
                            <div className="flex flex-col gap-1">
                              <span className="text-xs font-extrabold text-slate-900 dark:text-white leading-normal">
                                {r.role_name}
                              </span>
                              <span className="inline-flex items-center self-start px-2 py-0.5 rounded-md bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold leading-normal">
                                {r.badge_label}
                              </span>
                            </div>
                          </td>
                          <td className="p-3.5 text-center whitespace-nowrap font-mono-num font-extrabold text-slate-700 dark:text-slate-300">
                            {r.rank_order}
                          </td>
                          {RBAC_PERMISSION_COLUMNS.map((perm) => (
                            <td key={perm.key} className="p-3 text-center whitespace-nowrap">
                              <input
                                type="checkbox"
                                disabled={r.role_name === 'Owner'}
                                checked={Boolean(r[perm.key])}
                                onChange={(e) =>
                                  handleToggleRolePermission(r, perm.camel, e.target.checked)
                                }
                                className="w-4 h-4 rounded accent-indigo-600 cursor-pointer disabled:opacity-50"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Role Cards Grid (`flex-col` + `gap-3` + `leading-normal` for effortless mobile editing) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(data.roles || []).map((r: any) => (
                    <div
                      key={r.role_name}
                      className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 flex flex-col gap-3.5 shadow-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100 dark:border-white/10">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-extrabold text-slate-900 dark:text-white leading-normal">
                            {r.role_name}
                          </span>
                          <span className="px-2.5 py-0.5 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 text-xs font-bold leading-normal">
                            {r.badge_label}
                          </span>
                        </div>
                        <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-900 text-xs font-bold text-slate-600 dark:text-slate-400 font-mono-num leading-normal">
                          قوة الرتبة: {r.rank_order}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                        {RBAC_PERMISSION_COLUMNS.map((perm) => {
                          const isChecked = Boolean(r[perm.key]);
                          return (
                            <label
                              key={perm.key}
                              className={`px-3 py-2.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-colors leading-normal ${
                                isChecked
                                  ? 'bg-indigo-50/70 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-500/30 text-slate-900 dark:text-slate-100 font-bold'
                                  : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200/70 dark:border-white/5 text-slate-600 dark:text-slate-400'
                              }`}
                            >
                              <span className="leading-normal">{perm.label}</span>
                              <input
                                type="checkbox"
                                disabled={r.role_name === 'Owner'}
                                checked={isChecked}
                                onChange={(e) =>
                                  handleToggleRolePermission(r, perm.camel, e.target.checked)
                                }
                                className="w-4 h-4 rounded accent-indigo-600 shrink-0 cursor-pointer disabled:opacity-50"
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ==============================================================
                TAB 4: REPORTS CENTER
               ============================================================== */}
            {tab === 'reports' && (
              <div className="space-y-4">
                <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white leading-normal">
                  مركز البلاغات والمخالفات
                </h3>
                {(data.reports || []).length === 0 ? (
                  <div className="p-8 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-center text-xs text-slate-500">
                    لا توجد بلاغات مسجلة حتى الآن.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {data.reports.map((rep: any) => (
                      <div
                        key={rep.id}
                        className="p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs"
                      >
                        <div className="space-y-1.5 text-xs leading-normal">
                          <div className="font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                            <span>
                              بلاغ عن ({rep.target_type}) — السبب: {rep.reason}
                            </span>
                          </div>
                          <div className="text-slate-500 dark:text-slate-400">
                            مقدم البلاغ: {rep.reporter_name} · المعرّف المستهدف: {rep.target_id}
                          </div>
                          {rep.details && (
                            <p className="text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-white/5">
                              {rep.details}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {rep.status === 'pending' ? (
                            <>
                              <button
                                type="button"
                                onClick={async () => {
                                  await apiFetch(`/api/admin/reports/${rep.id}/resolve`, {
                                    method: 'POST',
                                    body: JSON.stringify({
                                      status: 'resolved',
                                      resolutionNote: 'تمت المعالجة'
                                    })
                                  });
                                  loadAdminOverview();
                                  addToast('تم إغلاق البلاغ كـ تمت المعالجة', 'success');
                                }}
                                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                              >
                                تمت المعالجة
                              </button>
                              {rep.target_type === 'user' && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUserAction(rep.target_id, 'temp_ban', {
                                      durationHours: 24,
                                      reason: rep.reason
                                    })
                                  }
                                  className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
                                >
                                  حظر المستهدف 24h
                                </button>
                              )}
                            </>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                              <CheckCircle2 className="w-4 h-4" />
                              <span>محلول ({rep.resolved_by})</span>
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ==============================================================
                TAB 5: ECONOMY & STORE
               ============================================================== */}
            {tab === 'economy' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Economy Grant / Deduct */}
                <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 flex flex-col gap-4 shadow-xs">
                  <h4 className="text-sm font-extrabold text-slate-900 dark:text-white leading-normal">
                    تعديل أرصدة المستخدمين (Gold / Gems / XP)
                  </h4>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5 leading-normal">
                      اختر المستخدم
                    </label>
                    <select
                      value={selectedUserForEcon}
                      onChange={(e) => setSelectedUserForEcon(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-900 dark:text-white"
                    >
                      <option value="">-- اختر مستخدماً --</option>
                      {(data.users || []).map((u: any) => (
                        <option key={u.id} value={u.id}>
                          {u.display_name} (@{u.username})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1 leading-normal">
                        فرق الذهب (Gold)
                      </label>
                      <input
                        type="number"
                        value={goldDelta}
                        onChange={(e) => setGoldDelta(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1 leading-normal">
                        فرق الماس (Gems)
                      </label>
                      <input
                        type="number"
                        value={gemsDelta}
                        onChange={(e) => setGemsDelta(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1 leading-normal">
                        فرق الخبرة (XP)
                      </label>
                      <input
                        type="number"
                        value={xpDelta}
                        onChange={(e) => setXpDelta(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white font-mono-num"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!selectedUserForEcon}
                    onClick={() =>
                      handleUserAction(selectedUserForEcon, 'economy_adjust', {
                        goldDelta,
                        gemsDelta,
                        xpDelta
                      })
                    }
                    className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-extrabold cursor-pointer transition-colors"
                  >
                    تطبيق التعديل المالي
                  </button>
                </div>

                {/* Add New Store Item */}
                <form
                  onSubmit={handleCreateStoreItem}
                  className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 flex flex-col gap-3.5 shadow-xs"
                >
                  <h4 className="text-sm font-extrabold text-slate-900 dark:text-white leading-normal">
                    إضافة عنصر جديد إلى المتجر
                  </h4>
                  <input
                    type="text"
                    required
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    placeholder="اسم العنصر (مثال: وسام الصقر الذهبي)"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
                  />
                  <input
                    type="text"
                    required
                    value={newItemDesc}
                    onChange={(e) => setNewItemDesc(e.target.value)}
                    placeholder="وصف العنصر"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <select
                      value={newItemType}
                      onChange={(e) => setNewItemType(e.target.value)}
                      className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-900 dark:text-white"
                    >
                      <option value="badge">وسام (Badge)</option>
                      <option value="name_color">لون اسم</option>
                      <option value="frame">إطار</option>
                    </select>
                    <select
                      value={newItemCurrency}
                      onChange={(e) => setNewItemCurrency(e.target.value)}
                      className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-900 dark:text-white"
                    >
                      <option value="gold">Gold</option>
                      <option value="gems">Gems</option>
                    </select>
                    <input
                      type="number"
                      value={newItemPrice}
                      onChange={(e) => setNewItemPrice(Number(e.target.value))}
                      className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white font-mono-num"
                    />
                  </div>
                  <input
                    type="text"
                    required
                    value={newItemCss}
                    onChange={(e) => setNewItemCss(e.target.value)}
                    placeholder="القيمة أو نص الوسام (مثال: 🦅 صقر العرب أو #FBBF24)"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
                  />
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-extrabold cursor-pointer transition-colors"
                  >
                    إضافة للمتجر
                  </button>
                </form>
              </div>
            )}

            {/* ==============================================================
                TAB 6: PLATFORM SETTINGS
               ============================================================== */}
            {tab === 'settings' && (
              <form
                onSubmit={handleSaveSettings}
                className="max-w-xl p-4 sm:p-6 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 flex flex-col gap-4 shadow-xs"
              >
                <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white leading-normal">
                  إعدادات المنصة العامة
                </h3>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5 leading-normal">
                    اسم المنصة
                  </label>
                  <input
                    type="text"
                    value={data.settings?.platform_name || ''}
                    onChange={(e) =>
                      setData({
                        ...data,
                        settings: { ...data.settings, platform_name: e.target.value }
                      })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5 leading-normal">
                    رسالة الإعلان العام في الغرف
                  </label>
                  <input
                    type="text"
                    value={data.settings?.announcement_banner || ''}
                    onChange={(e) =>
                      setData({
                        ...data,
                        settings: { ...data.settings, announcement_banner: e.target.value }
                      })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5 leading-normal">
                      عدد الرسائل لكل +1 Gold
                    </label>
                    <input
                      type="number"
                      value={data.settings?.messages_per_gold || '20'}
                      onChange={(e) =>
                        setData({
                          ...data,
                          settings: { ...data.settings, messages_per_gold: e.target.value }
                        })
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5 leading-normal">
                      مكافأة الذهب اليومية
                    </label>
                    <input
                      type="number"
                      value={data.settings?.daily_gold_reward || '25'}
                      onChange={(e) =>
                        setData({
                          ...data,
                          settings: { ...data.settings, daily_gold_reward: e.target.value }
                        })
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white font-mono-num"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="self-start px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-extrabold cursor-pointer transition-colors"
                >
                  حفظ إعدادات المنصة
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
