import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { fetchMe, clearAuth } from './store/authSlice';
import useAuthStore from './stores/authStore';
import { can } from './lib/permissions';
import { toast } from 'sonner';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-8">
          <div className="text-center max-w-md">
            <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Something went wrong</h2>
            <p className="text-sm text-gray-500 mb-4">{this.state.error?.message || 'An unexpected error occurred.'}</p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-[#335CF4] text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Layouts
import AppShell from './components/layout/AppShell';
import AuthLayout from './components/layout/AuthLayout';

// Auth pages
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import VerifyOTP from './pages/auth/VerifyOTP';
import GoogleCallback from './pages/auth/GoogleCallback';

// Dashboard pages
import Overview from './pages/dashboard/Overview';
import Patients from './pages/patients/Patients';
import PatientDetail from './pages/patients/PatientDetail';
import PatientIDCard from './pages/patients/PatientIDCard';
import AddPatient from './pages/patients/AddPatient';
import Appointments from './pages/appointments/Appointments';
import Cases from './pages/cases/Cases';
import CaseDetail from './pages/cases/CaseDetail';
import NewEncounter from './pages/cases/NewEncounter';
import Lab from './pages/lab/Lab';
import PlatformOverview from './pages/platform/PlatformOverview';
import PlatformFacilities from './pages/platform/PlatformFacilities';
import PlatformPayments from './pages/platform/PlatformPayments';
import PlatformSubscriptions from './pages/platform/PlatformSubscriptions';
import Monitoring from './pages/nursing/Monitoring';
import Worklist from './pages/nursing/Worklist';
import Emergency from './pages/emergency/Emergency';
import Bookings from './pages/bookings/Bookings';
import Inquiries from './pages/bookings/Inquiries';
import Messages from './pages/messages/Messages';
import Scout from './pages/scout/Scout';
import Households from './pages/households/Households';
import InsurancePage from './pages/insurance/Insurance';
import ClinicLanding from './pages/public/ClinicLanding';
import MonitoringSheet from './pages/nursing/MonitoringSheet';
import DrugChart from './pages/nursing/DrugChart';
import Handover from './pages/nursing/Handover';
import Orders from './pages/nursing/Orders';
import EmergencyBoard from './pages/emergency/EmergencyBoard';
import PatientMonitoringOverview from './pages/nursing/PatientMonitoringOverview';
import Departments from './pages/departments/Departments';
import Staff from './pages/staff/Staff';
import Billing from './pages/billing/Billing';
import Reports from './pages/reports/Reports';
import Subscription from './pages/subscription/Subscription';
import Settings from './pages/settings/Settings';
import EncounterTypes from './pages/settings/EncounterTypes';
import Admissions from './pages/admissions/Admissions';
import Support from './pages/support/Support';
import Affiliates from './pages/affiliates/Affiliates';
import Unauthorized from './pages/errors/Unauthorized';
import NotFound from './pages/errors/NotFound';

function Spinner() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
      <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full" />
      <p className="text-sm text-muted-foreground animate-pulse">Loading your dashboard…</p>
    </div>
  );
}

function PrivateRoute({ children }) {
  const { isAuthenticated, loading, user } = useSelector((s) => s.auth);
  const location = useLocation();

  /**
   * Do not wait forever on a sleeping server.
   *
   * The session check blocks the whole app while it runs. On a host that idles
   * its free instances that call can take the best part of a minute, and the
   * visitor sits on a spinner with nothing to read and no way forward — which
   * is indistinguishable from the application being broken.
   *
   * After a few seconds we stop blocking and send them to sign in. If the
   * session turns out to be valid the check completes in the background and
   * they land on the dashboard anyway; if it does not, they are already where
   * they need to be.
   */
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  useEffect(() => {
    if (!loading || isAuthenticated) return undefined;
    const timer = setTimeout(() => setWaitedTooLong(true), 6000);
    return () => clearTimeout(timer);
  }, [loading, isAuthenticated]);

  // Only block on a cold load: no persisted session, token present, check in
  // flight. With a persisted session the dashboard renders at once and the
  // check re-validates quietly behind it.
  if (loading && !isAuthenticated && !waitedTooLong) return <Spinner />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.mustChangePassword && location.pathname !== '/dashboard/settings') {
    return <Navigate to="/dashboard/settings?passwordChange=required" replace />;
  }
  return children;
}

function PublicRoute({ children }) {
  const { isAuthenticated } = useSelector((s) => s.auth);
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return children;
}

function RoleRoute({ module, children }) {
  const { user } = useSelector((s) => s.auth);
  const role = (user?.role || '').toUpperCase();
  const subRole = (user?.subRole || '').toUpperCase();
  if (!can(role, subRole, module)) return <Navigate to="/unauthorized" replace />;
  return children;
}

export default function App() {
  const dispatch = useDispatch();
  const setAuth = useAuthStore((s) => s.setAuth);
  const token = localStorage.getItem('accessToken');

  useEffect(() => {
    if (token) {
      dispatch(fetchMe())
        .unwrap()
        .then(({ user, facility, subscription }) => setAuth({ user, facility, subscription }))
        .catch((err) => {
          const msg = err?.error || '';
          if (msg.includes('timeout') || msg.includes('Network Error')) {
            // Named the wrong service — it said Supabase long after the API
            // moved. A message that points somewhere irrelevant wastes the time
            // of whoever is trying to work out what is wrong.
            toast.error('Cannot reach the server. It may be starting up — try again in a moment.', { duration: 8000 });
          }
        });
    } else {
      // No token — clear loading state immediately so PrivateRoute redirects without a spinner
      dispatch(clearAuth());
    }
  }, []);

  return (
    <ErrorBoundary>
    <Routes>
      {/* Public */}
      <Route element={<PublicRoute><AuthLayout /></PublicRoute>}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-otp" element={<VerifyOTP />} />
      </Route>

      {/* Protected dashboard */}
      {/* Public clinic page — no authentication, patients land here. */}
      <Route path="/clinic/:slug" element={<ClinicLanding />} />

      <Route path="/dashboard" element={<PrivateRoute><AppShell /></PrivateRoute>}>
        <Route index element={<Overview />} />
        <Route path="patients" element={<RoleRoute module="patients"><Patients /></RoleRoute>} />
        <Route path="patients/add" element={<RoleRoute module="patients"><AddPatient /></RoleRoute>} />
        <Route path="patients/:id" element={<RoleRoute module="patients"><PatientDetail /></RoleRoute>} />
        <Route path="patients/:id/id-card" element={<RoleRoute module="patients"><PatientIDCard /></RoleRoute>} />
        <Route path="appointments" element={<RoleRoute module="appointments"><Appointments /></RoleRoute>} />
        <Route path="cases" element={<RoleRoute module="cases"><Cases /></RoleRoute>} />
        <Route path="cases/new" element={<RoleRoute module="cases"><NewEncounter /></RoleRoute>} />
        <Route path="cases/:id" element={<RoleRoute module="cases"><CaseDetail /></RoleRoute>} />
        <Route path="lab" element={<RoleRoute module="lab"><Lab /></RoleRoute>} />
        <Route path="nursing" element={<RoleRoute module="monitoring"><Monitoring /></RoleRoute>} />
        <Route path="nursing/sheet/:id" element={<RoleRoute module="monitoring"><MonitoringSheet /></RoleRoute>} />
        <Route path="nursing/drug-chart" element={<RoleRoute module="drug_admin"><DrugChart /></RoleRoute>} />
        <Route path="nursing/shift-report" element={<RoleRoute module="handover"><Handover /></RoleRoute>} />
        {/* The screen was renamed to "Shift report"; the old path still resolves
            so anything already bookmarked or linked does not break. */}
        <Route path="nursing/handover" element={<Navigate to="/dashboard/nursing/shift-report" replace />} />
        <Route path="nursing/worklist" element={<RoleRoute module="drug_admin"><Worklist /></RoleRoute>} />
        <Route path="emergency/resuscitation/:id" element={<RoleRoute module="emergency"><EmergencyBoard /></RoleRoute>} />
        <Route path="nursing/orders" element={<RoleRoute module="orders"><Orders /></RoleRoute>} />
        <Route path="nursing/patient/:patientId" element={<RoleRoute module="monitoring"><PatientMonitoringOverview /></RoleRoute>} />
        <Route path="emergency" element={<RoleRoute module="emergency"><Emergency /></RoleRoute>} />
        <Route path="bookings" element={<RoleRoute module="bookings"><Bookings /></RoleRoute>} />
        {/* Open to every signed-in member of staff: published reference material,
            not patient data. Gating it would only send people to their phones. */}
        <Route path="scout" element={<Scout />} />
        <Route path="messages" element={<Messages />} />
        <Route path="inquiries" element={<RoleRoute module="patients"><Inquiries /></RoleRoute>} />
        <Route path="households" element={<RoleRoute module="households"><Households /></RoleRoute>} />
        <Route path="insurance" element={<RoleRoute module="billing"><InsurancePage /></RoleRoute>} />
        <Route path="platform" element={<RoleRoute module="platform"><PlatformOverview /></RoleRoute>} />
        <Route path="platform/facilities" element={<RoleRoute module="platform"><PlatformFacilities /></RoleRoute>} />
        <Route path="platform/subscriptions" element={<RoleRoute module="platform"><PlatformSubscriptions /></RoleRoute>} />
        <Route path="platform/payments" element={<RoleRoute module="platform"><PlatformPayments /></RoleRoute>} />
        <Route path="admissions" element={<RoleRoute module="admissions"><Admissions /></RoleRoute>} />
        <Route path="departments" element={<RoleRoute module="departments"><Departments /></RoleRoute>} />
        <Route path="staff" element={<RoleRoute module="staff"><Staff /></RoleRoute>} />
        <Route path="billing" element={<RoleRoute module="billing"><Billing /></RoleRoute>} />
        <Route path="reports" element={<RoleRoute module="reports"><Reports /></RoleRoute>} />
        <Route path="subscription" element={<RoleRoute module="subscription"><Subscription /></RoleRoute>} />
        <Route path="settings" element={<RoleRoute module="settings"><Settings /></RoleRoute>} />
        {/* Guarded by `departments`, matching the sidebar entry that links here —
            using `settings` instead would open the clinic timetable to every role
            that can reach the settings screen. */}
        <Route path="settings/encounter-types" element={<RoleRoute module="departments"><EncounterTypes /></RoleRoute>} />
        <Route path="support" element={<RoleRoute module="support"><Support /></RoleRoute>} />
        <Route path="affiliates" element={<RoleRoute module="affiliates"><Affiliates /></RoleRoute>} />
      </Route>

      {/* Google OAuth callback — must be outside PublicRoute so it works even with a token */}
      <Route path="/auth/google" element={<GoogleCallback />} />

      <Route path="/unauthorized" element={<Unauthorized />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </ErrorBoundary>
  );
}
