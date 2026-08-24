import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((registration) => {
    registration.update()
    if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' })
  }).catch(() => {
    // SW optional in dev
  })
}
