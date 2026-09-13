import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import VectorLab from './vector-lab/VectorLab';
import './styles/app.css';

const isVectorLab = window.location.pathname.replace(/\/$/, '') === '/vector-lab';

createRoot(document.getElementById('root')!).render(<React.StrictMode>{isVectorLab ? <VectorLab /> : <App />}</React.StrictMode>);
