import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const workerUrl = new URL(
    `${import.meta.env.BASE_URL}firebase-messaging-sw.js`,
    window.location.href,
  )
  const workerScope = new URL(import.meta.env.BASE_URL, window.location.href)
  void navigator.serviceWorker.register(workerUrl, { scope: workerScope.pathname })
    .catch((error: unknown) => {
      console.error('Unable to register the Natco PWA service worker.', error)
    })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
