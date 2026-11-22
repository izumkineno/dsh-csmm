import { createRoot } from 'react-dom/client'
import { createMockHost } from '../mock/host'
import { AppViewModelProvider } from '../viewmodel/useAppViewModel'
import App from './App'
import '../styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing')

createRoot(root).render(
  <AppViewModelProvider host={createMockHost()}>
    <App />
  </AppViewModelProvider>,
)
