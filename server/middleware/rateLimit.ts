// 速率限制配置
import rateLimit from 'express-rate-limit'

// 提交反馈速率限制
export const feedbackSubmitLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  max: 10, // 最多 10 次请求
  message: {
    error: '提交过于频繁，请稍后再试',
  },
  standardHeaders: true, // 返回标准的速率限制头
  legacyHeaders: false, // 禁用 X-RateLimit-* 头
})

// 管理员 API 速率限制
export const adminApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  max: 100, // 最多 100 次请求
  message: {
    error: '请求过于频繁，请稍后再试',
  },
  standardHeaders: true,
  legacyHeaders: false,
})

// 通用 API 速率限制
export const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  max: 60, // 最多 60 次请求
  message: {
    error: '请求过于频繁，请稍后再试',
  },
  standardHeaders: true,
  legacyHeaders: false,
})
