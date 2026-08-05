import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useQuery } from '@tanstack/react-query';
import { IconMenu2, IconBell, IconSearch, IconChevronDown, IconLogout, IconUser, IconSettings } from '@tabler/icons-react';
import { Calendar, FlaskConical, AlertCircle, MessageCircle } from 'lucide-react';
import { format } from 'date-fns';
import { logout } from '@/store/authSlice';
import api from '@/lib/api';
import { roleLabel } from '@/lib/permissions';

export default function TopBar({ onMenuClick }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user } = useSelector((s) => s.auth);
  const [dropOpen, setDropOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchVal, setSearchVal] = useState('');
  const notifRef = useRef(null);

  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: apptData } = useQuery({
    queryKey: ['notif-appts'],
    queryFn: () => api.get('/appointments', { params: { date: today, limit: 5 } }).then(r => r.data),
    staleTime: 60000,
  });

  const { data: labData } = useQuery({
    queryKey: ['notif-lab'],
    queryFn: () => api.get('/lab', { params: { status: 'PENDING', limit: 5 } }).then(r => r.data),
    staleTime: 60000,
  });

  // Polled rather than pushed. A colleague waiting on an answer should not have
  // to wonder whether the other person has seen it, so the badge stays current
  // without needing a websocket the pilot does not have.
  const { data: messageCount } = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api.get('/messages/unread-count').then(r => r.data),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const todayAppts = (apptData?.appointments || apptData || []).filter(a => a.status === 'SCHEDULED' || a.status === 'CONFIRMED');
  const pendingLab = labData?.requests || labData || [];
  const totalUnread = todayAppts.length + pendingLab.filter(r => r.priority === 'STAT' || r.priority === 'URGENT').length;

  useEffect(() => {
    const handleClick = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSearch = (e) => {
    if (e.key === 'Enter' && searchVal.trim()) {
      navigate(`/dashboard/patients?q=${encodeURIComponent(searchVal.trim())}`);
      setSearchVal('');
    }
  };

  const handleLogout = async () => {
    setDropOpen(false);
    await dispatch(logout());
    navigate('/login', { replace: true });
  };

  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase() || 'U';

  return (
    <header className="bg-background border-b border-border px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
      {/* Mobile menu */}
      <button
        onClick={onMenuClick}
        className="md:hidden text-muted-foreground hover:text-foreground transition-colors"
      >
        <IconMenu2 className="size-6" />
      </button>

      {/* Search */}
      <div className="flex-1 max-w-md relative hidden sm:block">
        <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name, Hosp No or Patient ID…"
          value={searchVal}
          onChange={(e) => setSearchVal(e.target.value)}
          onKeyDown={handleSearch}
          className="w-full pl-9 pr-4 h-9 text-sm border border-input rounded-md bg-muted/40 focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 placeholder:text-muted-foreground"
        />
      </div>

      <div className="flex-1" />

      {/* Messages from colleagues. Separate from notifications because a person
          waiting on an answer is different from a system event. */}
      <button
        onClick={() => navigate('/dashboard/messages')}
        title={messageCount?.unread ? `${messageCount.unread} unread message${messageCount.unread === 1 ? '' : 's'}` : 'Messages'}
        className="relative text-muted-foreground hover:text-foreground transition-colors p-1.5"
      >
        <MessageCircle className="size-5" />
        {messageCount?.unread > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 min-w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white px-0.5 ${messageCount.urgent > 0 ? 'bg-red-600' : 'bg-blue-600'}`}>
            {messageCount.unread > 9 ? '9+' : messageCount.unread}
          </span>
        )}
      </button>

      {/* Notifications */}
      <div className="relative" ref={notifRef}>
        <button
          onClick={() => { setNotifOpen(o => !o); setDropOpen(false); }}
          className="relative text-muted-foreground hover:text-foreground transition-colors p-1.5"
        >
          <IconBell className="size-5" />
          {totalUnread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-[10px] font-bold text-white px-0.5">
              {totalUnread > 9 ? '9+' : totalUnread}
            </span>
          )}
        </button>

        {notifOpen && (
          <div className="absolute right-0 top-full mt-2 w-80 bg-popover rounded-xl shadow-xl border border-border z-20 overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/30">
              <h3 className="text-sm font-semibold text-foreground">Today's Activity</h3>
              <p className="text-xs text-muted-foreground">{format(new Date(), 'EEEE, d MMM yyyy')}</p>
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-border">
              {todayAppts.length === 0 && pendingLab.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No pending items for today
                </div>
              ) : (
                <>
                  {todayAppts.map(a => (
                    <button
                      key={a.id}
                      onClick={() => { setNotifOpen(false); navigate('/dashboard/appointments'); }}
                      className="w-full flex items-start gap-3 px-4 py-3 hover:bg-accent text-left transition-colors"
                    >
                      <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                        <Calendar size={14} className="text-[#2D5BFF]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">
                          {a.patient?.firstName} {a.patient?.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {a.scheduledAt ? format(new Date(a.scheduledAt), 'HH:mm') : ''} · {a.visitType?.replace(/_/g, ' ')}
                        </p>
                      </div>
                      <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">Appt</span>
                    </button>
                  ))}

                  {pendingLab.map(r => (
                    <button
                      key={r.id}
                      onClick={() => { setNotifOpen(false); navigate('/dashboard/lab'); }}
                      className="w-full flex items-start gap-3 px-4 py-3 hover:bg-accent text-left transition-colors"
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${r.priority === 'STAT' ? 'bg-red-50' : r.priority === 'URGENT' ? 'bg-orange-50' : 'bg-orange-50'}`}>
                        {r.priority === 'STAT' || r.priority === 'URGENT'
                          ? <AlertCircle size={14} className={r.priority === 'STAT' ? 'text-red-600' : 'text-orange-600'} />
                          : <FlaskConical size={14} className="text-orange-600" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{r.testName}</p>
                        <p className="text-xs text-muted-foreground">{r.patient?.firstName} {r.patient?.lastName}</p>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${r.priority === 'STAT' ? 'bg-red-100 text-red-700' : r.priority === 'URGENT' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}>
                        {r.priority}
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>

            <div className="border-t border-border px-4 py-2.5">
              <button
                onClick={() => { setNotifOpen(false); navigate('/dashboard/appointments'); }}
                className="text-xs text-[#2D5BFF] hover:underline"
              >
                View all appointments →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* User dropdown */}
      <div className="relative">
        <button
          onClick={() => { setDropOpen((o) => !o); setNotifOpen(false); }}
          className="flex items-center gap-2 hover:bg-muted rounded-md px-2 py-1.5 transition-colors"
        >
          <div className="size-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-semibold shrink-0">
            {initials}
          </div>
          <div className="hidden sm:block text-left">
            <p className="text-sm font-medium text-foreground leading-tight">
              {user?.firstName} {user?.lastName}
            </p>
            {/* `capitalize` did nothing here: the value is already all-caps, so a
                lab scientist read "CLINICIAN". Use the same wording as sign-in. */}
            <p className="text-xs text-muted-foreground leading-tight">{roleLabel(user?.role, user?.subRole)}</p>
          </div>
          <IconChevronDown className="size-3.5 text-muted-foreground hidden sm:block" />
        </button>

        {dropOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setDropOpen(false)} />
            <div className="absolute right-0 top-full mt-2 w-48 bg-popover rounded-lg shadow-lg border border-border py-1 z-20">
              <button
                onClick={() => { navigate('/dashboard/settings'); setDropOpen(false); }}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-foreground hover:bg-accent transition-colors"
              >
                <IconUser className="size-4" /> Profile
              </button>
              <button
                onClick={() => { navigate('/dashboard/settings'); setDropOpen(false); }}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-foreground hover:bg-accent transition-colors"
              >
                <IconSettings className="size-4" /> Settings
              </button>
              <div className="border-t border-border my-1" />
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <IconLogout className="size-4" /> Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
