// 访问统计组件（用于管理后台）

export interface AccessStatsData {
  today: {
    total_visits: number
    unique_visitors: number
    bot_visits: number
    suspicious_visits: number
    avg_response_time: number
  }
  total: {
    total_visits: number
    unique_visitors: number
    bot_visits: number
    suspicious_visits: number
    avg_response_time: number
  }
  blacklistedIPs: number
  last7Days: Array<{
    date: string
    total_visits: number
    unique_visitors: number
    bot_visits: number
    suspicious_visits: number
  }>
}

export interface AccessLog {
  id: number
  ip: string
  user_agent: string
  path: string
  method: string
  status_code: number
  response_time: number
  is_bot: number
  is_suspicious: number
  suspicious_reason: string
  created_at: string
}

export interface SuspiciousLog {
  id: number
  ip: string
  user_agent: string
  path: string
  method: string
  status_code: number
  suspicious_reason: string
  created_at: string
}

export interface BlacklistedIP {
  id: number
  ip: string
  reason: string
  attempts: number
  blacklisted_at: string
  expires_at: string | null
}

// 简单的图表渲染函数（使用纯 CSS）
export function renderBarChart(data: Array<{ label: string; value: number }>, max: number) {
  const bars = data.map((item) => {
    const percentage = (item.value / max) * 100
    return `
      <div style="margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
          <span style="color: #86868b;">${item.label}</span>
          <span style="color: #667eea; font-weight: 600;">${item.value}</span>
        </div>
        <div style="width: 100%; background: rgba(0, 0, 0, 0.05); border-radius: 4px; height: 8px;">
          <div style="width: ${percentage}%; background: linear-gradient(90deg, #667eea 0%, #764ba2 100%); height: 100%; border-radius: 4px; transition: width 0.3s;"></div>
        </div>
      </div>
    `
  }).join('')

  return bars
}

// 渲染统计卡片
export function renderStatCard(title: string, value: number | string, subtitle: string, color: string) {
  return `
    <div style="background: ${color}; padding: 20px; border-radius: 16px; color: white;">
      <div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">${title}</div>
      <div style="font-size: 32px; font-weight: 800;">${value}</div>
      <div style="font-size: 12px; opacity: 0.8; margin-top: 4px;">${subtitle}</div>
    </div>
  `
}

// 渲染访问日志表格
export function renderAccessLogTable(logs: AccessLog[], title: string) {
  if (!logs || logs.length === 0) {
    return `
      <div style="background: rgba(255, 255, 255, 0.6); backdrop-filter: blur(10px); padding: 24px; border-radius: 16px; margin-bottom: 24px;">
        <h3 style="font-size: 18px; font-weight: 700; color: #1d1d1d; margin-bottom: 16px;">${title}</h3>
        <p style="color: #86868b; text-align: center; padding: 40px;">暂无数据</p>
      </div>
    `
  }

  const rows = logs.map((log) => {
    const isSuspicious = log.is_suspicious === 1
    const isBot = log.is_bot === 1

    return `
      <tr style="${isSuspicious ? 'background: rgba(255, 59, 48, 0.05);' : ''}">
        <td style="padding: 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.05); font-size: 13px;">${log.created_at}</td>
        <td style="padding: 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.05); font-size: 13px; font-family: monospace;">${log.ip}</td>
        <td style="padding: 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.05); font-size: 13px;">${log.method}</td>
        <td style="padding: 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.05); font-size: 13px; font-family: monospace;">${log.path}</td>
        <td style="padding: 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.05); font-size: 13px; text-align: center;">${log.status_code}</td>
        <td style="padding: 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.05); font-size: 13px; text-align: center;">${log.response_time}ms</td>
        <td style="padding: 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.05); font-size: 13px; text-align: center;">
          ${isBot ? '<span style="background: #f093fb; color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px;">爬虫</span>' : ''}
          ${isSuspicious ? '<span style="background: #ff3b30; color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px;">可疑</span>' : ''}
        </td>
      </tr>
    `
  }).join('')

  return `
    <div style="background: rgba(255, 255, 255, 0.6); backdrop-filter: blur(10px); padding: 24px; border-radius: 16px; margin-bottom: 24px;">
      <h3 style="font-size: 18px; font-weight: 700; color: #1d1d1d; margin-bottom: 16px;">${title}</h3>
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 2px solid rgba(0, 0, 0, 0.1);">
              <th style="padding: 12px; text-align: left; font-size: 12px; color: #86868b; font-weight: 600;">时间</th>
              <th style="padding: 12px; text-align: left; font-size: 12px; color: #86868b; font-weight: 600;">IP</th>
              <th style="padding: 12px; text-align: left; font-size: 12px; color: #86868b; font-weight: 600;">方法</th>
              <th style="padding: 12px; text-align: left; font-size: 12px; color: #86868b; font-weight: 600;">路径</th>
              <th style="padding: 12px; text-align: center; font-size: 12px; color: #86868b; font-weight: 600;">状态</th>
              <th style="padding: 12px; text-align: center; font-size: 12px; color: #86868b; font-weight: 600;">响应时间</th>
              <th style="padding: 12px; text-align: center; font-size: 12px; color: #86868b; font-weight: 600;">标签</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `
}

// 渲染黑名单表格
export function renderBlacklistTable(blacklist: BlacklistedIP[], onUnblacklist: (ip: string) => void) {
  if (!blacklist || blacklist.length === 0) {
    return `
      <div style="background: rgba(255, 255, 255, 0.6); backdrop-filter: blur(10px); padding: 24px; border-radius: 16px;">
        <h3 style="font-size: 18px; font-weight: 700; color: #1d1d1d; margin-bottom: 16px;">🚫 IP 黑名单</h3>
        <p style="color: #86868b; text-align: center; padding: 40px;">暂无黑名单 IP</p>
      </div>
    `
  }

  const rows = blacklist.map((item) => {
    return `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.05); font-size: 13px; font-family: monospace;">${item.ip}</td>
        <td style="padding: 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.05); font-size: 13px;">${item.reason}</td>
        <td style="padding: 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.05); font-size: 13px; text-align: center;">${item.attempts}</td>
        <td style="padding: 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.05); font-size: 13px;">${item.blacklisted_at}</td>
        <td style="padding: 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.05); font-size: 13px;">${item.expires_at || '永久'}</td>
        <td style="padding: 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.05); font-size: 13px; text-align: center;">
          <button onclick="unblacklistIP('${item.ip}')" style="padding: 6px 12px; background: rgba(52, 199, 89, 0.1); border: 1px solid #34c759; border-radius: 6px; font-size: 12px; cursor: pointer; color: #34c759;">解除</button>
        </td>
      </tr>
    `
  }).join('')

  return `
    <div style="background: rgba(255, 255, 255, 0.6); backdrop-filter: blur(10px); padding: 24px; border-radius: 16px;">
      <h3 style="font-size: 18px; font-weight: 700; color: #1d1d1d; margin-bottom: 16px;">🚫 IP 黑名单</h3>
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 2px solid rgba(0, 0, 0, 0.1);">
              <th style="padding: 12px; text-align: left; font-size: 12px; color: #86868b; font-weight: 600;">IP</th>
              <th style="padding: 12px; text-align: left; font-size: 12px; color: #86868b; font-weight: 600;">原因</th>
              <th style="padding: 12px; text-align: center; font-size: 12px; color: #86868b; font-weight: 600;">违规次数</th>
              <th style="padding: 12px; text-align: left; font-size: 12px; color: #86868b; font-weight: 600;">加入时间</th>
              <th style="padding: 12px; text-align: left; font-size: 12px; color: #86868b; font-weight: 600;">过期时间</th>
              <th style="padding: 12px; text-align: center; font-size: 12px; color: #86868b; font-weight: 600;">操作</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `
}
