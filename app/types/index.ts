// 反馈类型定义
export interface Feedback {
  id: string
  category: 'suggestion' | 'complaint' | 'report'
  encrypted_content: string
  device_id: string
  created_at: string
  status: 'pending' | 'in_progress' | 'resolved' | 'no_solution'
  original_content?: string
  solution?: string
  solution_updated_at?: string
  solution_admin_ip?: string
}

// 评论类型
export interface FeedbackComment {
  id: number
  feedback_id: string
  commenter_type: 'user' | 'admin'
  content: string
  created_at: string
  admin_ip?: string
}

// 分类类型
export type Category = 'suggestion' | 'complaint' | 'report'

// 状态类型
export type FeedbackStatus = 'pending' | 'in_progress' | 'resolved' | 'no_solution'

// 分类配置
export interface CategoryConfig {
  id: Category
  name: string
  description: string
  icon: string
}

// API 响应类型
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
}

// 提交反馈请求
export interface SubmitFeedbackRequest {
  category: Category
  encryptedContent: string
  deviceId: string
  originalContent?: string
}

// 提交反馈响应
export interface SubmitFeedbackResponse {
  success: boolean
  id?: string
  timestamp?: number
  error?: string
}

// 统计数据
export interface Stats {
  total: number
  encrypted: number
  leaks: number
}

// 管理员日志
export interface AdminLog {
  id: number
  action: string
  target_id: string
  admin_ip: string
  created_at: string
}

// 分类统计
export interface CategoryStats {
  suggestion: number
  complaint: number
  report: number
}
