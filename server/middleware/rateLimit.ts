// 速率限制配置
import rateLimit from 'express-rate-limit'

// 配置错误必须在启动时暴露，不能悄悄关闭限流或产生无效窗口。
export function positiveIntegerEnv(name: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER) {
  const configured = process.env[name]
  if (configured === undefined) return fallback
  const value = /^\d+$/.test(configured) ? Number(configured) : NaN
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} 必须是 1 到 ${maximum} 的整数`)
  }
  return value
}

// 两个登录路径共享此实例；成功和失败请求均消耗来源限额。
export const adminLoginLimiter = rateLimit({
  windowMs: positiveIntegerEnv('LOGIN_RATE_LIMIT_WINDOW_MS', 60 * 1000, 2147483647),
  max: positiveIntegerEnv('LOGIN_RATE_LIMIT_MAX', 10),
  message: {
    error: '登录请求过于频繁，请稍后再试',
  },
  standardHeaders: true,
  legacyHeaders: false,
})

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
