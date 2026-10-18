import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/bricolage-grotesque/index.css';
import '../styles.css';
import ConsoleApp from './ConsoleApp';
import { queryClient } from '../lib/queryClient';
import { initTheme } from '../lib/theme';

initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ConsoleApp />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
