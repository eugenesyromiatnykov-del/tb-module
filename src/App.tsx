import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from '@/routes/login';
import { DashboardPage } from '@/routes/dashboard';
import { PatientsPage } from '@/routes/patients';
import { PatientDetailPage } from '@/routes/patients/$id';
import { QuestionnairesPage } from '@/routes/questionnaires';
import { OrdersPage } from '@/routes/orders';
import { SettingsPage } from '@/routes/settings';
import { ImportDeclarantsPage } from '@/routes/settings/import-declarants';
import { AppLayout } from '@/components/layout/AppLayout';
import { RequireAuth } from '@/components/auth/RequireAuth';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/patients" element={<PatientsPage />} />
        <Route path="/patients/:id" element={<PatientDetailPage />} />
        <Route path="/questionnaires" element={<QuestionnairesPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/import-declarants" element={<ImportDeclarantsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
