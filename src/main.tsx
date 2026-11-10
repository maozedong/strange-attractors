import { createRoot } from 'react-dom/client'
import App from './chrome/App'
import './chrome/film.css'

// No StrictMode on purpose: the engine owns GPU resources and must be created exactly once.
createRoot(document.getElementById('root')!).render(<App />)
