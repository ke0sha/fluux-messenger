import type { FileAttachment } from '@fluux/sdk'
import { useToastStore } from '@/stores/toastStore'

/**
 * Windows document attachments live directly in the user's Downloads folder.
 * A filename is not a unique attachment ID: remember which XMPP URL last
 * wrote each filename so that similarly named attachments are never silently
 * mistaken for each other. The association persists across app restarts.
 *
 * Button "save": ask before replacing any existing file.
 * Card "open": open a previously saved matching file, otherwise download
 * (asking before replacing a conflicting file) and launch the OS default app.
 */
const pendingByFilename = new Map<string, Promise<void>>()
const knownOwners = new Map<string, string>()
const storagePrefix = 'fluux:attachment-download-owner:v1:'

function safeFilename(name: string | undefined): string {
  const leaf = (name || 'attachment').replace(/\\/g, '/').split('/').pop() || 'attachment'
  let cleaned = leaf.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 160)
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)) cleaned = `_${cleaned}`
  return cleaned || 'attachment'
}

function ownerStorageKey(filename: string): string {
  return `${storagePrefix}${filename.toLowerCase()}`
}

function getSavedOwner(filename: string): string | null {
  const key = ownerStorageKey(filename)
  try {
    return localStorage.getItem(key) ?? knownOwners.get(key) ?? null
  } catch {
    return knownOwners.get(key) ?? null
  }
}

function rememberSavedOwner(filename: string, owner: string): void {
  const key = ownerStorageKey(filename)
  knownOwners.set(key, owner)
  try {
    localStorage.setItem(key, owner)
  } catch {
    // The current session still remembers the association if storage is blocked.
  }
}

async function sourceIdentity(attachment: FileAttachment): Promise<string> {
  // Do not store media URLs or encryption metadata as plain text in localStorage.
  const data = new TextEncoder().encode(`${attachment.url}\u0000${JSON.stringify(attachment.encryption ?? null)}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map(v => v.toString(16).padStart(2, '0'))
    .join('')
}

async function resolveAttachmentUrl(attachment: FileAttachment): Promise<string> {
  const { resolveEncryptedMediaUrl, resolveMediaUrl } = await import('./mediaCache')
  if (attachment.encryption) return resolveEncryptedMediaUrl(attachment.url, attachment.encryption)
  return resolveMediaUrl(attachment.url)
}

async function confirmOverwrite(filename: string): Promise<boolean> {
  const { ask } = await import('@tauri-apps/plugin-dialog')
  return ask(`Файл «${filename}» уже существует в папке «Загрузки». Заменить его?`, {
    title: 'Fluux Messenger Custom',
    kind: 'warning',
    okLabel: 'Заменить',
    cancelLabel: 'Отмена',
  })
}

async function saveOrOpen(attachment: FileAttachment, mode: 'save' | 'open', filename: string): Promise<void> {
  const { downloadDir, join } = await import('@tauri-apps/api/path')
  const { exists, writeFile, rename, remove } = await import('@tauri-apps/plugin-fs')
  const path = await join(await downloadDir(), filename)
  const owner = await sourceIdentity(attachment)
  const alreadyExists = await exists(path)

  // Opening a file known to belong to this exact attachment needs no download.
  if (mode === 'open' && alreadyExists && getSavedOwner(filename) === owner) {
    const { openPath } = await import('@tauri-apps/plugin-opener')
    await openPath(path)
    return
  }

  // An explicit save asks every time; opening an existing but unrecognized
  // filename asks too, rather than opening somebody else's same-named file.
  if (alreadyExists && !(await confirmOverwrite(filename))) return

  // Download and decrypt everything before touching an existing local file.
  const mediaUrl = await resolveAttachmentUrl(attachment)
  const response = await fetch(mediaUrl)
  if (!response.ok) throw new Error(`Unable to download attachment: HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())

  // Stage the complete download in Downloads, then replace the old file.
  // If the replacement fails, restore the original from its temporary backup.
  const dir = await downloadDir()
  const tempPath = await join(dir, `.fluux-download-${crypto.randomUUID()}.tmp`)
  const backupPath = await join(dir, `.fluux-backup-${crypto.randomUUID()}.tmp`)
  await writeFile(tempPath, bytes)
  let backedUp = false
  try {
    if (await exists(path)) {
      await rename(path, backupPath)
      backedUp = true
    }
    try {
      await rename(tempPath, path)
    } catch (error) {
      if (backedUp) {
        await rename(backupPath, path).catch(restoreError => {
          console.error('[attachment] Could not restore replaced file:', backupPath, restoreError)
        })
      }
      throw error
    }
  } finally {
    await remove(tempPath).catch(() => {})
    if (backedUp && await exists(path)) {
      await remove(backupPath).catch(() => {})
    }
  }

  rememberSavedOwner(filename, owner)
  if (mode === 'open') {
    const { openPath } = await import('@tauri-apps/plugin-opener')
    await openPath(path)
  }
}

/** Queue operations by Windows filename, preventing simultaneous name collisions. */
export async function handleWindowsAttachment(
  attachment: FileAttachment,
  mode: 'save' | 'open',
  errorMessage: string,
): Promise<void> {
  const filename = safeFilename(attachment.name)
  const key = filename.toLowerCase()
  const previous = pendingByFilename.get(key)
  const operation = (async () => {
    try {
      // One failed download must not block later attempts.
      if (previous) await previous.catch(() => {})
      await saveOrOpen(attachment, mode, filename)
    } catch (error) {
      console.error('[attachment] Windows file operation failed:', error)
      useToastStore.getState().addToast('error', errorMessage)
    }
  })()
  pendingByFilename.set(key, operation)
  try {
    await operation
  } finally {
    if (pendingByFilename.get(key) === operation) pendingByFilename.delete(key)
  }
}
