"use client";

import { useEffect, useRef, useState } from "react";
import { useCommentPagination } from "../hooks/useCommentPagination";
import { useDemoConfig } from "../hooks/useDemoConfig";
import ExternalLinks from "../components/ExternalLinks";
import { recordCode } from "../utils/recordCode";

type Feedback = {
  id: string;
  category: "suggestion" | "complaint" | "report";
  original_content: string;
  device_id: string;
  created_at: string;
  status: "pending" | "in_progress" | "resolved" | "no_solution";
  solution?: string;
  unread_notifications?: number;
  is_demo_template?: number;
  is_demo_clone?: number;
};
type FeedbackCounts = { total: number; pending: number; processing: number; resolved: number; noSolution: number };
const emptyCounts: FeedbackCounts = { total: 0, pending: 0, processing: 0, resolved: 0, noSolution: 0 };
type Comment = {
  id: number;
  feedback_id: string;
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
  const { config: demoConfig, loading: demoLoading, error: demoError } = useDemoConfig();
  const demoMode = demoConfig?.demoMode === true;
  const modeReady = !!demoConfig && !demoLoading;
  const [demoCommentId, setDemoCommentId] = useState("");
  const [demoSolutionId, setDemoSolutionId] = useState("in_progress");
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
  const [detailLoading, setDetailLoading] = useState(false);
  const selectionRequestRef = useRef(0);
  const listRequestRef = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [counts, setCounts] = useState<FeedbackCounts>(emptyCounts);
  const readOnly = !modeReady || (demoMode && !!selected?.is_demo_template);
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

  const fetchData = async (cursor = cursorRef.current, history = cursorHistory): Promise<Feedback[]> => {
    const request = ++listRequestRef.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({ pagination: "1", limit: "50", category, status, search });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/anonyproof/api/admin/feedbacks?${query}`, {
        credentials: "same-origin",
      });
      const data = await readApiJson(response);
      if (request !== listRequestRef.current) return [];
      const nextFeedbacks = data.feedbacks as Feedback[];
      setFeedbacks(nextFeedbacks);
      setFilteredTotal(data.pagination.total);
      setNextCursor(data.pagination.nextCursor);
      setCounts(data.counts);
      cursorRef.current = cursor;
      setCursorHistory(history);
      feedbacksLoadedRef.current = true;
      return nextFeedbacks;
    } catch (error) {
      if (request === listRequestRef.current) handleRequestError(
        error,
        feedbacksLoadedRef.current
          ? "无法连接管理服务，当前显示上次数据"
          : "无法连接管理服务，请检查网络后重试",
      );
      return [];
    } finally {
      if (request === listRequestRef.current) setLoading(false);
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

  const commentPages = useCommentPagination<Comment>(authenticated ? "admin" : "logged-out", readApiJson,
    error => handleRequestError(error, "沟通记录暂时无法加载，请稍后重试"));
  const { comments, total: commentsTotal, loading: commentsLoading, hasOlder: hasOlderComments, reset: resetComments } = commentPages;
  const fetchComments = (id: string, mode: "latest" | "older" | "newer" = "latest") => commentPages.load(id, mode);

  useEffect(() => {
    fetch("/anonyproof/api/admin/auth/session", {
    })
      .then((response) => readApiJson(response))
      .then(async (data) => {
        setAuthenticated(data.authenticated);
        if (data.authenticated) {
          const targetId = new URLSearchParams(window.location.search).get("feedback");
          if (targetId) await selectFeedback(targetId, true);
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

  // Filters run against the entire authorized collection, not just this page.
  // Invalidate an old request immediately so a late response cannot replace a
  // newer filter/page. Only retain the current page in browser memory and DOM.
  useEffect(() => {
    if (!authenticated) return;
    ++listRequestRef.current;
    cursorRef.current = null;
    setCursorHistory([]);
    setNextCursor(null);
    setFeedbacks([]);
    setFilteredTotal(0);
    setLoading(true);
    const timer = setTimeout(() => void fetchData(null, []), 250);
    return () => { clearTimeout(timer); ++listRequestRef.current; };
  }, [authenticated, category, status, search]);

  const clearSelection = (restoreListPosition = false) => {
    ++selectionRequestRef.current;
    setDetailLoading(false);
    syncFeedbackQuery(null);
    setSelected(null);
    resetComments();
    setSolution("");
    if (restoreListPosition) {
      window.requestAnimationFrame(() => {
        if (feedbackListRef.current) {
          feedbackListRef.current.scrollTop = feedbackListScrollTopRef.current;
        }
      });
    }
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginLoading(true);
    setLoginError("");
    try {
      const response = await fetch("/anonyproof/api/admin/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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
      const targetId = new URLSearchParams(window.location.search).get("feedback");
      if (targetId) await selectFeedback(targetId, true);
      fetchNotifications();
    } catch {
      setLoginError("无法连接管理服务，请稍后重试");
    } finally {
      setLoginLoading(false);
    }
  };

  const selectFeedback = async (
    itemOrId: Feedback | string,
    forceReadNotifications = false,
  ) => {
    const id = typeof itemOrId === "string" ? itemOrId : itemOrId.id;
    const request = ++selectionRequestRef.current;
    feedbackListScrollTopRef.current =
      feedbackListRef.current?.scrollTop ?? feedbackListScrollTopRef.current;
    setDetailLoading(true);
    setSelected(null);
    resetComments();
    setSolution("");
    setMessage("");
    try {
      // A list row is a summary. Fetch full, authorized detail for every entry,
      // including URL/notification targets that are outside this page/filter.
      const response = await fetch(`/anonyproof/api/admin/feedback/${encodeURIComponent(id)}`, {
        credentials: "same-origin",
      });
      const data = await readApiJson(response);
      if (request !== selectionRequestRef.current) return;
      const item = data.feedback as Feedback;
      syncFeedbackQuery(item.id);
      setSelected(item);
      setDemoCommentId("");
      setDemoSolutionId(item.status === "pending" ? "in_progress" : item.status);
      fetchComments(item.id);
      const unread = typeof itemOrId === "string" ? 0 : itemOrId.unread_notifications ?? 0;
      if (!(demoMode && item.is_demo_template) && (forceReadNotifications || unread > 0)) {
        const readResponse = await fetch(
          `/anonyproof/api/notifications/read-all?recipientType=admin&recipientId=admin&feedbackId=${encodeURIComponent(item.id)}`,
          { method: "PUT", credentials: "same-origin" },
        );
        await readApiJson(readResponse);
        if (request !== selectionRequestRef.current) return;
        setFeedbacks((items) => items.map((entry) =>
          entry.id === item.id ? { ...entry, unread_notifications: 0 } : entry));
        await fetchUnreadCount();
      }
    } catch (error) {
      if (request === selectionRequestRef.current) {
        syncFeedbackQuery(null);
        handleRequestError(error, "记录详情暂时无法打开");
      }
    } finally {
      if (request === selectionRequestRef.current) setDetailLoading(false);
    }
  };

  const updateStatus = async (nextStatus: Feedback["status"]) => {
    if (!selected || readOnly) return;
    if (selected.status === nextStatus) {
      setMessage("");
      return;
    }
    if (
      !demoMode && (nextStatus === "resolved" || nextStatus === "no_solution") &&
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
          body: JSON.stringify(demoMode ? { status: nextStatus, demoSolutionId } : { status: nextStatus, solution }),
        },
      );
      await readApiJson(response);
      setMessage("");
      setMessageTone("info");
      setSolution("");
      setSelected((current) =>
        current ? { ...current, status: nextStatus, solution: demoMode ? demoConfig?.solutions?.find(item => item.id === demoSolutionId)?.content : solution } : current,
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
    if (!selected || readOnly || commentsLoading || (demoMode ? !demoCommentId : comment.trim().length < 2)) return;
    const request = selectionRequestRef.current, id = selected.id, draft = comment, example = demoCommentId;
    setActionLoading("comment");
    try {
      const response = await fetch(
        `/anonyproof/api/admin/feedback/${id}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(demoMode ? { demoCommentId } : { content: comment.trim() }),
        },
      );
      const data = await readApiJson(response);
      if (request !== selectionRequestRef.current || !commentPages.appendPosted(data.comment, "admin")) return;
      setComment(value => value === draft ? "" : value);
      setDemoCommentId(value => value === example ? "" : value);
      const loaded = await fetchComments(id, "newer");
      if (request !== selectionRequestRef.current || !loaded) return;
      setMessage("回复已发送");
      setMessageTone("success");
      fetchNotifications();
    } catch (error) {
      if (request === selectionRequestRef.current) handleRequestError(error, "回复失败，请稍后重试");
    } finally {
      setActionLoading("");
    }
  };

  const markNotificationRead = async (notification: Notification) => {
    await selectFeedback(notification.feedback_id, !notification.is_read);
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
            {!demoMode && modeReady && <a href="/anonyproof/access-stats">访问与风控</a>}
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
            onClick={() => void fetchData()}
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
              <span>{filteredTotal} 条 · 当前页 {feedbacks.length} 条</span>
            </div>
            {feedbacks.length === 0 ? (
              <div className="admin-empty">
                <strong>{loading ? "正在加载提交…" : "暂无匹配提交"}</strong>
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
                {feedbacks.map((item) => (
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
                          #{recordCode(item.id)}
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
            <div className="panel-heading" aria-label="提交记录分页">
              <button type="button" disabled={loading || cursorHistory.length === 0}
                onClick={() => {
                  clearSelection();
                  const previous = cursorHistory.at(-1) ?? null;
                  void fetchData(previous, cursorHistory.slice(0, -1));
                }}>上一页</button>
              <span>第 {cursorHistory.length + 1} 页</span>
              <button type="button" disabled={loading || !nextCursor}
                onClick={() => {
                  if (!nextCursor) return;
                  clearSelection();
                  void fetchData(nextCursor, [...cursorHistory, cursorRef.current]);
                }}>下一页</button>
            </div>
          </section>
          <aside className="admin-detail-panel">
            {detailLoading ? <div className="admin-inline-loading" role="status">正在加载记录详情…</div> : !selected ? (
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
                        <span>#{recordCode(selected.id)}</span>
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
                      {!modeReady ? <p role="status">{demoError || "正在确认站点模式…"}</p> : demoMode && selected.is_demo_template ? <p>公开合成模板只读。请选择本浏览器沙箱副本体验处理流程。</p> : demoMode ? <>
                        <label htmlFor="demo-solution">固定演示处理说明</label>
                        <select id="demo-solution" value={demoSolutionId} onChange={event => setDemoSolutionId(event.target.value)}>
                          {demoConfig?.solutions?.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </select>
                        <p>{demoConfig?.solutions?.find(item => item.id === demoSolutionId)?.content}</p>
                      </> : <>
                      <textarea
                        id="solution"
                        aria-label="处理说明"
                        maxLength={10000}
                        value={solution}
                        onChange={(event) => setSolution(event.target.value)}
                        placeholder="填写本次核查结论、处理动作或原因"
                        rows={3}
                      />
                      </>}
                      <div className="status-actions">
                        <button
                          className={`process-action ${selected.status === "in_progress" ? "is-active" : ""}`}
                          aria-pressed={selected.status === "in_progress"}
                          disabled={Boolean(actionLoading) || readOnly || (demoMode && demoSolutionId !== "in_progress")}
                          onClick={() => updateStatus("in_progress")}
                        >
                          {actionLoading === "in_progress"
                            ? "正在保存…"
                            : "设为处理中"}
                        </button>
                        <button
                          className={`success-action ${selected.status === "resolved" ? "is-active" : ""}`}
                          aria-pressed={selected.status === "resolved"}
                          disabled={Boolean(actionLoading) || readOnly || (demoMode && demoSolutionId !== "resolved")}
                          onClick={() => updateStatus("resolved")}
                        >
                          {actionLoading === "resolved"
                            ? "正在保存…"
                            : "标记已办结"}
                        </button>
                        <button
                          className={`muted-action ${selected.status === "no_solution" ? "is-active" : ""}`}
                          aria-pressed={selected.status === "no_solution"}
                          disabled={Boolean(actionLoading) || readOnly || (demoMode && demoSolutionId !== "no_solution")}
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
                      沟通记录 <span>{commentsTotal}</span>
                    </h3>
                    <div className="comment-list">
                      {commentsLoading && <div className="admin-inline-loading"><span className="spinner" />正在加载沟通记录…</div>}
                      {hasOlderComments && <button type="button" disabled={commentsLoading || actionLoading === "comment"} onClick={() => selected && fetchComments(selected.id, "older")}>加载较早沟通记录</button>}
                      {comments.length ? (
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
                      ) : !commentsLoading ? (
                        <p className="empty-inline">暂无补充说明。</p>
                      ) : null}
                    </div>
                    <form className="comment-form" onSubmit={addComment}>
                      {readOnly ? <p>{demoMode ? "公开模板只读" : demoError || "正在确认站点模式…"}</p> : demoMode ? <select aria-label="固定演示回复" value={demoCommentId} onChange={event => setDemoCommentId(event.target.value)}><option value="">选择固定演示回复</option>{demoConfig?.adminComments?.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <>
                      <input
                        value={comment}
                        maxLength={1000}
                        onChange={(event) => setComment(event.target.value)}
                        placeholder="输入回复内容"
                        aria-label="回复内容"
                      />
                      </>}
                      <button
                        type="submit"
                        disabled={
                          actionLoading === "comment" || commentsLoading || readOnly ||
                          (demoMode ? !demoCommentId : comment.trim().length < 2)
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
