// 增强的速率限制配置（支持反爬虫）
import rateLimit from 'express-rate-limit'
import { logRateLimit } from './accessStats'

// 严格速率限制（针对可疑 IP）
export const strictRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  max: 5, // 最多 5 次请求
  message: {
    error: '请求过于频繁，请稍后再试',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    logRateLimit(ip, req.path, 'Strict rate limit exceeded')
    res.status(429).json({
      error: '请求过于频繁，请稍后再试',
      retryAfter: Math.round(options.windowMs / 1000),
    })
  },
})

// 提交反馈速率限制
export const feedbackSubmitLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  max: 10, // 最多 10 次请求
  message: {
    error: '提交过于频繁，请稍后再试',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    logRateLimit(ip, req.path, 'Feedback submission rate limit exceeded')
    res.status(429).json({
      error: '提交过于频繁，请稍后再试',
      retryAfter: Math.round(options.windowMs / 1000),
    })
  },
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
  handler: (req, res, next, options) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    logRateLimit(ip, req.path, 'Admin API rate limit exceeded')
    res.status(429).json({
      error: '请求过于频繁，请稍后再试',
      retryAfter: Math.round(options.windowMs / 1000),
    })
  },
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
  handler: (req, res, next, options) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    logRateLimit(ip, req.path, 'General API rate limit exceeded')
    res.status(429).json({
      error: '请求过于频繁，请稍后再试',
      retryAfter: Math.round(options.windowMs / 1000),
    })
  },
})

// IP 白名单检查（管理员 IP）
export const checkAdminIP = (allowedIPs: string[]) => {
  return (req: any, res: any, next: any) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    if (allowedIPs.includes(ip)) {
      next()
    } else {
      logRateLimit(ip, req.path, 'Unauthorized admin access attempt')
      res.status(403).json({ error: '访问被拒绝' })
    }
  }
}
