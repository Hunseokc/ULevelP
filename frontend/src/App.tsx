// frontend/src/App.tsx
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { ChordsPage } from './pages/ChordsPage';
import { PracticePage } from './pages/PracticePage';
import { LogPage } from './pages/LogPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotesPage } from './pages/NotesPage';
import { NoteDetailPage } from './pages/NoteDetailPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { ProgressionsPage } from './pages/ProgressionsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App(): React.ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/index.html" element={<HomePage />} />
          <Route path="/chords.html" element={<ChordsPage />} />
          <Route path="/practice.html" element={<PracticePage />} />
          <Route path="/log.html" element={<LogPage />} />
          <Route path="/progressions.html" element={<ProgressionsPage />} />
          <Route path="/notes.html" element={<NotesPage />} />
          <Route path="/note.html" element={<NoteDetailPage />} />
          <Route path="/settings.html" element={<SettingsPage />} />
          <Route path="/privacy.html" element={<PrivacyPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
