import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createRemoteHost, requestRpc, type RemoteHost } from '../../client/hostPort'
import { AppViewModelProvider } from '../viewmodel/useAppViewModel'
import App from './App'
import '../styles.css'

/**
 * 浏览器预览入口：直接走宿主 RPC（Vite dev server 代理 /dsh-csmm/rpc）。
 * 不再内置任何 mock 数据；宿主不可达时显示错误与重试。
 */
function DevRoot(): React.ReactElement {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; host: RemoteHost }
  >({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    requestRpc({ method: 'snapshot' })
      .then((result) => {
        if (!alive) return
        if (!result.snapshot) throw new Error('快照为空')
        setState({ status: 'ready', host: createRemoteHost(result.snapshot) })
      })
      .catch((error: unknown) => {
        if (!alive) return
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      alive = false
    }
  }, [attempt])

  if (state.status === 'loading') {
    return <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>正在连接 DSH 宿主…</div>
  }
  if (state.status === 'error') {
    return (
      <div style={{ padding: 24, maxWidth: 560, fontSize: 13, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>无法连接 DSH 宿主</div>
        <div style={{ color: 'var(--muted)', marginBottom: 12 }}>{state.message}</div>
        <button className="btn primary" onClick={() => setAttempt((n) => n + 1)}>重试</button>
      </div>
    )
  }
  return (
    <AppViewModelProvider host={state.host}>
      <App />
    </AppViewModelProvider>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing')

createRoot(root).render(<DevRoot />)
