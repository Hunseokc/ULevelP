// frontend/src/main.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './lib/auth';
import './lib/apiClient';
import './lib/drive';
import { migrateLegacyStorageOnce } from './lib/security';
import { App } from './App';

migrateLegacyStorageOnce();

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

