import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import Sidebar from './Sidebar';
import AlertBanner from '@/components/clinical/AlertBanner';
import TopBar from './TopBar';
import OfflineBanner from '@/components/ui/OfflineBanner';
import { logout } from '@/store/authSlice';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — shared device safety

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const idleTimer = useRef(null);

  const resetTimer = useCallback(() => {
    clearTimeout(idleTimer.current);
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
      events.forEach(e => window.removeEventListener(e, resetTimer));
    };
  }, [resetTimer]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <OfflineBanner />
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-72 border-r border-sidebar-border bg-sidebar flex-shrink-0">
        <Sidebar />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-sidebar flex flex-col z-50 shadow-xl">
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        {/*
          One container for every authenticated page.
          Most pages previously set no padding at all, so their content ran to
          the window edge, and four set their own conflicting max-width. Putting
          the container here means every screen shares the same rhythm and no
          page has to remember to.

          Padding steps 16 / 24 / 32px; the width cap stops line lengths becoming
          unreadable on a wide monitor without wasting a 13-inch laptop screen.
        */}
        <main className="flex-1 overflow-y-auto">
          {/* overflow-x-hidden is the backstop: any single wide element that
              slips through still cannot make the whole page scroll sideways,
              which is the thing that makes an app feel broken on a phone.
              Tables opt back in with their own overflow-x-auto. */}
          <div className="mx-auto w-full max-w-350 overflow-x-hidden px-4 py-4 md:px-6 md:py-6 lg:px-8">
            {/* Facility-wide clinical alerts, collapsed to one line unless
                opened — a banner that fills the screen daily stops being read. */}
            <AlertBanner />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
