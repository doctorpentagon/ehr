import React from 'react';
import { NavLink } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { IconHome, IconUsers, IconCalendar, IconFileText, IconFlask } from '@tabler/icons-react';

const MOBILE_ITEMS = [
  { key: 'overview',     label: 'Home',     icon: IconHome,     path: '/dashboard' },
  { key: 'patients',     label: 'Patients', icon: IconUsers,    path: '/dashboard/patients' },
  { key: 'appointments', label: 'Appts',    icon: IconCalendar, path: '/dashboard/appointments' },
  { key: 'cases',        label: 'Cases',    icon: IconFileText, path: '/dashboard/cases' },
  { key: 'lab',          label: 'Lab',      icon: IconFlask,    path: '/dashboard/lab' },
];

export default function MobileNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 bg-background border-t border-border flex items-center justify-around px-2 py-1 z-30">
      {MOBILE_ITEMS.map(({ key, label, icon: Icon, path }) => (
        <NavLink
          key={key}
          to={path}
          end={path === '/dashboard'}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors ${
              isActive ? 'text-primary' : 'text-muted-foreground'
            }`
          }
        >
          <Icon className="size-5" />
          <span className="text-xs font-medium">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
