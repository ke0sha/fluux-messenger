/**
 * Full-screen lightbox overlay for viewing image attachments.
 * Triggered by clicking on an image attachment in chat/room views.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useCloseOnEscape } from '@/hooks/useCloseOnEscape'
import { X, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FileEncryption } from '@fluux/sdk'
import { useAttachmentUrl } from '@/hooks'
import { useCachedMediaUrl } from '@/hooks/useCachedMediaUrl'
import { useContextMenu } from '@/hooks/useContextMenu'
import { downloadFile, downloadAttachment } from '@/utils/download'
import { ImageContextMenu } from './ImageContextMenu'
import { saveActionLabelKey, SaveActionIcon } from '@/utils/saveAction'

interface ImageLightboxProps {
  /** Original full-resolution image URL (proxied/decrypted internally for display) */
  src: string
  /** Alt text for the image */
  alt?: string
  /** Original URL for downloading (same as src; encryption handled internally) */
  downloadUrl: string
  /** Original filename */
  filename?: string
  /** Encryption params when the image is AES-GCM encrypted (aesgcm:// upload) */
  encryption?: FileEncryption
  /** Optional preview URL (e.g. already-proxied thumbnail) shown while the full-size image loads */
  placeholderSrc?: string
  /** When false, never fetch the full-res image — show cached full-res or the placeholder only. */
  allowFetch?: boolean
  /** Close handler */
  onClose: () => void
}

export function ImageLightbox({ src, alt, downloadUrl, filename, encryption, placeholderSrc, allowFetch = true, onClose }: ImageLightboxProps) {
  const { t } = useTranslation()
  const { url: proxiedSrc, isLoading } = useAttachmentUrl(src, encryption, allowFetch)
  const { cachedUrl: cachedFullRes } = useCachedMediaUrl(src, encryption, !allowFetch)
  const imageMenu = useContextMenu()
  const overlayRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ x: number; y: number } | null>(null)

  // Use a non-passive native listener so wheel zoom never scrolls/zooms the WebView.
  useEffect(() => {
    const image = imageRef.current
    if (!image) return
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      const direction = event.deltaY < 0 ? 1.2 : 1 / 1.2
      setScale(previous => {
        const next = Math.max(1, Math.min(5, previous * direction))
        if (next === 1) setOffset({ x: 0, y: 0 })
        return next
      })
    }
    image.addEventListener('wheel', handleWheel, { passive: false })
    return () => image.removeEventListener('wheel', handleWheel)
  }, [Boolean(proxiedSrc ?? cachedFullRes ?? placeholderSrc)])

  const handlePointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    if (scale <= 1 || event.button !== 0) return
    dragRef.current = { x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!dragRef.current) return
    const dx = event.clientX - dragRef.current.x
    const dy = event.clientY - dragRef.current.y
    dragRef.current = { x: event.clientX, y: event.clientY }
    setOffset(previous => ({ x: previous.x + dx, y: previous.y + dy }))
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }
  useFocusTrap(overlayRef)
  useCloseOnEscape(onClose, true, overlayRef)

  const displaySrc = proxiedSrc ?? cachedFullRes ?? placeholderSrc
  // Already-resolved (decrypted or plaintext-proxied) full-res bytes, or null.
  const resolvedUrl = proxiedSrc ?? cachedFullRes

  const handleDownload = () => {
    const options = { errorMessage: t('common.downloadFailed') }
    if (resolvedUrl) {
      void downloadFile(resolvedUrl, filename || 'image', options)
    } else if (encryption) {
      // Encrypted but not yet resolved: decrypt on demand. Never save the ciphertext URL.
      void downloadAttachment({ url: downloadUrl, name: filename, encryption }, options)
    } else {
      void downloadFile(downloadUrl, filename || 'image', options)
    }
  }

  return createPortal(
    <div
      ref={overlayRef}
      data-modal="true"
      data-lightbox="image"
      className="fixed-below-titlebar bg-black/90 flex flex-col items-center justify-center z-50"
    >
      {/* Click-outside-to-close backdrop (Escape also closes; see effect above) */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      {/* Top-right controls */}
      <div className="absolute top-4 end-4 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={handleDownload}
          className="p-2 text-white/70 hover:text-white rounded-full hover:bg-white/10 transition-colors"
          title={t(saveActionLabelKey())}
        >
          <SaveActionIcon className="size-6" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="p-2 text-white/70 hover:text-white rounded-full hover:bg-white/10 transition-colors"
          title={t('common.close')}
        >
          <X className="size-6" />
        </button>
      </div>

      {/* Image */}
      {displaySrc ? (
        <img
          ref={imageRef}
          src={displaySrc}
          alt={alt || 'Image'}
          className="relative z-10 max-w-[90vw] max-h-[calc((100vh-var(--fluux-window-titlebar-height))*0.85)] object-contain rounded-lg select-none"
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            cursor: scale > 1 ? (dragRef.current ? 'grabbing' : 'grab') : 'default',
            touchAction: 'none',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onContextMenu={imageMenu.handleContextMenu}
        />
      ) : (
        isLoading && <Loader2 className="size-8 text-white/70 animate-spin" />
      )}

      {/* Filename label */}
      {filename && (
        <div className="relative z-10 mt-3 text-white/70 text-sm truncate max-w-[90vw]">
          {filename}
        </div>
      )}

      <ImageContextMenu
        originalUrl={src}
        proxiedUrl={resolvedUrl}
        encryption={encryption}
        filename={filename}
        menu={imageMenu}
      />
    </div>,
    document.body
  )
}
