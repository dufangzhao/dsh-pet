import { createRoot } from 'react-dom/client';

import { App } from './app.js';
import './styles.css';
import './model.css';

const host = document.getElementById('root');
if (host === null) throw new Error('text-client: missing #root');

createRoot(host).render(<App />);
