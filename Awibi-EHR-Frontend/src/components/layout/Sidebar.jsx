import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  IconHome, IconCalendar, IconUsers, IconFileText,
  IconFlask, IconBed, IconBuilding, IconUserCog,
  IconReceipt, IconChartBar, IconCreditCard, IconSettings,
  IconHelp, IconLogout, IconBuildingHospital, IconX,
  IconBuildingSkyscraper, IconLock, IconLayoutDashboard,
  IconActivityHeartbeat, IconPill, IconClipboardList,
  IconAlertTriangle, IconCalendarCheck, IconListCheck, IconUsersGroup, IconShieldCheck,
} from '@tabler/icons-react';
import { logout } from '@/store/authSlice';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo.png';
import { NAV_ITEMS, can, roleLabel } from '@/lib/permissions';

const ICON_MAP = {
  LayoutDashboard:    IconLayoutDashboard,
  Users:              IconUsers,
  Calendar:           IconCalendar,
  FileText:           IconFileText,
  FlaskConical:       IconFlask,
  BedDouble:          IconBed,
  Building2:          IconBuilding,
  UserCog:            IconUserCog,
  BuildingSkyscraper: IconBuildingSkyscraper,
  Receipt:            IconReceipt,
  BarChart3:          IconChartBar,
  CreditCard:         IconCreditCard,
  Settings:           IconSettings,
  HelpCircle:         IconHelp,
  Activity:           IconActivityHeartbeat,
  Pill:               IconPill,
  ClipboardList:      IconClipboardList,
  AlertTriangle:      IconAlertTriangle,
  CalendarCheck:      IconCalendarCheck,
  ListChecks:         IconListCheck,
  Users2:             IconUsersGroup,
  ShieldCheck:        IconShieldCheck,
};

const SECTIONS = ['General', 'Clinical', 'Nursing', 'Admin', 'Platform', 'System'];

function NavItem({ item, allowed, onClose }) {
  const Icon = ICON_MAP[item.icon] || IconHome;

  if (!allowed) {
    return (
      <div
        title="You don't have permission to access this module"
        className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground/30 cursor-not-allowed select-none"
      >
        <Icon className="size-4.5 shrink-0" />
        <span className="flex-1">{item.label}</span>
        <IconLock className="size-3.5 shrink-0" />
      </div>
    );
  }

  return (
    <NavLink
      to={item.path}
      end={item.end}
      onClick={onClose}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
        )
      }
    >
      <Icon className="size-4.5 shrink-0" />
      <span>{item.label}</span>
    </NavLink>
  );
}

function NavSection({ label, items, role, subRole, onClose }) {
  if (!items.length) return null;
  return (
    <div className="mb-2">
      <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/40">
        {label}
      </p>
      <div className="space-y-0.5">
        {items.map((item) => (
          <NavItem
            // Several nav entries can share one permission key (e.g. the three
            // Platform pages), so the path is the stable identity here.
            key={item.path}
            item={item}
            allowed={can(role, subRole, item.key)}
            onClose={onClose}
          />
        ))}
      </div>
    </div>
  );
}

export default function Sidebar({ onClose }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user, facility } = useSelector((s) => s.auth);
  const role = user?.role?.toUpperCase() || '';
  const subRole = user?.subRole?.toUpperCase() || '';

  const handleLogout = async () => {
    await dispatch(logout());
    navigate('/login', { replace: true });
  };

  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase() || 'U';

  const itemsBySection = SECTIONS.reduce((acc, section) => {
    acc[section] = NAV_ITEMS.filter((i) => i.section === section);
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-sidebar-border">
        <NavLink to="/dashboard" className="flex items-center gap-2">
          <img src={logo} alt="Awibi EHR" className="h-8 w-auto object-contain" />
        </NavLink>
        {onClose && (
          <button onClick={onClose} className="text-sidebar-foreground/50 hover:text-sidebar-foreground md:hidden">
            <IconX className="size-5" />
          </button>
        )}
      </div>

      {/* Facility card */}
      {(facility || user?.organization) && (
        <div className="mx-3 mt-4 mb-2">
          <div className="flex items-center gap-2.5 border border-sidebar-border rounded-md py-3 px-3">
            <IconBuildingHospital className="size-6 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground leading-tight truncate">
                {facility?.name || user?.organization?.name || 'Your Facility'}
              </p>
              <p className="text-xs text-sidebar-foreground/50 truncate">
                {facility?.address || ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {SECTIONS.map((section) => (
          <NavSection
            key={section}
            label={section}
            items={itemsBySection[section] || []}
            role={role}
            subRole={subRole}
            onClose={onClose}
          />
        ))}
      </nav>

      {/* User footer */}
      <div className="border-t border-sidebar-border px-3 py-3">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-semibold shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground leading-tight truncate">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-sidebar-foreground/50 capitalize leading-tight">
              {roleLabel(role, subRole)}
            </p>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="text-sidebar-foreground/50 hover:text-destructive transition-colors p-1"
          >
            <IconLogout className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
