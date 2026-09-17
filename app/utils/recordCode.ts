// 列表和详情里只展示记录编号短码。真实提交的编号是 UUID，截取前 8 位即可区分；
// 演示模板的编号共用 demo-feedback- 前缀，直接截断会让多条记录显示成同一个编号，
// 因此为它们按内容生成一个稳定的短码。
const demoTemplatePrefix = 'demo-feedback-'

function shortHash(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).toUpperCase().padStart(8, '0').slice(0, 4)
}

export function recordCode(id: string) {
  if (!id) return ''
  if (id.startsWith(demoTemplatePrefix)) return `DEMO-${shortHash(id)}`
  return id.slice(0, 8).toUpperCase()
}
