import './styles.css';
import { app } from './app.js';

// The controller is started from exactly one place. There is no global `app`,
// so nothing rendered into the page can reach it.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.start(), { once: true });
} else {
  app.start();
}
