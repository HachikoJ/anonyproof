// 分类常量
import { CategoryConfig, Category } from '../types'

export const CATEGORIES: CategoryConfig[] = [
  {
    id: 'suggestion',
    name: '建议',
    description: '产品改进建议',
    icon: '💡',
  },
  {
    id: 'complaint',
    name: '投诉',
    description: '问题反馈',
    icon: '⚠️',
  },
  {
    id: 'report',
    name: '举报',
    description: '违规举报',
    icon: '🔔',
  },
]

// 反馈内容限制
export const FEEDBACK_LIMITS = {
  MIN_LENGTH: 10,
  MAX_LENGTH: 10000,
  MIN_LENGTH_MESSAGE: '内容过短（至少 10 个字符）',
  MAX_LENGTH_MESSAGE: '内容过长（最多 10000 个字符）',
}

// API 端点
export const API_ENDPOINTS = {
  STATS: '/anonyproof/api/stats',
  FEEDBACK: '/anonyproof/api/feedback',
  FEEDBACK_DEVICE: (deviceId: string) => `/anonyproof/api/feedback/device/${deviceId}`,
  ADMIN_FEEDBACKS: '/anonyproof/api/admin/feedbacks',
  ADMIN_FEEDBACK: (id: string) => `/anonyproof/api/admin/feedback/${id}`,
  ADMIN_FEEDBACK_STATUS: (id: string) => `/anonyproof/api/admin/feedback/${id}/status`,
  ADMIN_LOGS: '/anonyproof/api/admin/logs',
}

// 管理员密码（从环境变量读取，开发环境使用默认值）
export const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'anonyproof_admin_2026'

// 自动返回时间（毫秒）
export const AUTO_RETURN_DELAY = 1000

// 统计刷新间隔（毫秒）
export const STATS_REFRESH_INTERVAL = 30000
