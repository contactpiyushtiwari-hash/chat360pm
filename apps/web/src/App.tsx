import { BrowserRouter, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/ui';
import { RequireAuth, SessionProvider } from './lib/session';
import { AccountPage } from './pages/Account';
import { AdminPage } from './pages/Admin';
import { AnalyticsPage } from './pages/Analytics';
import { DashboardPage } from './pages/Dashboard';
import { EmailPage } from './pages/Email';
import { EscalationsPage } from './pages/Escalations';
import { LoginPage } from './pages/Login';
import { NotFoundPage } from './pages/NotFound';
import { ProjectDetailPage } from './pages/ProjectDetail';
import { ProjectNewPage } from './pages/ProjectNew';
import { ProjectsPage } from './pages/Projects';
import { SetPasswordPage } from './pages/SetPassword';
import { SupportPage } from './pages/Support';
import { TodayPage } from './pages/Today';
import { TransferDetailPage, TransfersPage } from './pages/Transfers';
import { WelcomePage } from './pages/Welcome';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/set-password" element={<SetPasswordPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="welcome" element={<WelcomePage />} />
        <Route path="today" element={<TodayPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/new" element={<ProjectNewPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="escalations" element={<EscalationsPage />} />
        <Route path="transfers" element={<TransfersPage />} />
        <Route path="transfers/:projectId/:transferId" element={<TransferDetailPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="email" element={<EmailPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  );
}
