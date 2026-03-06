'use client'

import { useState, useEffect } from 'react'
import { useCrypto } from '../hooks/useCrypto'

export default function AdminPage() {
  const [password, setPassword] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [feedbacks, setFeedbacks] = useState<any[]>([])
  const [selectedFeedback, setSelectedFeedback] = useState<any>(null)
  const [logs, setLogs] = useState<any[]>([])
  const [stats, setStats] = useState({ total: 0, encrypted: 0, leaks: 0 })
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [categoryStats, setCategoryStats] = useState({ suggestion: 0, complaint: 0, report: 0 })

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
    try {
      const feedbacksRes = await fetch('/anonyproof/api/admin/feedbacks')
      const feedbacksData = await feedbacksRes.json()
      if (feedbacksData.success) {
        setFeedbacks(feedbacksData.feedbacks)
        // 计算分类统计
        const stats = {
          suggestion: feedbacksData.feedbacks.filter((f: any) => f.category === 'suggestion').length,
          complaint: feedbacksData.feedbacks.filter((f: any) => f.category === 'complaint').length,
          report: feedbacksData.feedbacks.filter((f: any) => f.category === 'report').length
        }
        setCategoryStats(stats)
      }

      const logsRes = await fetch('/anonyproof/api/admin/logs')
      const logsData = await logsRes.json()
      if (logsData.success) {
        setLogs(logsData.logs)
      }

      const statsRes = await fetch('/anonyproof/api/stats')
      const statsData = await statsRes.json()
      setStats(statsData)
    } catch (error) {
      console.error('获取数据失败:', error)
      alert('获取数据失败')
    }
  }

  const handleStatusUpdate = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/anonyproof/api/admin/feedback/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const data = await res.json()
      if (data.success) {
        alert('状态已更新')
        fetchData()
      } else {
        alert(data.error || '更新失败')
      }
    } catch (error) {
      console.error('更新状态失败:', error)
      alert('更新失败')
    }
  }

  const handleExportData = () => {
    const filteredFeedbacks = selectedCategory === 'all'
      ? feedbacks
      : feedbacks.filter(f => f.category === selectedCategory)

    // 准备 CSV 数据
    const headers = ['ID', '分类', '设备ID', '提交时间', '状态', '内容']
    const rows = filteredFeedbacks.map(f => [
      f.id,
      f.category === 'suggestion' ? '建议' : f.category === 'complaint' ? '投诉' : '举报',
      f.device_id,
      new Date(f.created_at).toLocaleString('zh-CN'),
      f.status === 'pending' ? '待处理' : '已完成',
      f.original_content || ''
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')

    // 创建下载
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `anonyproof_export_${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const filteredFeedbacks = selectedCategory === 'all'
    ? feedbacks
    : feedbacks.filter(f => f.category === selectedCategory)

  if (!isAuthenticated) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        background: 'linear-gradient(180deg, #f5f7fa 0%, #c3cfe2 100%)',
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        padding: '20px'
      }}>
        <div style={{ 
          background: 'rgba(255, 255, 255, 0.7)',
          backdropFilter: 'blur(20px)',
          padding: '40px',
          borderRadius: '24px',
          boxShadow: '0 8px 32px rgba(31, 38, 135, 0.15)',
          maxWidth: '400px',
          width: '100%',
          border: '1px solid rgba(255, 255, 255, 0.3)'
        }}>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#1d1d1f', marginBottom: '24px', textAlign: 'center' }}>
            🔐 管理员登录
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
              🔐 匿证管理后台
            </h1>
            <p style={{ fontSize: '14px', color: '#86868b', margin: '4px 0 0 0' }}>
              总反馈: {stats.total} · 加密率: 100% · 数据泄露: {stats.leaks}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleExportData}
              style={{
                padding: '10px 20px',
                background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              📥 导出数据
            </button>
            <button
              onClick={() => {
                setIsAuthenticated(false)
                setPassword('')
                setSelectedFeedback(null)
                setFeedbacks([])
                setLogs([])
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

        {/* 分类统计卡片 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '16px',
          marginBottom: '24px',
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            padding: '20px',
            borderRadius: '16px',
            color: 'white',
          }}>
            <div style={{ fontSize: '14px', opacity: 0.9, marginBottom: '8px' }}>全部反馈</div>
            <div style={{ fontSize: '32px', fontWeight: '800' }}>{stats.total}</div>
          </div>
          <div style={{
            background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
            padding: '20px',
            borderRadius: '16px',
            color: 'white',
          }}>
            <div style={{ fontSize: '14px', opacity: 0.9, marginBottom: '8px' }}>💡 建议</div>
            <div style={{ fontSize: '32px', fontWeight: '800' }}>{categoryStats.suggestion}</div>
          </div>
          <div style={{
            background: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
            padding: '20px',
            borderRadius: '16px',
            color: 'white',
          }}>
            <div style={{ fontSize: '14px', opacity: 0.9, marginBottom: '8px' }}>⚠️ 投诉</div>
            <div style={{ fontSize: '32px', fontWeight: '800' }}>{categoryStats.complaint}</div>
          </div>
          <div style={{
            background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
            padding: '20px',
            borderRadius: '16px',
            color: 'white',
          }}>
            <div style={{ fontSize: '14px', opacity: 0.9, marginBottom: '8px' }}>🔔 举报</div>
            <div style={{ fontSize: '32px', fontWeight: '800' }}>{categoryStats.report}</div>
          </div>
        </div>

        {/* 分类筛选按钮 */}
        <div style={{ marginBottom: '24px' }}>
          <span style={{ fontSize: '14px', fontWeight: '600', color: '#86868b', marginRight: '12px' }}>筛选:</span>
          <button
            onClick={() => {
              setSelectedCategory('all')
              setSelectedFeedback(null)
            }}
            style={{
              padding: '8px 16px',
              background: selectedCategory === 'all' ? 'rgba(102, 126, 234, 0.1)' : 'transparent',
              border: selectedCategory === 'all' ? '2px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              color: selectedCategory === 'all' ? '#667eea' : '#86868b',
              cursor: 'pointer',
              marginRight: '8px',
            }}
          >
            全部 ({stats.total})
          </button>
          <button
            onClick={() => {
              setSelectedCategory('suggestion')
              setSelectedFeedback(null)
            }}
            style={{
              padding: '8px 16px',
              background: selectedCategory === 'suggestion' ? 'rgba(102, 126, 234, 0.1)' : 'transparent',
              border: selectedCategory === 'suggestion' ? '2px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              color: selectedCategory === 'suggestion' ? '#667eea' : '#86868b',
              cursor: 'pointer',
              marginRight: '8px',
            }}
          >
            💡 建议 ({categoryStats.suggestion})
          </button>
          <button
            onClick={() => {
              setSelectedCategory('complaint')
              setSelectedFeedback(null)
            }}
            style={{
              padding: '8px 16px',
              background: selectedCategory === 'complaint' ? 'rgba(102, 126, 234, 0.1)' : 'transparent',
              border: selectedCategory === 'complaint' ? '2px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              color: selectedCategory === 'complaint' ? '#667eea' : '#86868b',
              cursor: 'pointer',
              marginRight: '8px',
            }}
          >
            ⚠️ 投诉 ({categoryStats.complaint})
          </button>
          <button
            onClick={() => {
              setSelectedCategory('report')
              setSelectedFeedback(null)
            }}
            style={{
              padding: '8px 16px',
              background: selectedCategory === 'report' ? 'rgba(102, 126, 234, 0.1)' : 'transparent',
              border: selectedCategory === 'report' ? '2px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              color: selectedCategory === 'report' ? '#667eea' : '#86868b',
              cursor: 'pointer',
            }}
          >
            🔔 举报 ({categoryStats.report})
          </button>
        </div>

        {/* 视图切换按钮 */}
        <div style={{ marginBottom: '24px' }}>
          <button
            onClick={() => setSelectedFeedback(null)}
            style={{
              padding: '10px 20px',
              background: !selectedFeedback ? 'rgba(102, 126, 234, 0.1)' : 'transparent',
              border: !selectedFeedback ? '2px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              color: !selectedFeedback ? '#667eea' : '#86868b',
              cursor: 'pointer',
              marginRight: '12px',
            }}
          >
            反馈列表
          </button>
          <button
            onClick={() => setSelectedFeedback({logs: true})}
            style={{
              padding: '10px 20px',
              background: selectedFeedback?.logs ? 'rgba(102, 126, 234, 0.1)' : 'transparent',
              border: selectedFeedback?.logs ? '2px solid #667eea' : '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              color: selectedFeedback?.logs ? '#667eea' : '#86868b',
              cursor: 'pointer',
            }}
          >
            操作日志
          </button>
        </div>

        {!selectedFeedback && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
            gap: '16px'
          }}>
            {filteredFeedbacks.length === 0 ? (
              <div style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                padding: '60px 20px',
                color: '#86868b',
                fontSize: '16px',
              }}>
                暂无{selectedCategory !== 'all' ? (selectedCategory === 'suggestion' ? '建议' : selectedCategory === 'complaint' ? '投诉' : '举报') : ''}反馈
              </div>
            ) : (
              filteredFeedbacks.map((feedback) => (
                <div
                  key={feedback.id}
                  onClick={() => setSelectedFeedback(feedback)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.6)',
                    backdropFilter: 'blur(10px)',
                    padding: '20px',
                    borderRadius: '16px',
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.4)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <span style={{ fontSize: '12px', color: '#86868b' }}>
                      {new Date(feedback.created_at).toLocaleString('zh-CN')}
                    </span>
                    <span style={{
                      fontSize: '12px',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      background: feedback.status === 'pending' ? '#fff3cd' : '#34c759',
                      color: feedback.status === 'pending' ? '#856404' : '#fff',
                    }}>
                      {feedback.status === 'pending' ? '待处理' : '已完成'}
                    </span>
                  </div>
                  <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1d1d1d', marginBottom: '8px' }}>
                    {feedback.category === 'suggestion' ? '💡 建议' : feedback.category === 'complaint' ? '⚠️ 投诉' : '🔔 举报'}
                  </h3>
                  <p style={{ fontSize: '13px', color: '#86868b', margin: 0 }}>
                    设备ID: {feedback.device_id?.slice(0, 16)}...
                  </p>
                  <p style={{ fontSize: '13px', color: '#86868b', margin: '0' }}>
                    ID: {feedback.id}
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        {selectedFeedback && !selectedFeedback.logs && (
          <div style={{ 
            background: 'rgba(255, 255, 255, 0.6)',
            backdropFilter: 'blur(10px)',
            padding: '24px',
            borderRadius: '16px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.4)'
          }}>
            <button
              onClick={() => setSelectedFeedback(null)}
              style={{
                marginBottom: '16px',
                padding: '8px 16px',
                background: 'rgba(102, 126, 234, 0.1)',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              ← 返回列表
            </button>

            <div style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#1d1d1d', marginBottom: '12px' }}>
                反馈详情
              </h2>
              <p style={{ fontSize: '14px', color: '#86868b', marginBottom: '8px' }}>
                提交时间: {new Date(selectedFeedback.created_at).toLocaleString('zh-CN')}
              </p>
              <p style={{ fontSize: '14px', color: '#86868b', marginBottom: '8px' }}>
                设备ID: {selectedFeedback.device_id}
              </p>
              <p style={{ fontSize: '14px', color: '#86868b', marginBottom: '8px' }}>
                反馈ID: {selectedFeedback.id}
              </p>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1d1d1d', marginBottom: '12px' }}>
                更新状态
              </h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => handleStatusUpdate(selectedFeedback.id, 'resolved')}
                  style={{
                    padding: '8px 16px',
                    background: 'rgba(52, 199, 89, 0.1)',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                    borderRadius: '8px',
                    fontSize: '14px',
                    cursor: 'pointer',
                  }}
                >
                  标记为已完成
                </button>
                <button
                  onClick={() => handleStatusUpdate(selectedFeedback.id, 'pending')}
                  style={{
                    padding: '8px 16px',
                    background: 'rgba(255, 59, 48, 0.1)',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                    borderRadius: '8px',
                    fontSize: '14px',
                    cursor: 'pointer',
                  }}
                >
                  标记为待处理
                </button>
              </div>
            </div>

            {selectedFeedback.original_content && (
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1d1d1d', marginBottom: '12px' }}>
                  📝 反馈内容
                </h3>
                <div style={{
                  background: 'rgba(255, 255, 255, 0.8)',
                  padding: '16px',
                  borderRadius: '12px',
                  border: '1px solid rgba(0, 0, 0, 0.1)',
                }}>
                  <div style={{ fontSize: '14px', color: '#1d1d1f', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                    {selectedFeedback.original_content}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {selectedFeedback?.logs && (
          <div style={{ 
            background: 'rgba(255, 255, 255, 0.6)',
            backdropFilter: 'blur(10px)',
            padding: '24px',
            borderRadius: '16px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.4)'
          }}>
            <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#1d1d1d', marginBottom: '20px' }}>
              📋 操作日志
            </h2>
            <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
              {logs.map((log, index) => (
                <div
                  key={index}
                  style={{
                    padding: '12px',
                    borderBottom: '1px solid rgba(0, 0, 0, 0.05)',
                    fontSize: '13px',
                    display: 'grid',
                    gridTemplateColumns: '150px 1fr 1fr',
                    gap: '12px',
                  }}
                >
                  <div style={{ color: '#86868b' }}>
                    {new Date(log.created_at).toLocaleString('zh-CN')}
                  </div>
                  <div style={{ color: '#667eea', fontWeight: '600' }}>
                    {log.action}
                  </div>
                  <div style={{ color: '#86868b' }}>
                    {log.target_id ? `反馈ID: ${log.target_id.slice(0, 8)}...` : '-'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
