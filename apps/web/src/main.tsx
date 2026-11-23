import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app';
import { initAnalytics } from './lib/analytics';
import './styles/globals.css';

// No-op unless VITE_POSTHOG_KEY is configured.
void initAnalytics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
