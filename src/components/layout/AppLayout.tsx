import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { SyncBlockingOverlay } from '@/components/SyncBlockingOverlay';

export function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6 md:p-8">
        <Outlet />
      </main>
      <SyncBlockingOverlay />
    </div>
  );
}
