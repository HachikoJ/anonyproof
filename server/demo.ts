import type Database from 'better-sqlite3'

export const DEMO_ADMIN_PASSWORD = 'demo12345678'
export const DEMO_DEVICE_ID = 'demo-device-anonyproof-2026'
export const DEMO_SECONDARY_DEVICE_ID = 'demo-device-affiliate-2026'
export const DEMO_NOTICE = '仅用于效果演示，正式部署前必须清除预设管理员密码。'

function isEnabledValue(value: string | undefined) {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

export function isDemoMode() {
  const configured = process.env.DEMO_MODE
  if (configured !== undefined && configured.trim() !== '') {
    return isEnabledValue(configured)
  }

  return process.env.NODE_ENV !== 'production'
}

type DemoCategory = 'suggestion' | 'complaint' | 'report'
type DemoStatus = 'pending' | 'in_progress' | 'resolved' | 'no_solution'

type DemoComment = {
  author: 'user' | 'admin'
  content: string
  createdAt: number
}

type DemoFeedback = {
  id: string
  category: DemoCategory
  originalContent: string
  status: DemoStatus
  solution?: string
  solutionUpdatedAt?: number
  createdAt: number
  deviceId?: string
  comments?: DemoComment[]
}

const categoryNames: Record<DemoCategory, string> = {
  suggestion: '建议',
  complaint: '投诉',
  report: '举报',
}

const statusNames: Record<DemoStatus, string> = {
  pending: '待受理',
  in_progress: '处理中',
  resolved: '已办结',
  no_solution: '暂无法处理',
}

// 示例内容统一按北京时间书写，方便校对正文里提到的时间点
function beijing(day: number, hour: number, minute = 0) {
  return Date.UTC(2026, 8, day, hour - 8, minute)
}

// 早于该时间的演示通知标记为已读，未读数量更接近真实使用状态
const demoReadCutoff = beijing(15, 12, 0)

const feedbacks: DemoFeedback[] = [
  {
    id: 'demo-feedback-suggestion-pending',
    category: 'suggestion',
    originalContent:
      '上周到区政务服务中心办理企业信息变更，窗口人员态度挺好，但大厅里只有楼层指引，没有按事项分类的窗口对照表，第一次来的人基本都要在导办台反复问。建议在取号机旁边增加一张窗口对照表，或者把指引补充到窗口号，材料清单也可以一并贴出来。',
    status: 'pending',
    createdAt: beijing(16, 9, 20),
    comments: [
      {
        author: 'user',
        content: '补充一句：今天上午十点左右，导办台前排队问路的人一直没断过，高峰期可以再加一块临时指引牌。',
        createdAt: beijing(16, 10, 5),
      },
    ],
  },
  {
    id: 'demo-feedback-complaint-progress',
    category: 'complaint',
    originalContent:
      '同一处工地已经连续第四天在夜里施工，昨天到凌晨一点多还在浇混凝土，家里老人和小孩基本没睡。上周反映过一次，回复说会核实，但目前没有任何变化。希望这次能明确作业时段限制和整改结果，不要只回复“已转交”。',
    status: 'in_progress',
    solution:
      '已受理并转交属地管理部门核查，已要求施工方夜间 22 点后停止高噪声作业，后续三次夜间巡查结果将在此记录内同步。',
    solutionUpdatedAt: beijing(16, 15, 35),
    createdAt: beijing(15, 17, 35),
    comments: [
      {
        author: 'user',
        content: '补充：今晚十点半以后仍在施工，混凝土车进出比较频繁，我在楼下拍到了带时间水印的照片，需要的话可以提供。',
        createdAt: beijing(15, 21, 40),
      },
      {
        author: 'admin',
        content: '已记录您补充的时段信息，核查人员今晚会重点调取 22 点以后的施工记录和车辆出入记录。',
        createdAt: beijing(16, 10, 20),
      },
      {
        author: 'user',
        content: '好的，辛苦。如果今晚还在继续，我会继续补充记录。',
        createdAt: beijing(16, 11, 5),
      },
      {
        author: 'admin',
        content: '现场核查已完成，已要求施工方夜间 22 点后停止产生噪声的作业，后续三次巡查结果会在本记录内同步。',
        createdAt: beijing(16, 15, 30),
      },
    ],
  },
  {
    id: 'demo-feedback-report-resolved',
    category: 'report',
    originalContent:
      '某商业楼三层的疏散通道拐角处长期堆放纸箱和废弃展架，通道最窄的地方只剩一半宽度。物业之前贴过通知，但一直没有清走，周末人流量大时更明显。希望排查并恢复通道畅通。',
    status: 'resolved',
    solution:
      '经现场核查，通道内堆放的纸箱与废弃展架已全部清理，物业补充了两处通道巡查点位并提交整改确认记录。',
    solutionUpdatedAt: beijing(14, 16, 40),
    createdAt: beijing(14, 10, 10),
    comments: [
      {
        author: 'admin',
        content: '已转交消防管理部门与物业现场核查，核查结果会同步到本记录。',
        createdAt: beijing(14, 10, 30),
      },
      {
        author: 'admin',
        content: '现场杂物已全部清理，物业补充了两处通道巡查点位，三天内会再做一次复查。',
        createdAt: beijing(14, 16, 30),
      },
      {
        author: 'user',
        content: '今天路过看了一下，确实清理干净了，效率挺高，谢谢。',
        createdAt: beijing(14, 17, 10),
      },
    ],
  },
  {
    id: 'demo-feedback-suggestion-no-solution',
    category: 'suggestion',
    originalContent:
      '提交之后只能看到“已受理”，具体走到哪个环节、还需要多久都看不到。建议把每个环节的办理时限和当前所处阶段一并公开，申请人可以据此判断是否需要补充材料。',
    status: 'no_solution',
    solution:
      '现有公开范围暂不包含分环节时限数据，将在后续信息公开机制完善时纳入评估，评估进展会在本记录内同步。',
    solutionUpdatedAt: beijing(14, 9, 35),
    createdAt: beijing(13, 15, 45),
    comments: [
      {
        author: 'admin',
        content: '感谢建议，已记录并同步给流程管理部门评估。',
        createdAt: beijing(13, 16, 20),
      },
      {
        author: 'admin',
        content: '经评估，现有公开范围暂不包含分环节时限数据，将在后续信息公开机制完善时纳入评估，届时会在本记录内告知。',
        createdAt: beijing(14, 9, 30),
      },
    ],
  },
  {
    id: 'demo-feedback-enterprise-safety-training',
    category: 'report',
    originalContent:
      '某制造企业车间这两个月的新员工安全培训记录像是集中补签的，实际培训不到半小时，签到表上的日期和当天排班对不上。车间里也有同事操作设备时没按规定佩戴防护用具，一直没有人提醒。培训和现场管理都希望核实一下，这类问题真出事就是大事。',
    status: 'in_progress',
    solution:
      '已受理并转交企业主管部门，核查培训签到记录与同期排班表的对应关系，同时安排现场防护用品佩戴情况抽查。',
    solutionUpdatedAt: beijing(15, 12, 0),
    createdAt: beijing(15, 8, 20),
    comments: [
      {
        author: 'user',
        content: '补充一个细节：签到表上写的培训日期是 6 月中旬，那几天车间在赶订单，多数人都在产线上。',
        createdAt: beijing(15, 9, 10),
      },
      {
        author: 'admin',
        content: '已记录，核查时会调取同期排班表与培训签到原件进行比对。',
        createdAt: beijing(15, 11, 40),
      },
      {
        author: 'admin',
        content: '抽查已完成，已要求企业补做完整培训并整改现场防护用品管理，复查结果会在本记录内同步。',
        createdAt: beijing(16, 9, 5),
      },
    ],
  },
  {
    id: 'demo-feedback-school-canteen',
    category: 'complaint',
    originalContent:
      '孩子回家说学校食堂最近的饭菜有几次是温的，午饭后有同学肚子不舒服。家长群里也有人说看到后厨门口堆着没有盖盖子的食材箱。不要求追责，只希望学校把后厨卫生和留样情况说明一下，让家长放心。',
    status: 'resolved',
    solution:
      '已核查当日留样记录并现场整改食材存放问题，学校自本周起在食堂门口公示每周菜谱与留样照片。',
    solutionUpdatedAt: beijing(15, 10, 15),
    createdAt: beijing(14, 13, 40),
    comments: [
      {
        author: 'admin',
        content: '已转交教育主管部门与学校后勤管理处，核查期间会调取后厨监控和当日留样记录。',
        createdAt: beijing(14, 14, 20),
      },
      {
        author: 'user',
        content: '感谢。另外建议把每周菜谱和留样照片贴在食堂门口，家长接送孩子时也能看到。',
        createdAt: beijing(14, 20, 5),
      },
      {
        author: 'admin',
        content: '核查结果：留样记录完整，发现两处食材存放不规范，已现场整改；学校将从本周起在食堂门口公示每周菜谱与留样照片。',
        createdAt: beijing(15, 10, 15),
      },
      {
        author: 'user',
        content: '今天接孩子时看到新的公示栏了，谢谢跟进。',
        createdAt: beijing(15, 12, 30),
      },
    ],
  },
  {
    id: 'demo-feedback-association-budget',
    category: 'suggestion',
    originalContent:
      '协会今年上半年的会费和项目支出只在理事会上口头讲过，普通会员一直看不到明细。上周问过一次，答复是“正在整理”，到现在也没有下文。建议按季度公示收支明细和项目进度，至少让会员知道钱花在哪了。',
    status: 'pending',
    createdAt: beijing(16, 10, 30),
    deviceId: DEMO_SECONDARY_DEVICE_ID,
    comments: [
      {
        author: 'user',
        content: '补充：上一届每年都会发一份书面公示，这一届到现在一份都没看到。',
        createdAt: beijing(16, 10, 45),
      },
    ],
  },
]

function addCommentIfMissing(
  db: Database.Database,
  feedbackId: string,
  commenterType: 'user' | 'admin',
  content: string,
  createdAt: number,
) {
  db.prepare(`
    INSERT INTO feedback_comments (feedback_id, commenter_type, content, created_at, admin_ip)
    SELECT ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM feedback_comments
      WHERE feedback_id = ? AND commenter_type = ? AND content = ?
    )
  `).run(
    feedbackId,
    commenterType,
    content,
    createdAt,
    commenterType === 'admin' ? 'demo' : null,
    feedbackId,
    commenterType,
    content,
  )
}

function addNotificationIfMissing(
  db: Database.Database,
  recipientType: 'user' | 'admin',
  recipientId: string,
  feedbackId: string,
  type: 'comment' | 'status_update' | 'new_feedback',
  title: string,
  content: string,
  createdAt: number,
  isRead: number,
  matchExact = false,
) {
  db.prepare(`
    INSERT INTO notifications (
      recipient_type, recipient_id, feedback_id, type, title, content, is_read, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE recipient_type = ? AND recipient_id = ? AND feedback_id = ? AND type = ?
        AND (
          ? = 0
          OR (content = ? AND created_at = ?)
        )
    )
  `).run(
    recipientType,
    recipientId,
    feedbackId,
    type,
    title,
    content,
    isRead,
    createdAt,
    recipientType,
    recipientId,
    feedbackId,
    type,
    matchExact ? 1 : 0,
    content,
    createdAt,
  )
}

function seedAccessDemoData(db: Database.Database) {
  const marker = 'AnonyProof Demo Data'
  const existing = db.prepare(
    'SELECT COUNT(*) AS count FROM access_logs WHERE user_agent = ?',
  ).get(marker) as { count: number }

  if (existing.count === 0) {
    const insertLog = db.prepare(`
      INSERT INTO access_logs (
        ip, user_agent, path, method, status_code, response_time,
        is_bot, is_suspicious, suspicious_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const now = Date.now()
    const samples = [
      ['203.0.113.10', '/anonyproof', 'GET', 200, 86, 0, 0, null],
      ['203.0.113.11', '/anonyproof/api/stats', 'GET', 200, 42, 0, 0, null],
      ['203.0.113.12', '/anonyproof/foorpynona', 'GET', 200, 112, 0, 0, null],
      ['203.0.113.13', '/anonyproof/api/feedback', 'POST', 200, 156, 0, 0, null],
      ['203.0.113.14', '/anonyproof/access-stats', 'GET', 200, 91, 0, 0, null],
      ['198.51.100.20', '/api/admin/config', 'GET', 403, 18, 0, 1, '演示数据：敏感路径探测'],
      ['198.51.100.21', '/anonyproof', 'GET', 200, 67, 0, 0, null],
      ['203.0.113.15', '/anonyproof/api/notifications', 'GET', 200, 53, 0, 0, null],
    ] as const

    for (const sample of samples) {
      insertLog.run(
        sample[0],
        marker,
        sample[1],
        sample[2],
        sample[3],
        sample[4],
        sample[5],
        sample[6],
        sample[7],
        now,
      )
    }
  }

  const insertDailyStats = db.prepare(`
    INSERT OR IGNORE INTO access_stats (
      date, total_visits, unique_visitors, bot_visits, suspicious_visits, avg_response_time
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)
  const totals = [28, 34, 26, 41, 37, 46, 32]
  for (let offset = 0; offset < totals.length; offset += 1) {
    const date = new Date()
    date.setDate(date.getDate() - offset)
    insertDailyStats.run(
      date.toISOString().split('T')[0],
      totals[offset],
      Math.max(4, Math.round(totals[offset] * 0.45)),
      offset % 3 === 0 ? 2 : 0,
      offset === 2 ? 1 : 0,
      offset === 1 ? 118 : 92,
    )
  }
}

export function seedDemoData(db: Database.Database) {
  const insertFeedback = db.prepare(`
    INSERT OR IGNORE INTO feedbacks (
      id, category, encrypted_content, device_id, created_at, status,
      original_content, solution, solution_updated_at, solution_admin_ip
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const summary = (content: string) => (
    content.length > 50 ? `${content.slice(0, 50)}...` : content
  )

  for (const feedback of feedbacks) {
    const deviceId = feedback.deviceId ?? DEMO_DEVICE_ID
    const solutionUpdatedAt = feedback.solutionUpdatedAt
      ?? (feedback.solution ? feedback.createdAt + 45 * 60 * 1000 : null)
    const statusName = statusNames[feedback.status]
    const categoryName = categoryNames[feedback.category]

    insertFeedback.run(
      feedback.id,
      feedback.category,
      `demo-encrypted:${feedback.id}`,
      deviceId,
      feedback.createdAt,
      feedback.status,
      feedback.originalContent,
      feedback.solution || '',
      solutionUpdatedAt,
      feedback.solution ? 'demo' : '',
    )

    addNotificationIfMissing(
      db,
      'admin',
      'admin',
      feedback.id,
      'new_feedback',
      `收到一条${categoryName}线索`,
      summary(feedback.originalContent),
      feedback.createdAt,
      feedback.createdAt < demoReadCutoff ? 1 : 0,
    )

    if (feedback.solution && solutionUpdatedAt) {
      addNotificationIfMissing(
        db,
        'user',
        deviceId,
        feedback.id,
        'status_update',
        `提交记录状态已更新：${statusName}`,
        `您提交的${categoryName}当前状态为“${statusName}”，处理说明：${summary(feedback.solution)}`,
        solutionUpdatedAt,
        solutionUpdatedAt < demoReadCutoff ? 1 : 0,
      )
    }

    for (const comment of feedback.comments ?? []) {
      addCommentIfMissing(
        db,
        feedback.id,
        comment.author,
        comment.content,
        comment.createdAt,
      )

      if (comment.author === 'admin') {
        addNotificationIfMissing(
          db,
          'user',
          deviceId,
          feedback.id,
          'comment',
          '处理人员回复了您的提交',
          `您提交的${categoryName}收到一条回复：${summary(comment.content)}`,
          comment.createdAt,
          comment.createdAt < demoReadCutoff ? 1 : 0,
          true,
        )
      } else {
        addNotificationIfMissing(
          db,
          'admin',
          'admin',
          feedback.id,
          'comment',
          '提交人补充了说明',
          `该${categoryName}线索收到一条补充：${summary(comment.content)}`,
          comment.createdAt,
          comment.createdAt < demoReadCutoff ? 1 : 0,
          true,
        )
      }
    }
  }

  const total = db.prepare('SELECT COUNT(*) AS count FROM feedbacks').get() as { count: number }
  db.prepare('UPDATE stats SET total_feedbacks = ?, encrypted_count = ? WHERE id = 1')
    .run(total.count, total.count)

  seedAccessDemoData(db)
}

// 演示站点所有访客共用同一批演示数据，任何一个访客点开记录都会把未读状态写库清零，
// 后续访客再打开页面就看不到通知提醒；因此每次打开演示页面时，
// 把提交人和管理员的未读状态都恢复为种子默认值。
export function resetDemoNotifications(db: Database.Database) {
  const result = db.prepare(`
    UPDATE notifications
    SET is_read = CASE WHEN created_at < ? THEN 1 ELSE 0 END
    WHERE (recipient_type = 'user' AND recipient_id IN (?, ?))
       OR (recipient_type = 'admin' AND recipient_id = 'admin')
  `).run(demoReadCutoff, DEMO_DEVICE_ID, DEMO_SECONDARY_DEVICE_ID)

  return result.changes
}
