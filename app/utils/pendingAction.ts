// Keys/target metadata only in sessionStorage. Draft content stays in memory.
// Backend compares the accepted semantic content after a reload.
export class PendingActionError extends Error {}
type Action = 'feedback' | 'user_comment' | 'admin_comment'
type Pending = { key: string; action: Action; target: string; semantic?: string }
export function createPendingActions(storage: () => Storage = () => window.sessionStorage,
  makeKey = () => `v1:${Date.now()}:${crypto.randomUUID()}`) {
  const memory = new Map<string, Pending>()
  const slot = (action: Action, target: string, owner: string) => `anonyproof:pending:v1:${owner}:${action}:${target}`
  function load(action: Action, target: string, owner: string) {
    const name = slot(action, target, owner)
    let value = memory.get(name)
    if (value) return value
    let raw: string | null
    try { raw = storage().getItem(name) } catch { throw new PendingActionError('浏览器无法读取重试动作。请先检查已有提交或沟通记录，本次未发送。') }
    if (raw !== null) {
      try {
        const saved = JSON.parse(raw)
        if (!saved || Object.keys(saved).sort().join(',') !== 'action,key,target' || saved.action !== action ||
          saved.target !== target || typeof saved.key !== 'string' || !/^v1:[0-9]{1,16}:[0-9a-f-]{36}$/.test(saved.key)) throw new Error()
        value = { key: saved.key, action, target }
      } catch { throw new PendingActionError('保存的重试动作无效。请先检查旧结果，再明确选择另作提交，本次未发送。') }
      memory.set(name, value)
    }
    return value
  }
  return {
    begin(action: Action, target: string, owner: string, semantic: unknown) {
      const name = slot(action, target, owner)
      const payload = JSON.stringify(semantic)
      const pending = load(action, target, owner) || { key: makeKey(), action, target, semantic: payload }
      if (pending.semantic !== undefined && pending.semantic !== payload) {
        throw new PendingActionError('上次动作尚未确认，当前内容已改变。请先检查旧结果，确需另作提交时选择“另作一次提交”。')
      }
      pending.semantic = payload
      memory.set(name, pending)
      try { storage().setItem(name, JSON.stringify({ key: pending.key, action, target })) }
      catch { throw new PendingActionError('浏览器无法保存重试动作，本次未发送。请先检查旧结果；恢复存储后重试会沿用原动作。') }
      return pending.key
    },
    complete(action: Action, target: string, owner: string) {
      const name = slot(action, target, owner)
      try { storage().removeItem(name) } catch { throw new PendingActionError('提交已完成，但浏览器未能清除重试动作。请检查已有结果，不要另作重复提交。') }
      memory.delete(name)
    },
    abandon(action: Action, target: string, owner: string) {
      const name = slot(action, target, owner)
      try { storage().removeItem(name) } catch { throw new PendingActionError('浏览器无法清除旧动作，本次不会创建新动作。请先检查已有结果。') }
      memory.delete(name)
    },
  }
}
