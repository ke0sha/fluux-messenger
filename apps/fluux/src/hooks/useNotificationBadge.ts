import { useEffect, useRef } from 'react'
import { useEvents, computeBadgeCount, chatStore, roomStore } from '@fluux/sdk'
import { useChatStore, useRoomStore } from '@fluux/sdk/react'
import { notificationDebug } from '@/utils/notificationDebug'
import { setWebAppBadge } from '@/utils/appBadge'
import { pushBadgeState, sharePushBadge } from '@/utils/pushBadge'
import { platform } from '@/platform'

// Set Tauri dock/taskbar badge
async function setTauriBadge(count: number): Promise<void> {
  if (!platform().hasNativeAppBadge) return

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const window = getCurrentWindow()
    if (platform().os === 'windows') {
      await setWindowsTaskbarBadge(window, count)
    } else {
      // Windows does not implement setBadgeCount; other desktop hosts do.
      await window.setBadgeCount(count > 0 ? count : undefined)
    }
  } catch {
    // Badge API may not be available on all platforms
  }
}

// Windows taskbar badges use a small overlay icon, not setBadgeCount.
// Serialize asynchronous updates so a slow previous render cannot overwrite
// a newer unread count. Drawing RGBA directly avoids extra Rust image features.
let windowsBadgeQueue: Promise<void> = Promise.resolve()

async function setWindowsTaskbarBadge(
  window: import('@tauri-apps/api/window').Window,
  count: number,
): Promise<void> {
  const update = async (): Promise<void> => {
    if (count <= 0) {
      await window.setOverlayIcon(undefined)
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('set_windows_tray_badge', { rgba: null })
      return
    }

    const size = 32
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Transparent background and a crisp red circular notification badge.
    ctx.clearRect(0, 0, size, size)
    ctx.beginPath()
    ctx.arc(16, 16, 15, 0, Math.PI * 2)
    ctx.fillStyle = '#e53935'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const label = count > 99 ? '99+' : String(count)
    ctx.font = `bold ${label.length > 2 ? 13 : 19}px Arial, sans-serif`
    ctx.fillText(label, 16, 17)

    const { Image } = await import('@tauri-apps/api/image')
    const image = await Image.new(new Uint8Array(ctx.getImageData(0, 0, size, size).data), size, size)
    try {
      await window.setOverlayIcon(image)
      // The tray is an independent icon and needs its own bitmap.
      // Share the same overlay with the tray, preserving the Fluent badge count.
      const { invoke } = await import('@tauri-apps/api/core')
      const trayCanvas = document.createElement('canvas')
      trayCanvas.width = 32
      trayCanvas.height = 32
      const trayCtx = trayCanvas.getContext('2d')
      if (trayCtx) {
        // Draw the existing app favicon underneath a compact badge.
        const favicon = new globalThis.Image()
        favicon.src = '/favicon.png'
        try {
          await favicon.decode()
          trayCtx.drawImage(favicon, 0, 0, 32, 32)
        } catch {
          // Keep badge visible even if the favicon is missing.
        }
        trayCtx.beginPath()
        trayCtx.arc(25, 8, 7, 0, Math.PI * 2)
        trayCtx.fillStyle = '#e53935'
        trayCtx.fill()
        trayCtx.lineWidth = 1.3
        trayCtx.strokeStyle = '#ffffff'
        trayCtx.stroke()
        trayCtx.fillStyle = '#ffffff'
        trayCtx.textAlign = 'center'
        trayCtx.textBaseline = 'middle'
        const trayLabel = count > 99 ? '99+' : String(count)
        trayCtx.font = `bold ${trayLabel.length > 2 ? 6 : 9}px Arial, sans-serif`
        trayCtx.fillText(trayLabel, 25, 8)
        await invoke('set_windows_tray_badge', {
          rgba: Array.from(trayCtx.getImageData(0, 0, 32, 32).data),
        })
      }
    } finally {
      await image.close()
    }
  }

  windowsBadgeQueue = windowsBadgeQueue.catch(() => {}).then(update)
  await windowsBadgeQueue
}

// Browser favicon badge implementation
class FaviconBadge {
  private originalFavicon: string | null = null
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private faviconLink: HTMLLinkElement | null = null
  private faviconImage: HTMLImageElement | null = null
  private isReady = false

  constructor() {
    if (typeof document === 'undefined') return

    this.canvas = document.createElement('canvas')
    this.canvas.width = 32
    this.canvas.height = 32
    this.ctx = this.canvas.getContext('2d')

    // Find or create favicon link
    this.faviconLink = document.querySelector('link[rel="icon"]')
    if (!this.faviconLink) {
      this.faviconLink = document.createElement('link')
      this.faviconLink.rel = 'icon'
      document.head.appendChild(this.faviconLink)
    }

    // Store original favicon
    this.originalFavicon = this.faviconLink.href || '/favicon.png'

    // Load the original favicon image
    this.faviconImage = new Image()
    this.faviconImage.crossOrigin = 'anonymous'
    this.faviconImage.onload = () => {
      this.isReady = true
    }
    this.faviconImage.src = this.originalFavicon
  }

  setBadge(count: number): void {
    if (!this.ctx || !this.canvas || !this.faviconLink) return

    // Clear canvas
    this.ctx.clearRect(0, 0, 32, 32)

    // Draw original favicon if loaded
    if (this.isReady && this.faviconImage) {
      this.ctx.drawImage(this.faviconImage, 0, 0, 32, 32)
    } else {
      // Fallback: draw a simple icon
      this.ctx.fillStyle = '#5865F2'
      this.ctx.fillRect(0, 0, 32, 32)
    }

    // Draw badge if count > 0
    if (count > 0) {
      // Red circle
      this.ctx.beginPath()
      this.ctx.arc(24, 8, 8, 0, 2 * Math.PI)
      this.ctx.fillStyle = '#ED4245'
      this.ctx.fill()

      // Badge text
      if (count < 100) {
        this.ctx.fillStyle = '#FFFFFF'
        this.ctx.font = 'bold 10px sans-serif'
        this.ctx.textAlign = 'center'
        this.ctx.textBaseline = 'middle'
        this.ctx.fillText(count.toString(), 24, 9)
      }
    }

    // Update favicon
    this.faviconLink.href = this.canvas.toDataURL('image/png')
  }

  reset(): void {
    if (this.faviconLink && this.originalFavicon) {
      this.faviconLink.href = this.originalFavicon
    }
  }
}

/**
 * Hook to manage notification badges for unread messages and inbox events.
 * - In Tauri: Sets the dock/taskbar badge count
 * - On iOS: Sets the app icon badge through the push plugin
 * - In Browser: Updates the favicon with a notification indicator
 *
 * Badge count is a simple sum of store-maintained unread counts.
 * The stores keep unreadCounts accurate via onWindowBecameVisible transitions
 * (triggered by useWindowVisibility), so no independent focus tracking is needed.
 */
export function useNotificationBadge(): void {
  const { pendingCount: eventsPendingCount } = useEvents()
  const roomsWithUnreadCount = useRoomStore((s) => s.roomsWithUnreadCount())

  // Count conversations with unread messages
  const conversationsUnreadCount = useChatStore((s) => {
    let count = 0
    for (const conv of s.conversations.values()) {
      if (conv.unreadCount > 0) count++
    }
    return count
  })

  const faviconBadgeRef = useRef<FaviconBadge | null>(null)
  const latestUnreadCountRef = useRef(0)

  // Initialize favicon badge handler (browser only)
  useEffect(() => {
    if (!platform().hasNativeAppBadge && !platform().usesNativePush && typeof document !== 'undefined') {
      faviconBadgeRef.current = new FaviconBadge()
    }

    return () => {
      faviconBadgeRef.current?.reset()
    }
  }, [])

  // Windows may discard a taskbar overlay when a window is hidden and later
  // shown again. This does NOT change unread state, so the badge-count effect
  // below will not rerun. Reapply the last known overlay on window restore.
  useEffect(() => {
    if (platform().os !== 'windows' || !platform().hasNativeAppBadge) return

    let disposed = false
    let redrawTimer: ReturnType<typeof setTimeout> | undefined
    let unlistenFocus: (() => void) | undefined

    const redraw = () => {
      if (document.hidden) return
      if (redrawTimer !== undefined) clearTimeout(redrawTimer)
      redrawTimer = setTimeout(() => {
        redrawTimer = undefined
        if (!disposed) void setTauriBadge(latestUnreadCountRef.current)
      }, 200)
    }

    // The OS can recreate the taskbar button during show/restore; wait a
    // moment for that button to exist before setting its overlay again.
    const subscribe = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const remove = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (focused) redraw()
        })
        if (disposed) remove()
        else unlistenFocus = remove
      } catch {
        // The DOM visibility/focus event below still covers common restores.
      }
    }

    void subscribe()
    window.addEventListener('focus', redraw)
    document.addEventListener('visibilitychange', redraw)
    return () => {
      disposed = true
      if (redrawTimer !== undefined) clearTimeout(redrawTimer)
      unlistenFocus?.()
      window.removeEventListener('focus', redraw)
      document.removeEventListener('visibilitychange', redraw)
    }
  }, [])

  // Update badge when any unread count changes
  useEffect(() => {
    const totalCount = computeBadgeCount({
      conversationsUnreadCount,
      roomsWithUnreadCount,
      eventsPendingCount,
    })

    latestUnreadCountRef.current = totalCount

    notificationDebug.dockBadge({
      count: totalCount,
      reason: 'badge-update',
      breakdown: {
        conversationsUnread: conversationsUnreadCount,
        eventsPending: eventsPendingCount,
        roomsUnread: roomsWithUnreadCount,
      },
    })

    if (platform().hasNativeAppBadge) {
      void setTauriBadge(totalCount)
    } else if (platform().usesNativePush) {
      // The app icon badge, which pushes raise while the app is suspended.
      void sharePushBadge(pushBadgeState(
        chatStore.getState().conversations.values(),
        roomStore.getState(),
        eventsPendingCount,
      ))
    } else {
      faviconBadgeRef.current?.setBadge(totalCount)
      // Installed-PWA icon badge (Badging API): exact count while the app runs.
      void setWebAppBadge(totalCount)
    }
  }, [conversationsUnreadCount, eventsPendingCount, roomsWithUnreadCount])
}
