'use client'

import { useState, useEffect } from 'react'
import { renderBarChart, renderStatCard, renderAccessLogTable, renderBlacklistTable } from '../components/accessStats'

export default function AccessStatsPage() {
  const [password, setPassword] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [stats, setStats] = useState<any>(null)
  const [recentLogs, setRecentLogs] = useState<any[]>([])
  const [suspiciousLogs, setSuspiciousLogs] = useState<any[]>([])
  const [blacklist, setBlacklist] = useState<any[]>([])
  const [selectedTab, setSelectedTab] = useState<'overview' | 'logs' | 'suspicious' | 'blacklist'>('overview')
  const [loading, setLoading] = useState(false)

  const ADMIN_PASSWORD = 'anonyproof_admin_2026'

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    if (password === ADMIN_PASSWORD) {
      setIsAuthenticated(true)
      fetchData()
    } else {
      alert('密码错误')
    }
  }

  const fetchData = async () => {
    setLoading(true)
    try {
      const [statsRes, logsRes, suspiciousRes, blacklistRes] = await Promise.all([
        fetch('/anonyproof/api/admin/access/stats'),
        fetch('/anonyproof/api/admin/access/logs?limit=100'),
        fetch('/anonyproof/api/admin/access/suspicious?limit=50'),
        fetch('/anonyproof/api/admin/access/blacklist'),
      ])

      const statsData = await statsRes.json()
      const logsData = await logsRes.json()
      const suspiciousData = await suspiciousRes.json()
      const blacklistData = await blacklistRes.json()

      if (statsData.success) setStats(statsData.data)
      if (logsData.success) setRecentLogs(logsData.data)
      if (suspiciousData.success) setSuspiciousLogs(suspiciousData.data)
      if (blacklistData.success) setBlacklist(blacklistData.data)
    } catch (error) {
      console.error('获取数据失败:', error)
      alert('获取数据失败')
    } finally {
      setLoading(false)
    }
  }

  const handleUnblacklist = async (ip: string) => {
    if (!confirm(`确定要解除 IP ${ip} 的黑名单吗？`)) return

    try {
      const res = await fetch(`/anonyproof/api/admin/access/blacklist/${ip}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (data.success) {
        alert('已解除黑名单')
        fetchData()
      } else {
        alert(data.error || '操作失败')
      }
    } catch (error) {
      console.error('解除黑名单失败:', error)
      alert('操作失败')
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      const interval = setInterval(fetchData, 30000) // 每 30 秒刷新
      return () => clearInterval(interval)
    }
  }, [isAuthenticated])

  if (!isAuthenticated) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #f5f7fa 0%, #c3cfe2 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}>
        <div style={{
          background: 'rgba(255, 255, 255, 0.7)',
          backdropFilter: 'blur(20px)',
          padding: '40px',
          borderRadius: '24px',
          boxShadow: '0 8px 32px rgba(31, 38, 135, 0.15)',
          maxWidth: '400px',
          width: '100%',
        }}>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#1d1d1f', marginBottom: '24px', textAlign: 'center' }}>
            🔐 访问统计登录
          </h1>
          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入管理员密码"
              style={{
                width: '100%',
                padding: '12px 16px',
                fontSize: '16px',
                border: '2px solid rgba(0, 0, 0, 0.1)',
                borderRadius: '12px',
                marginBottom: '20px',
                boxSizing: 'border-box',
              }}
            />
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '14px',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                fontSize: '16px',
                fontWeight: '700',
                cursor: 'pointer',
              }}
            >
              登录
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #f5f7fa 0%, #c3cfe2 100%)',
      padding: '24px',
    }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* 头部 */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '32px',
          paddingBottom: '20px',
          borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
        }}>
          <div>
            <h1 style={{ fontSize: '28px', fontWeight: '800', color: '#1d1d1f', margin: 0 }}>
              📊 访问统计与分析
            </h1>
            <p style={{ fontSize: '14px', color: '#86868b', margin: '4px 0 0 0' }}>
              实时监控平台访问情况，检测和阻止恶意访问
            </p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={fetchData}
              disabled={loading}
              style={{
                padding: '10px 20px',
                background: 'rgba(102, 126, 234, 0.1)',
                border: '1px solid #667eea',
                borderRadius: '8px',
                fontSize: '14px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? '加载中...' : '🔄 刷新'}
            </button>
            <button
              onClick={() => {
                setIsAuthenticated(false)
                setPassword('')
              }}
              style={{
                padding: '10px 20px',
                background: 'rgba(255, 255, 255, 0.5)',
                border: '1px solid rgba(0, 0, 0, 0.1)',
                borderRadius: '8px',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              退出登录
            </button>
          </div>
        </div>

        {/* 标签切换 */}
        <div style={{ marginBottom: '24px' }}>
          <button
            onClick={() => setSelectedTab('overview')}
            style={{
              padding: '10px 20px',
              background: selectedTab === 'overview' ? 'rgba(102, 126, 234, 0.1)' : 'transparent',
              border: selectedTab === 'overview' ? '2px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              color: selectedTab === 'overview' ? '#667eea' : '#86868b',
              cursor: 'pointer',
              marginRight: '12px',
            }}
          >
            📈 概览
          </button>
          <button
            onClick={() => setSelectedTab('logs')}
            style={{
              padding: '10px 20px',
              background: selectedTab === 'logs' ? 'rgba(102, 126, 234, 0.1)' : 'transparent',
              border: selectedTab === 'logs' ? '2px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              color: selectedTab === 'logs' ? '#667eea' : '#86868b',
              cursor: 'pointer',
              marginRight: '12px',
            }}
          >
            📋 访问日志
          </button>
          <button
            onClick={() => setSelectedTab('suspicious')}
            style={{
              padding: '10px 20px',
              background: selectedTab === 'suspicious' ? 'rgba(255, 59, 48, 0.1)' : 'transparent',
              border: selectedTab === 'suspicious' ? '2px solid #ff3b30' : '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              color: selectedTab === 'suspicious' ? '#ff3b30' : '#86868b',
              cursor: 'pointer',
              marginRight: '12px',
            }}
          >
            ⚠️ 可疑访问
          </button>
          <button
            onClick={() => setSelectedTab('blacklist')}
            style={{
              padding: '10px 20px',
              background: selectedTab === 'blacklist' ? 'rgba(0, 0, 0, 0.05)' : 'transparent',
              border: selectedTab === 'blacklist' ? '2px solid #000' : '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              color: selectedTab === 'blacklist' ? '#000' : '#86868b',
              cursor: 'pointer',
            }}
          >
            🚫 黑名单 ({blacklist.length})
          </button>
        </div>

        {/* 概览 */}
        {selectedTab === 'overview' && stats && (
          <div>
            {/* 今日统计 */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: '16px',
              marginBottom: '24px',
            }}>
              <div dangerouslySetInnerHTML={{
                __html: renderStatCard(
                  '今日访问',
                  stats.today.total_visits,
                  `独立访客: ${stats.today.unique_visitors}`,
                  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                )
              }} />
              <div dangerouslySetInnerHTML={{
                __html: renderStatCard(
                  '独立访客',
                  stats.today.unique_visitors,
                  '今日独立 IP 数',
                  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)'
                )
              }} />
              <div dangerouslySetInnerHTML={{
                __html: renderStatCard(
                  '爬虫访问',
                  stats.today.bot_visits,
                  '今日爬虫请求数',
                  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)'
                )
              }} />
              <div dangerouslySetInnerHTML={{
                __html: renderStatCard(
                  '可疑访问',
                  stats.today.suspicious_visits,
                  '今日可疑访问数',
                  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)'
                )
              }} />
              <div dangerouslySetInnerHTML={{
                __html: renderStatCard(
                  '黑名单 IP',
                  stats.blacklistedIPs,
                  '当前黑名单数量',
                  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)'
                )
              }} />
            </div>

            {/* 最近 7 天趋势 */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.6)',
              backdropFilter: 'blur(10px)',
              padding: '24px',
              borderRadius: '16px',
              marginBottom: '24px',
            }}>
              <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#1d1d1d', marginBottom: '16px' }}>
                📅 最近 7 天访问趋势
              </h3>
              <div dangerouslySetInnerHTML={{
                __html: renderBarChart(
                  stats.last7Days.map((day: any) => ({
                    label: day.date.slice(5),
                    value: day.total_visits,
                  })),
                  Math.max(...stats.last7Days.map((day: any) => day.total_visits))
                )
              }} />
            </div>
          </div>
        )}

        {/* 访问日志 */}
        {selectedTab === 'logs' && (
          <div dangerouslySetInnerHTML={{
            __html: renderAccessLogTable(recentLogs, '📋 最近访问日志')
          }} />
        )}

        {/* 可疑访问 */}
        {selectedTab === 'suspicious' && (
          <div>
            <div style={{ marginBottom: '24px', padding: '16px', background: 'rgba(255, 59, 48, 0.1)', borderRadius: '12px', border: '1px solid rgba(255, 59, 48, 0.3)' }}>
              <p style={{ margin: 0, fontSize: '14px', color: '#ff3b30' }}>
                ⚠️ 以下访问被检测为可疑行为，包括：空 User-Agent、脚本特征、敏感路径访问等。
              </p>
            </div>
            <div dangerouslySetInnerHTML={{
              __html: renderAccessLogTable(suspiciousLogs, '⚠️ 可疑访问日志')
            }} />
          </div>
        )}

        {/* 黑名单 */}
        {selectedTab === 'blacklist' && (
          <div>
            <div style={{ marginBottom: '24px', padding: '16px', background: 'rgba(0, 0, 0, 0.05)', borderRadius: '12px', border: '1px solid rgba(0, 0, 0, 0.1)' }}>
              <p style={{ margin: 0, fontSize: '14px', color: '#1d1d1d' }}>
                🚫 黑名单中的 IP 将被完全阻止访问平台。IP 会因触发速率限制 10 次或被手动添加而进入黑名单。
              </p>
            </div>
            <div dangerouslySetInnerHTML={{
              __html: renderBlacklistTable(blacklist, handleUnblacklist)
            }} />
          </div>
        )}
      </div>
    </div>
  )
}
