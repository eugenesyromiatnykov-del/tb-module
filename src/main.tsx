import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Default off: every tab-switch refetching all mounted queries hammers
      // Vercel Active CPU (a doctor tabbing between МІС and the registry
      // 200×/day × N queries adds up fast). Realtime is the primary
      // freshness mechanism; the few queries that really need a focus
      // refetch (auth/me to catch a forced logout) opt back in per-hook.
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
