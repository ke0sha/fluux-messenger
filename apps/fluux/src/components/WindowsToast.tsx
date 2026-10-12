import { useEffect } from 'react'
import { emitTo } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** Standalone small Tauri webview: intentionally does not load the XMPP app. */
export function WindowsToast() {
  const query = new URLSearchParams(window.location.search)
  const title = query.get('title') || 'Fluux Messenger'
  const body = query.get('body') || ''
  const close = () => { void getCurrentWindow().close() }

  useEffect(() => {
    const timer = window.setTimeout(close, 15_000)
    return () => window.clearTimeout(timer)
  }, [])

  const openChat = async () => {
    try {
      await emitTo('main', 'notification-activated', {
        navType: query.get('navType'),
        navTarget: query.get('navTarget'),
        messageId: query.get('messageId') || null,
        accountId: query.get('accountId') || null,
      })
    } finally {
      close()
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', height: '100vh', padding: 12,
      boxSizing: 'border-box', background: '#252936', color: '#f7f8ff',
      fontFamily: 'Segoe UI, sans-serif', borderRadius: 10 }}>
      <div aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 11,
        background: '#5369eb', display: 'grid', placeItems: 'center', marginRight: 12,
        fontWeight: 700, fontSize: 18, flexShrink: 0 }}>F</div>
      <button onClick={() => void openChat()} style={{ flex: 1, minWidth: 0,
        background: 'transparent', color: 'inherit', border: 0, textAlign: 'left',
        cursor: 'pointer', font: 'inherit', padding: 0 }}>
        <div style={{ fontSize: 11, opacity: .68, marginBottom: 3 }}>Fluux Messenger</div>
        <div style={{ fontSize: 14, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ fontSize: 12, opacity: .88, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{body}</div>
      </button>
      <button onClick={close} aria-label="Закрыть уведомление" title="Закрыть"
        style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', color: '#d9dce7',
          cursor: 'pointer', fontSize: 18, padding: '0 2px', marginLeft: 6 }}>×</button>
    </div>
  )
}
