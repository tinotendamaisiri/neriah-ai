// src/main.tsx
// Vite entry point. Mounts the React app into #root.

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// TODO: import global CSS / Tailwind base styles
// import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
