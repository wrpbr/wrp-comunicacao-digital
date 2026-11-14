import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { AdminLayout } from '@/pages/admin/Layout';
import { AuditPage } from '@/pages/admin/AuditPage';
import { CampaignsPage } from '@/pages/admin/CampaignsPage';
import { ChatwootPage } from '@/pages/admin/ChatwootPage';
import { CitizensPage } from '@/pages/admin/CitizensPage';
import { DashboardPage } from '@/pages/admin/DashboardPage';
import { FranchisePage } from '@/pages/admin/FranchisePage';
import { LgpdPage } from '@/pages/admin/LgpdPage';
import { MediaPage } from '@/pages/admin/MediaPage';
import { PocPage } from '@/pages/admin/PocPage';
import { QueuesPage } from '@/pages/admin/QueuesPage';
import { ReportsPage } from '@/pages/admin/ReportsPage';
import { ServidoresPage } from '@/pages/admin/ServidoresPage';
import { TvAdminPage } from '@/pages/admin/TvAdminPage';
import { LandingPage } from '@/pages/LandingPage';
import { LoginPage } from '@/pages/LoginPage';
import { PrivacyPage } from '@/pages/PrivacyPage';
import { SecurityPage } from '@/pages/SecurityPage';
import { TvPlayerPage } from '@/pages/TvPlayerPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-8 text-sm">Carregando sessão…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/privacidade" element={<PrivacyPage />} />
      <Route path="/seguranca" element={<SecurityPage />} />
      <Route path="/tv/:unitSlug" element={<TvPlayerPage />} />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="cidadaos" element={<CitizensPage />} />
        <Route path="campanhas" element={<CampaignsPage />} />
        <Route path="servidores" element={<ServidoresPage />} />
        <Route path="midias" element={<MediaPage />} />
        <Route path="filas" element={<QueuesPage />} />
        <Route path="tv" element={<TvAdminPage />} />
        <Route path="franquia" element={<FranchisePage />} />
        <Route path="poc" element={<PocPage />} />
        <Route path="auditoria" element={<AuditPage />} />
        <Route path="lgpd" element={<LgpdPage />} />
        <Route path="relatorios" element={<ReportsPage />} />
        <Route path="chatwoot" element={<ChatwootPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
