/** XEP-0333 read receipts for real, locally witnessed reads in one-to-one chats. */
import type { SideEffectHost } from './sideEffectHost'
import { subscribeLocalReads } from '../stores/localReadEvents'
import { chatStore } from '../stores/chatStore'
import { connectionStore } from '../stores/connectionStore'
import { getBareJid } from './jid'

export function setupReadReceiptsSideEffects(client: SideEffectHost): () => void {
  const sent = new Map<string, { id: string; timestamp: number }>()
  const unsubscribeRead = subscribeLocalReads(event => {
    if (event.kind !== 'chat' || !client.isConnected() || !client.messages) return
    if (event.account !== getBareJid(connectionStore.getState().jid ?? '')) return
    const rows = chatStore.getState().messages.get(event.conversationId) ?? []
    // Only acknowledge messages whose actual content was witnessed. Never send
    // an acknowledgement merely because the user focused the application.
    const seenThrough = event.pointer.order.timestamp
    const candidates = rows.filter(message => !message.isOutgoing && message.markable &&
      Number.isFinite(message.timestamp.getTime()) && message.timestamp.getTime() <= seenThrough)
    const newest = candidates[candidates.length - 1]
    if (!newest) return
    const messageId = newest.originId || newest.id
    const timestamp = newest.timestamp.getTime()
    const previous = sent.get(event.conversationId)
    if (previous && (previous.timestamp > timestamp ||
      (previous.timestamp === timestamp && previous.id === messageId))) return
    sent.set(event.conversationId, { id: messageId, timestamp })
    void client.messages.sendDisplayedMarker(event.conversationId, messageId).catch(() => {
      // Retry when this message is next read (including after reconnect).
      if (sent.get(event.conversationId)?.id === messageId) sent.delete(event.conversationId)
    })
  }, 'chat')
  const unsubscribeConnection = client.subscribe('connection:status', ({ status }) => {
    if (status !== 'online') sent.clear()
  })
  return () => { unsubscribeRead(); unsubscribeConnection() }
}
