import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';
import RequireRole from './components/RequireRole';
import { JobProvider } from './context/JobContext';
import { AuthProvider } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import UploadPage from './pages/UploadPage';
import ValidationResultsPage from './pages/ValidationResultsPage';
import ReviewPage from './pages/ReviewPage';
import ReconciliationPage from './pages/ReconciliationPage';
import PipelineStatusPage from './pages/PipelineStatusPage';
import SchedulingPage from './pages/SchedulingPage';
import DashboardPage from './pages/DashboardPage';
import AuditLogPage from './pages/AuditLogPage';

export default function App() {
  return (
    <AuthProvider>
      <JobProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<RequireAuth />}>
              <Route element={<Layout />}>
                <Route index element={<Navigate to="/upload" replace />} />
                <Route path="/upload" element={<UploadPage />} />
                <Route path="/validation" element={<ValidationResultsPage />} />
                <Route path="/review" element={<ReviewPage />} />
                <Route path="/reconciliation" element={<ReconciliationPage />} />
                <Route path="/status" element={<PipelineStatusPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />

                <Route element={<RequireRole roles={['admin']} />}>
                  <Route path="/scheduling" element={<SchedulingPage />} />
                  <Route path="/audit" element={<AuditLogPage />} />
                </Route>
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </JobProvider>
    </AuthProvider>
  );
}
