import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from '@/components/ui/Toast';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ProtectedRoute, RedirectIfSignedIn } from '@/components/ProtectedRoute';
import { LoadingBlock } from '@/components/ui/Feedback';

import LandingPage from '@/pages/LandingPage';
import AdminLoginPage from '@/pages/AdminLoginPage';
import BdmLoginPage from '@/pages/BdmLoginPage';
import SetupPage from '@/pages/SetupPage';
import NotFoundPage from '@/pages/NotFoundPage';

// The admin section is large and only admins ever open it, so it downloads
// separately. A BDM on a phone never pays for code they will not use.
const AdminLayout = lazy(() => import('@/layouts/AdminLayout'));
const AdminDashboard = lazy(() => import('@/pages/admin/DashboardPage'));
const AdminBdmsPage = lazy(() => import('@/pages/admin/BdmsPage'));
const AdminLeadsPage = lazy(() => import('@/pages/admin/LeadsPage'));
const AdminUploadPage = lazy(() => import('@/pages/admin/UploadPage'));
const AdminMapPage = lazy(() => import('@/pages/admin/MapPage'));
const AdminLocationsPage = lazy(() => import('@/pages/admin/LocationsPage'));
const AdminAnalyticsPage = lazy(() => import('@/pages/admin/AnalyticsPage'));
const AdminActivityPage = lazy(() => import('@/pages/admin/ActivityPage'));
const AdminAdminsPage = lazy(() => import('@/pages/admin/AdminsPage'));

const BdmLayout = lazy(() => import('@/layouts/BdmLayout'));
const BdmLeadsPage = lazy(() => import('@/pages/bdm/LeadsPage'));
const BdmLeadDetailPage = lazy(() => import('@/pages/bdm/LeadDetailPage'));
const BdmMapPage = lazy(() => import('@/pages/bdm/MapPage'));

function SuspenseFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <LoadingBlock />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <Suspense fallback={<SuspenseFallback />}>
              <Routes>
                {/* ------------------------------------------------ Public */}
                <Route
                  path="/"
                  element={
                    <RedirectIfSignedIn>
                      <LandingPage />
                    </RedirectIfSignedIn>
                  }
                />
                <Route
                  path="/login/admin"
                  element={
                    <RedirectIfSignedIn>
                      <AdminLoginPage />
                    </RedirectIfSignedIn>
                  }
                />
                <Route
                  path="/login/bdm"
                  element={
                    <RedirectIfSignedIn>
                      <BdmLoginPage />
                    </RedirectIfSignedIn>
                  }
                />
                <Route path="/setup" element={<SetupPage />} />

                {/* ------------------------------------------------- Admin */}
                <Route element={<ProtectedRoute allow="super_admin" />}>
                  <Route path="/admin" element={<AdminLayout />}>
                    <Route index element={<AdminDashboard />} />
                    <Route path="leads" element={<AdminLeadsPage />} />
                    <Route path="map" element={<AdminMapPage />} />
                    <Route path="upload" element={<AdminUploadPage />} />
                    <Route path="locations" element={<AdminLocationsPage />} />
                    <Route path="bdms" element={<AdminBdmsPage />} />
                    <Route path="analytics" element={<AdminAnalyticsPage />} />
                    <Route path="activity" element={<AdminActivityPage />} />
                    <Route path="admins" element={<AdminAdminsPage />} />
                  </Route>
                </Route>

                {/* --------------------------------------------------- BDM */}
                <Route element={<ProtectedRoute allow="bdm" />}>
                  <Route path="/bdm" element={<BdmLayout />}>
                    <Route index element={<BdmLeadsPage />} />
                    <Route path="map" element={<BdmMapPage />} />
                    <Route path="lead/:leadId" element={<BdmLeadDetailPage />} />
                  </Route>
                </Route>

                {/* ----------------------------------------------- Fallback */}
                <Route path="/login" element={<Navigate to="/" replace />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
