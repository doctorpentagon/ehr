import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'sonner';
import Sidebar from './Sidebar';
import AlertBanner from '@/components/clinical/AlertBanner';
import TopBar from './TopBar';
import OfflineBanner from '@/components/ui/OfflineBanner';
import { logout } from '@/store/authSlice';
import DemoExampleGuide from './DemoExampleGuide';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — shared device safety
const IDLE_WARNING_MS = IDLE_TIMEOUT_MS - (2 * 60 * 1000);

class RouteErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) {
    // Never put clinical form state or patient data into this diagnostic line.
    console.error('Route failed to render', { route: this.props.route, message: error?.message });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section role="alert" className="mx-auto max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
        <h1 className="text-lg font-semibold text-gray-900">This page could not open</h1>
        <p className="mt-2 text-sm text-gray-700">The rest of Awibi EHR is still working. Try this page again or open another section.</p>
        <button type="button" onClick={() => this.setState({ failed: false })} className="mt-4 min-h-11 rounded-lg bg-[#335CF4] px-4 py-2 text-sm font-medium text-white">
          Try again
        </button>
      </section>
    );
  }
}

function RouteLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4 py-2">
      <span className="sr-only">Opening page</span>
      <div className="h-8 w-48 animate-pulse rounded-md bg-gray-200" />
      <div className="h-28 w-full animate-pulse rounded-xl bg-gray-100" />
      <div className="h-48 w-full animate-pulse rounded-xl bg-gray-100" />
    </div>
  );
}

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('awibi:sidebar-collapsed') === 'true');
  const dispatch = useDispatch();
  const { user } = useSelector((s) => s.auth);
  const isPlatformOperator = user?.role === 'SUPER_ADMIN';
  const navigate = useNavigate();
  const location = useLocation();
  const idleTimer = useRef(null);
  const idleWarningTimer = useRef(null);

  const resetTimer = useCallback(() => {
    clearTimeout(idleTimer.current);
    clearTimeout(idleWarningTimer.current);
    toast.dismiss('idle-warning');
    idleWarningTimer.current = setTimeout(() => {
      toast.warning('Your session will end in 2 minutes because there has been no activity.', {
        id: 'idle-warning',
        duration: 120000,
        action: { label: 'Stay signed in', onClick: resetTimer },
      });
    }, IDLE_WARNING_MS);
    idleTimer.current = setTimeout(async () => {
      await dispatch(logout());
      navigate('/login?reason=idle', { replace: true });
    }, IDLE_TIMEOUT_MS);
  }, [dispatch, navigate]);

  useEffect(() => {
    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      clearTimeout(idleTimer.current);
      clearTimeout(idleWarningTimer.current);
      toast.dismiss('idle-warning');
      events.forEach(e => window.removeEventListener(e, resetTimer));
    };
  }, [resetTimer]);

  const toggleDesktopSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      localStorage.setItem('awibi:sidebar-collapsed', String(next));
      return next;
    });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-[#1D4ED8] focus:shadow-lg">
        Skip to main content
      </a>
      <OfflineBanner />
      {/* Desktop sidebar */}
      <aside className={`hidden md:flex md:flex-col border-r border-sidebar-border bg-sidebar flex-shrink-0 transition-[width] duration-200 ${sidebarCollapsed ? 'md:w-20' : 'md:w-72'}`}>
        <Sidebar collapsed={sidebarCollapsed} />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-sidebar flex flex-col z-50 shadow-xl">
            <Sidebar onClose={() => setSidebarOpen(false)} collapsed={false} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          onSidebarToggle={toggleDesktopSidebar}
          sidebarCollapsed={sidebarCollapsed}
        />
        {/*
          One container for every authenticated page.
          Most pages previously set no padding at all, so their content ran to
          the window edge, and four set their own conflicting max-width. Putting
          the container here means every screen shares the same rhythm and no
          page has to remember to.

          Padding steps 16 / 24 / 32px; the width cap stops line lengths becoming
          unreadable on a wide monitor without wasting a 13-inch laptop screen.
        */}
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto">
          {/* overflow-x-hidden is the backstop: any single wide element that
              slips through still cannot make the whole page scroll sideways,
              which is the thing that makes an app feel broken on a phone.
              Tables opt back in with their own overflow-x-auto. */}
          <div className="mx-auto w-full max-w-350 overflow-x-hidden px-4 py-4 md:px-6 md:py-6 lg:px-8">
            <DemoExampleGuide />
            {/* Facility-wide clinical alerts, collapsed to one line unless
                opened — a banner that fills the screen daily stops being read. */}
            {!isPlatformOperator && <AlertBanner />}
            <RouteErrorBoundary key={location.pathname} route={location.pathname}>
              <React.Suspense fallback={<RouteLoading />}>
                <Outlet />
              </React.Suspense>
            </RouteErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
