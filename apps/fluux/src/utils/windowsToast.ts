/** Windows-only, app-owned toast. No system notification is posted on success. */
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { currentMonitor } from '@tauri-apps/api/window'
import { LogicalPosition } from '@tauri-apps/api/dpi'

export interface ToastPayload {
  title: string
  body: string
  navType: 'conversation' | 'room'
  navTarget: string
  messageId: string | null
  accountId: string | null
}

let activeToast: WebviewWindow | null = null
let sequence = 0

export async function showWindowsToast(payload: ToastPayload): Promise<boolean> {
  try {
    // Only one card is visible; the latest message replaces the previous one.
    // A distinct label avoids waiting for asynchronous destruction of old windows.
    const previous = activeToast
    activeToast = null
    if (previous) await previous.close().catch(() => {})

    const label = `fluux-toast-${++sequence}`
    const params = new URLSearchParams({
      fluuxToast: '1',
      title: payload.title,
      body: payload.body,
      navType: payload.navType,
      navTarget: payload.navTarget,
      messageId: payload.messageId ?? '',
      accountId: payload.accountId ?? '',
    })
    const toast = new WebviewWindow(label, {
      url: `/?${params.toString()}`,
      title: 'Fluux notification',
      width: 365,
      height: 112,
      decorations: false,
      transparent: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focus: false,
      visible: false,
    })
    activeToast = toast
    await new Promise<void>((resolve, reject) => {
      void toast.once('tauri://created', () => resolve())
      void toast.once('tauri://error', (e) => reject(e.payload))
    })
    const monitor = await currentMonitor()
    if (monitor) {
      const scale = monitor.scaleFactor
      const area = monitor.workArea
      await toast.setPosition(new LogicalPosition(
        Math.round((area.position.x + area.size.width) / scale - 365 - 16),
        Math.round((area.position.y + area.size.height) / scale - 112 - 16),
      ))
    }
    await toast.show()
    return true
  } catch (error) {
    console.warn('[Fluux Toast] Falling back to Windows notification:', error)
    return false
  }
}
