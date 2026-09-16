"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDemoConfig } from "../hooks/useDemoConfig";
import ExternalLinks from "../components/ExternalLinks";

type Feedback = {
  id: string;
  category: "suggestion" | "complaint" | "report";
  original_content: string;
  device_id: string;
  created_at: string;
  status: "pending" | "in_progress" | "resolved" | "no_solution";
  solution?: string;
  unread_notifications?: number;
};
type Comment = {
  id: number;
  commenter_type: "user" | "admin";
  content: string;
  created_at: string;
};
type Notification = {
  id: number;
  feedback_id: string;
  type: string;
  title: string;
  content: string;
  created_at: string;
  is_read: number;
};
type MessageTone = "info" | "success" | "error";

const categoryLabels = {
  suggestion: "建议",
  complaint: "投诉",
  report: "举报",
};
const statusLabels = {
  pending: "待受理",
  in_progress: "处理中",
  resolved: "已办结",
  no_solution: "暂无法处理",
};

class ApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readApiJson(response: Response) {
  if (response.status === 401) {
    throw new ApiError("需要管理员登录", 401);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new ApiError("服务响应异常，请稍后重试", response.status);
  }
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new ApiError(data.error || "请求失败，请稍后重试", response.status);
  }
  return data;
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError && error.message
    ? error.message
    : fallback;
}

function syncFeedbackQuery(id: string | null) {
  const url = new URL(window.location.href);
  if (id) {
    url.searchParams.set("feedback", id);
  } else {
    url.searchParams.delete("feedback");
  }
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, "", nextUrl);
  }
}

export default function AdminPage() {
  const { config: demoConfig } = useDemoConfig();
  const notificationPanelRef = useRef<HTMLDivElement>(null);
  const feedbackListRef = useRef<HTMLDivElement>(null);
  const feedbackListScrollTopRef = useRef(0);
  const feedbacksLoadedRef = useRef(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [selected, setSelected] = useState<Feedback | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [comment, setComment] = useState("");
  const [solution, setSolution] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<MessageTone>("info");
  const [actionLoading, setActionLoading] = useState("");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationError, setNotificationError] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);

  const handleRequestError = (error: unknown, fallback: string) => {
    if (error instanceof ApiError && error.status === 401) {
      setAuthenticated(false);
      setFeedbacks([]);
      setSelected(null);
      setShowNotifications(false);
      setMessage("");
      feedbacksLoadedRef.current = false;
      return;
    }
    setMessage(getRequestErrorMessage(error, fallback));
    setMessageTone("error");
  };

  const fetchData = async (): Promise<Feedback[]> => {
    setLoading(true);
    try {
      const response = await fetch("/anonyproof/api/admin/feedbacks", {
        credentials: "same-origin",
      });
      const data = await readApiJson(response);
      const nextFeedbacks = data.feedbacks as Feedback[];
      setFeedbacks(nextFeedbacks);
      feedbacksLoadedRef.current = true;
      setSelected((current) =>
        current
          ? nextFeedbacks.find((item) => item.id === current.id) ?? current
          : current,
      );
      return nextFeedbacks;
    } catch (error) {
      handleRequestError(
        error,
        feedbacksLoadedRef.current
          ? "无法连接管理服务，当前显示上次数据"
          : "无法连接管理服务，请检查网络后重试",
      );
      return [];
    } finally {
      setLoading(false);
    }
  };

  const fetchUnreadCount = async () => {
    try {
      const response = await fetch(
        "/anonyproof/api/notifications/unread-count?recipientType=admin&recipientId=admin",
        { credentials: "same-origin" },
      );
      const data = await readApiJson(response);
      setUnreadCount(data.count);
    } catch (error) {
      handleRequestError(error, "通知数量暂时无法加载");
    }
  };

  const fetchNotifications = async () => {
    setNotificationError("");
    try {
      const [countResponse, listResponse] = await Promise.all([
        fetch(
          "/anonyproof/api/notifications/unread-count?recipientType=admin&recipientId=admin",
          { credentials: "same-origin" },
        ),
        fetch(
          "/anonyproof/api/notifications?recipientType=admin&recipientId=admin&limit=30",
          { credentials: "same-origin" },
        ),
      ]);
      const [countData, listData] = await Promise.all([
        readApiJson(countResponse),
        readApiJson(listResponse),
      ]);
      setUnreadCount(countData.count);
      setNotifications(listData.notifications);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleRequestError(error, "");
      } else {
        setNotificationError(
          getRequestErrorMessage(
            error,
            notifications.length
              ? "通知暂时无法加载，当前显示上次通知"
              : "通知暂时无法加载，线索数据不受影响",
          ),
        );
      }
    }
  };

  const fetchComments = async (id: string) => {
    setCommentsLoading(true);
    setComments([]);
    try {
      const response = await fetch(`/anonyproof/api/feedback/${id}/comments`, {
        credentials: "same-origin",
      });
      const data = await readApiJson(response);
      setComments(data.comments);
    } catch (error) {
      handleRequestError(error, "沟通记录暂时无法加载，请稍后重试");
    } finally {
      setCommentsLoading(false);
    }
  };

  useEffect(() => {
    fetch("/anonyproof/api/admin/auth/session")
      .then((response) => readApiJson(response))
      .then(async (data) => {
        setAuthenticated(data.authenticated);
        if (data.authenticated) {
          const items = await fetchData();
          const targetId = new URLSearchParams(window.location.search).get("feedback");
          const target = targetId
            ? items.find((item) => item.id === targetId)
            : undefined;
          if (target) {
            setSearch("");
            setCategory("all");
            setStatus("all");
            selectFeedback(target, true);
          } else if (targetId && feedbacksLoadedRef.current) {
            syncFeedbackQuery(null);
          }
          fetchNotifications();
        }
      })
      .catch((error) =>
        setLoginError(getRequestErrorMessage(error, "无法连接管理服务，请稍后重试")),
      )
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const interval = setInterval(fetchNotifications, 20000);
    return () => clearInterval(interval);
  }, [authenticated]);

  useEffect(() => {
    if (!showNotifications) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (
        notificationPanelRef.current &&
        !notificationPanelRef.current.contains(event.target as Node)
      ) {
        setShowNotifications(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowNotifications(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showNotifications]);

  const filtered = useMemo(
    () =>
      feedbacks.filter((item) => {
        const text = `${item.original_content} ${item.device_id}`.toLowerCase();
        return (
          (category === "all" || item.category === category) &&
          (status === "all" || item.status === status) &&
          (!search.trim() || text.includes(search.toLowerCase().trim()))
        );
      }),
    [feedbacks, category, status, search],
  );

  const clearSelection = (restoreListPosition = false) => {
    syncFeedbackQuery(null);
    setSelected(null);
    setComments([]);
    setSolution("");
    if (restoreListPosition) {
      window.requestAnimationFrame(() => {
        if (feedbackListRef.current) {
          feedbackListRef.current.scrollTop = feedbackListScrollTopRef.current;
        }
      });
    }
  };

  useEffect(() => {
    if (selected && !filtered.some((item) => item.id === selected.id)) {
      clearSelection();
    }
  }, [filtered, selected]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginLoading(true);
    setLoginError("");
    try {
      const response = await fetch("/anonyproof/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setLoginError(data.error || "登录失败，请检查密码");
        return;
      }
      setAuthenticated(true);
      setPassword("");
      setMessage("");
      fetchData();
      fetchNotifications();
    } catch {
      setLoginError("无法连接管理服务，请稍后重试");
    } finally {
      setLoginLoading(false);
    }
  };

  const selectFeedback = async (
    item: Feedback,
    forceReadNotifications = false,
  ) => {
    feedbackListScrollTopRef.current =
      feedbackListRef.current?.scrollTop ?? feedbackListScrollTopRef.current;
    syncFeedbackQuery(item.id);
    setSelected(item);
    setSolution("");
    setMessage("");
    fetchComments(item.id);
    if (forceReadNotifications || (item.unread_notifications ?? 0) > 0) {
      try {
        const response = await fetch(
          `/anonyproof/api/notifications/read-all?recipientType=admin&recipientId=admin&feedbackId=${encodeURIComponent(item.id)}`,
          { method: "PUT", credentials: "same-origin" },
        );
        await readApiJson(response);
        setFeedbacks((items) =>
          items.map((entry) =>
            entry.id === item.id
              ? { ...entry, unread_notifications: 0 }
              : entry,
          ),
        );
        await fetchUnreadCount();
      } catch (error) {
        handleRequestError(error, "通知状态更新失败");
      }
    }
  };

  const updateStatus = async (nextStatus: Feedback["status"]) => {
    if (!selected) return;
    if (selected.status === nextStatus) {
      setMessage("");
      return;
    }
    if (
      (nextStatus === "resolved" || nextStatus === "no_solution") &&
      solution.trim().length < 10
    ) {
      setMessage("办结或暂无法处理时，请填写至少 10 个字的处理说明");
      setMessageTone("error");
      return;
    }
    setActionLoading(nextStatus);
    try {
      const response = await fetch(
        `/anonyproof/api/admin/feedback/${selected.id}/status`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ status: nextStatus, solution }),
        },
      );
      await readApiJson(response);
      setMessage("");
      setMessageTone("info");
      setSolution("");
      setSelected((current) =>
        current ? { ...current, status: nextStatus, solution } : current,
      );
      await fetchData();
      fetchNotifications();
    } catch (error) {
      handleRequestError(error, "状态更新失败，请稍后重试");
    } finally {
      setActionLoading("");
    }
  };

  const addComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || comment.trim().length < 2) return;
    setActionLoading("comment");
    try {
      const response = await fetch(
        `/anonyproof/api/admin/feedback/${selected.id}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ content: comment.trim() }),
        },
      );
      await readApiJson(response);
      setComment("");
      await fetchComments(selected.id);
      setMessage("回复已发送");
      setMessageTone("success");
      fetchNotifications();
    } catch (error) {
      handleRequestError(error, "回复失败，请稍后重试");
    } finally {
      setActionLoading("");
    }
  };

  const markNotificationRead = async (notification: Notification) => {
    const item = feedbacks.find(
      (feedback) => feedback.id === notification.feedback_id,
    );
    if (item) {
      if (!filtered.some((feedback) => feedback.id === item.id)) {
        setSearch("");
        setCategory("all");
        setStatus("all");
      }
      await selectFeedback(item, !notification.is_read);
    } else if (!notification.is_read) {
      try {
        const response = await fetch(`/anonyproof/api/notifications/${notification.id}/read`, {
          method: "PUT",
          credentials: "same-origin",
        });
        await readApiJson(response);
        setNotifications((items) =>
          items.map((entry) =>
            entry.id === notification.id ? { ...entry, is_read: 1 } : entry,
          ),
        );
        await fetchUnreadCount();
      } catch (error) {
        handleRequestError(error, "通知状态更新失败");
      }
    }
    setShowNotifications(false);
  };
  const markAllNotificationsRead = async () => {
    setNotificationError("");
    try {
      const response = await fetch(
        "/anonyproof/api/notifications/read-all?recipientType=admin&recipientId=admin",
        { method: "PUT", credentials: "same-origin" },
      );
      await readApiJson(response);
      setUnreadCount(0);
      setNotifications((items) => items.map((item) => ({ ...item, is_read: 1 })));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleRequestError(error, "");
      } else {
        setNotificationError(
          getRequestErrorMessage(error, "通知状态更新失败，请稍后重试"),
        );
      }
    }
  };

  const logout = async () => {
    await fetch("/anonyproof/api/admin/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    setAuthenticated(false);
    setFeedbacks([]);
    setSelected(null);
    setNotifications([]);
    setUnreadCount(0);
    setShowNotifications(false);
    setMessage("");
    feedbacksLoadedRef.current = false;
    syncFeedbackQuery(null);
  };

  if (checking)
    return (
      <div className="admin-loading">
        <span className="spinner" />
        正在验证管理员会话
      </div>
    );
  if (!authenticated)
    return (
      <main className="admin-auth-page">
        <nav className="admin-auth-links" aria-label="外部链接">
          <ExternalLinks linkClassName="admin-external-link" />
        </nav>
        <section
          className="admin-auth-panel"
          aria-labelledby="admin-login-title"
        >
          <div className="admin-auth-intro">
            <div className="brand-lockup">
              <img className="brand-mark" src="/anonyproof/brand/anonyproof-mark.svg" alt="" width="36" height="36" />
              <span>AnonyProof 管理台</span>
            </div>
            <div>
              <p className="eyebrow">管理入口</p>
              <h1 id="admin-login-title">管理员登录</h1>
              <p className="admin-auth-copy">验证身份后进入管理台。</p>
            </div>
          </div>
          <div className="admin-auth-form-panel">
            {demoConfig?.demoMode && demoConfig.adminPassword && (
              <aside className="admin-demo-notice" role="status">
                <strong>演示默认密码</strong>
                <code>{demoConfig.adminPassword}</code>
                <p>
                  {demoConfig.notice ||
                    "仅用于效果演示，正式部署前必须清除预设管理员密码。"}
                </p>
              </aside>
            )}
            <form onSubmit={handleLogin} className="admin-auth-form">
              <label htmlFor="admin-password">访问密码</label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="请输入管理员密码"
                required
              />
              {loginError && (
                <p className="form-error" role="alert">
                  {loginError}
                </p>
              )}
              <button
                className="admin-primary-button"
                type="submit"
                disabled={loginLoading}
              >
                {loginLoading ? (
                  <>
                    <span className="spinner spinner-light" />
                    正在登录
                  </>
                ) : (
                  "登录管理台"
                )}
              </button>
            </form>
            <p className="admin-auth-footnote">
              会话仅保留在当前浏览器。
            </p>
          </div>
        </section>
      </main>
    );

  const counts = {
    total: feedbacks.length,
    pending: feedbacks.filter((item) => item.status === "pending").length,
    processing: feedbacks.filter((item) => item.status === "in_progress")
      .length,
    resolved: feedbacks.filter((item) => item.status === "resolved").length,
    noSolution: feedbacks.filter((item) => item.status === "no_solution")
      .length,
  };
  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-topbar-inner">
          <a href="/anonyproof" className="brand-lockup">
            <img className="brand-mark" src="/anonyproof/brand/anonyproof-mark.svg" alt="" width="36" height="36" />
            <span>AnonyProof</span>
          </a>
          <nav className="admin-nav" aria-label="管理导航">
            <a className="is-active" href="/anonyproof/foorpynona">
              线索管理
            </a>
            <a href="/anonyproof/access-stats">访问与风控</a>
          </nav>
          <div className="admin-tools">
            <ExternalLinks linkClassName="admin-external-link" />
            <div className="admin-notification-wrap" ref={notificationPanelRef}>
              <button
                className="admin-notification-button"
                onClick={() => {
                  setShowNotifications(!showNotifications);
                  if (!showNotifications) fetchNotifications();
                }}
                aria-expanded={showNotifications}
              >
                通知
                {unreadCount > 0 && (
                  <span>{unreadCount > 99 ? "99+" : unreadCount}</span>
                )}
              </button>
              {showNotifications && (
                <section
                  className="admin-notification-panel"
                  aria-label="管理员通知中心"
                >
                  <div className="notification-head">
                    <div>
                      <strong>通知中心</strong>
                      <span>
                        {unreadCount ? `${unreadCount} 条未读` : "已全部读完"}
                      </span>
                    </div>
                    {unreadCount > 0 && (
                      <button onClick={markAllNotificationsRead}>
                        全部已读
                      </button>
                    )}
                  </div>
                  <div className="notification-list">
                    {notifications.length ? (
                      notifications.map((item) => (
                        <button
                          key={item.id}
                          className={`notification-item ${item.is_read ? "" : "is-unread"}`}
                          onClick={() => markNotificationRead(item)}
                        >
                          <span className="notification-meta">
                            <strong>{item.title}</strong>
                            <time>
                              {new Date(item.created_at).toLocaleString(
                                "zh-CN",
                              )}
                            </time>
                          </span>
                          <span>{item.content}</span>
                        </button>
                      ))
                    ) : (
                      <p className="empty-compact">暂无通知</p>
                    )}
                  </div>
                  {notificationError && (
                    <p className="notification-error" role="alert">
                      {notificationError}
                    </p>
                  )}
                </section>
              )}
            </div>
            <button className="admin-quiet-button" onClick={logout}>
              退出登录
            </button>
          </div>
        </div>
      </header>
      <section
        className={`admin-content ${selected ? "is-detail-open" : ""}`}
      >
        <div className="admin-heading-row">
          <div>
            <h1>提交处理</h1>
          </div>
          <button
            className="admin-secondary-button"
            onClick={fetchData}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner" />
                正在刷新
              </>
            ) : (
              "刷新"
            )}
          </button>
        </div>
        <div className="admin-metric-grid">
          <div>
            <span>全部</span>
            <strong>{counts.total}</strong>
          </div>
          <div>
            <span>待受理</span>
            <strong className="metric-warn">{counts.pending}</strong>
          </div>
          <div>
            <span>处理中</span>
            <strong className="metric-info">{counts.processing}</strong>
          </div>
          <div>
            <span>已办结</span>
            <strong className="metric-success">{counts.resolved}</strong>
          </div>
          <div>
            <span>暂无法处理</span>
            <strong className="metric-muted">{counts.noSolution}</strong>
          </div>
        </div>
        <div className="admin-toolbar">
          <label className="admin-search">
            <span>搜索</span>
            <input
              value={search}
              onChange={(event) => {
                clearSelection();
                feedbackListScrollTopRef.current = 0;
                setSearch(event.target.value);
              }}
              placeholder="内容或设备标识"
            />
          </label>
          <label>
            <span>类型</span>
            <select
              value={category}
              onChange={(event) => {
                clearSelection();
                feedbackListScrollTopRef.current = 0;
                setCategory(event.target.value);
              }}
            >
              <option value="all">全部类型</option>
              <option value="suggestion">建议</option>
              <option value="complaint">投诉</option>
              <option value="report">举报</option>
            </select>
          </label>
          <label>
            <span>状态</span>
            <select
              value={status}
              onChange={(event) => {
                clearSelection();
                feedbackListScrollTopRef.current = 0;
                setStatus(event.target.value);
              }}
            >
              <option value="all">全部状态</option>
              <option value="pending">待受理</option>
              <option value="in_progress">处理中</option>
              <option value="resolved">已办结</option>
              <option value="no_solution">暂无法处理</option>
            </select>
          </label>
        </div>
        {message && (
          <div
            className={`admin-message is-${messageTone}`}
            role={messageTone === "error" ? "alert" : "status"}
          >
            {message}
          </div>
        )}
        <div
          className={`admin-workspace ${selected ? "is-detail-open" : ""}`}
        >
          <section className="admin-list-panel">
            <div className="panel-heading">
              <h2>提交记录</h2>
              <span>{filtered.length} 条</span>
            </div>
            {filtered.length === 0 ? (
              <div className="admin-empty">
                <strong>暂无匹配提交</strong>
                <span>请调整筛选条件。</span>
              </div>
            ) : (
              <div
                className="feedback-list"
                ref={feedbackListRef}
                onScroll={(event) => {
                  feedbackListScrollTopRef.current = event.currentTarget.scrollTop;
                }}
              >
                {filtered.map((item) => (
                  <button
                    key={item.id}
                    className={`feedback-row ${selected?.id === item.id ? "is-selected" : ""}`}
                    onClick={() => selectFeedback(item)}
                  >
                    <div className="feedback-row-main">
                      <div className="feedback-row-title">
                        <span className={`status-dot status-${item.status}`} />
                        {categoryLabels[item.category]}
                        <span className="feedback-id">
                          #{item.id.slice(0, 8)}
                        </span>
                        {(item.unread_notifications || 0) > 0 && (
                          <span className="feedback-unread">
                            {item.unread_notifications} 条新消息
                          </span>
                        )}
                      </div>
                      <p>{item.original_content || "未提供正文内容"}</p>
                      <time>
                        {new Date(item.created_at).toLocaleString("zh-CN")}
                      </time>
                    </div>
                    <span
                      className={`status-badge status-badge-${item.status}`}
                    >
                      {statusLabels[item.status]}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
          <aside className="admin-detail-panel">
            {!selected ? (
              <div className="admin-detail-empty">
                <span className="detail-icon">↗</span>
                <h2>选择提交记录</h2>
                <p>详情与处理操作会显示在这里。</p>
              </div>
            ) : (
              <>
                <div className="detail-header">
                  <div className="admin-detail-title">
                    <button
                      type="button"
                      className="admin-detail-back"
                      onClick={() => clearSelection(true)}
                    >
                      <span aria-hidden="true">←</span>
                      提交记录
                    </button>
                    <div className="admin-detail-heading">
                      <h2>
                        {categoryLabels[selected.category]}{" "}
                        <span>#{selected.id.slice(0, 8)}</span>
                      </h2>
                      <div className="detail-tags">
                        <span className="detail-tag">
                          <span className="detail-tag-label">提交</span>
                          <time>
                            {new Date(selected.created_at).toLocaleString(
                              "zh-CN",
                            )}
                          </time>
                        </span>
                        <span
                          className="detail-tag detail-tag-device"
                          title={selected.device_id || "未记录设备标识"}
                        >
                          <span className="detail-tag-label">设备</span>
                          <b>{selected.device_id || "未记录"}</b>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="admin-detail-body" key={selected.id}>
                  <div className="detail-overview">
                    <div className="detail-content">
                      <h3>提交内容</h3>
                      <p>{selected.original_content || "未提供正文内容"}</p>
                    </div>
                    <div className="detail-section">
                      <h3>处理说明</h3>
                      <textarea
                        id="solution"
                        aria-label="处理说明"
                        value={solution}
                        onChange={(event) => setSolution(event.target.value)}
                        placeholder="填写本次核查结论、处理动作或原因"
                        rows={3}
                      />
                      <div className="status-actions">
                        <button
                          className={`process-action ${selected.status === "in_progress" ? "is-active" : ""}`}
                          aria-pressed={selected.status === "in_progress"}
                          disabled={Boolean(actionLoading)}
                          onClick={() => updateStatus("in_progress")}
                        >
                          {actionLoading === "in_progress"
                            ? "正在保存…"
                            : "设为处理中"}
                        </button>
                        <button
                          className={`success-action ${selected.status === "resolved" ? "is-active" : ""}`}
                          aria-pressed={selected.status === "resolved"}
                          disabled={Boolean(actionLoading)}
                          onClick={() => updateStatus("resolved")}
                        >
                          {actionLoading === "resolved"
                            ? "正在保存…"
                            : "标记已办结"}
                        </button>
                        <button
                          className={`muted-action ${selected.status === "no_solution" ? "is-active" : ""}`}
                          aria-pressed={selected.status === "no_solution"}
                          disabled={Boolean(actionLoading)}
                          onClick={() => updateStatus("no_solution")}
                        >
                          {actionLoading === "no_solution"
                            ? "正在保存…"
                            : "暂无法处理"}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="detail-conversation">
                    <h3>
                      沟通记录 <span>{comments.length}</span>
                    </h3>
                    <div className="comment-list">
                      {commentsLoading ? (
                        <div className="admin-inline-loading">
                          <span className="spinner" />
                          正在加载沟通记录…
                        </div>
                      ) : comments.length ? (
                        comments.map((item) => (
                          <div
                            className={`comment ${item.commenter_type === "admin" ? "comment-admin" : ""}`}
                            key={item.id}
                          >
                            <div>
                              <strong>
                                {item.commenter_type === "admin"
                                  ? "处理人员回复"
                                  : "提交人补充"}
                              </strong>
                              <time>
                                {new Date(item.created_at).toLocaleString(
                                  "zh-CN",
                                )}
                              </time>
                            </div>
                            <p>{item.content}</p>
                          </div>
                        ))
                      ) : (
                        <p className="empty-inline">暂无补充说明。</p>
                      )}
                    </div>
                    <form className="comment-form" onSubmit={addComment}>
                      <input
                        value={comment}
                        onChange={(event) => setComment(event.target.value)}
                        placeholder="输入回复内容"
                        aria-label="回复内容"
                      />
                      <button
                        type="submit"
                        disabled={
                          actionLoading === "comment" ||
                          comment.trim().length < 2
                        }
                      >
                        {actionLoading === "comment" ? "正在发送…" : "发送"}
                      </button>
                    </form>
                  </div>
                </div>
              </>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}
