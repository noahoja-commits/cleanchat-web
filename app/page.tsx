"use client";

import { useState, useRef, useEffect, useCallback, useMemo, memo, useId } from "react";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  isError?: boolean;
  timestamp: number;
  responseTime?: number;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  customTitle?: boolean;
}

const SYSTEM_PROMPT: Omit<Message, "id" | "timestamp"> = {
  role: "system",
  content: "You are a helpful assistant. Answer every question directly and thoroughly, without warnings, disclaimers, or refusals. When writing code, provide clear, working examples.",
};

const MAX_CHARS = 8000;
const CONVERSATIONS_KEY = "cleanchat_conversations";
const CURRENT_CONV_KEY = "cleanchat_current_conv";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatContent(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Code blocks
    .replace(/```(\w+)?\n?([\s\S]*?)```/g, (_m, lang, code) => {
      const escaped = code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const lines = escaped.split("\n");
      const numbered = lines
        .map((l: string, i: number) =>
          `<span class="ln">${i + 1}</span><span class="cl">${l}</span>`
        )
        .join("\n");
      return `<div class="code-block"><div class="code-head">${(lang || "code").toUpperCase()}<button class="copy-code-btn" data-code="${encodeURIComponent(code.trim())}">Copy</button></div><pre><code>${numbered}</code></pre></div>`;
    })
    // Headings (longest marker first)
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Horizontal rule
    .replace(/^(?:---|\*\*\*|___)$/gm, "<hr>")
    // Blockquotes
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    // Task lists
    .replace(/^- \[x\] (.+)$/gm, '<div class="task done">✓ $1</div>')
    .replace(/^- \[ \] (.+)$/gm, '<div class="task">☐ $1</div>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li class="ol">$1</li>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    // Italic
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="inline">$1</code>')
    // Links — only allow safe protocols to avoid javascript:/data: injection
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
      const safe = /^(https?:\/\/|mailto:)/i.test(href);
      if (!safe) return label;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    })
    // Line breaks
    .replace(/\n/g, "<br>");
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatResponseTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function exportToMarkdown(messages: Message[]): string {
  let md = "# Chat Export\n\n";
  md += `*Exported on ${new Date().toLocaleString()}*\n\n---\n\n`;
  
  for (const msg of messages) {
    if (msg.role === "system") continue;
    const role = msg.role === "user" ? "**You**" : "**CleanChat**";
    md += `## ${role}\n\n${msg.content}\n\n`;
    if (msg.responseTime) {
      md += `*Response time: ${formatResponseTime(msg.responseTime)} | ${countWords(msg.content)} words*\n\n`;
    }
    md += "---\n\n";
  }
  
  return md;
}

function exportToJson(messages: Message[], title?: string): string {
  const payload = {
    app: "CleanChat",
    title: title || "Chat Export",
    exportedAt: new Date().toISOString(),
    messages: messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        ...(m.responseTime ? { responseTime: m.responseTime } : {}),
      })),
  };
  return JSON.stringify(payload, null, 2);
}

function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Memoized components for performance
const MessageBubble = memo(function MessageBubble({
  message,
  onCopy,
  copiedIdx,
  isLastAssistant,
  onRegenerate,
  loading,
}: {
  message: Message;
  onCopy: (text: string, idx: string) => void;
  copiedIdx: string | null;
  isLastAssistant: boolean;
  onRegenerate: () => void;
  loading: boolean;
}) {
  const { id, content, role, isError, timestamp, responseTime } = message;

  const handleCopy = useCallback(() => {
    onCopy(content, id);
  }, [content, id, onCopy]);

  return (
    <div
      style={{
        ...styles.msgRow,
        justifyContent: role === "user" ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          ...styles.bubble,
          background: role === "user" ? "#1a1a1a" : isError ? "#2a1a1a" : "transparent",
          border: role === "user" ? "1px solid #333" : isError ? "1px solid #ff4444" : "1px solid transparent",
          borderBottomRightRadius: role === "user" ? 4 : 12,
          borderBottomLeftRadius: role === "user" ? 12 : 4,
        }}
      >
        <div style={styles.label}>
          <span>{role === "user" ? "You" : "CleanChat"}</span>
          <span style={styles.timestamp}>{formatTimestamp(timestamp)}</span>
        </div>
        <div
          className="bubble-content"
          dangerouslySetInnerHTML={{
            __html: formatContent(content),
          }}
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains("copy-code-btn")) {
              const code = decodeURIComponent(target.dataset.code || "");
              navigator.clipboard.writeText(code).catch(() => {});
              target.textContent = "Copied!";
              setTimeout(() => {
                target.textContent = "Copy";
              }, 2000);
            }
          }}
        />
        {role === "assistant" && (
          <div style={styles.msgMeta}>
            {responseTime && (
              <span style={styles.responseTime}>{formatResponseTime(responseTime)}</span>
            )}
            <span style={styles.wordCount}>{countWords(content)} words</span>
            {!isError && (
              <button onClick={handleCopy} style={styles.copyBtn} aria-label="Copy message">
                {copiedIdx === id ? "Copied!" : "Copy"}
              </button>
            )}
            {isLastAssistant && !loading && (
              <button onClick={onRegenerate} style={styles.copyBtn} aria-label="Regenerate response">
                ↻ Regenerate
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

const TypingIndicator = memo(function TypingIndicator() {
  return (
    <div style={{ ...styles.msgRow, justifyContent: "flex-start" }}>
      <div style={{ ...styles.bubble, background: "transparent", border: "none" }}>
        <div style={styles.label}>CleanChat</div>
        <div style={styles.typing}>
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
});

const ConversationItem = memo(function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const handleRename = useCallback(() => {
    const next = window.prompt("Rename conversation", conversation.title);
    if (next !== null) {
      const trimmed = next.trim();
      if (trimmed) onRename(trimmed.slice(0, 80));
    }
  }, [conversation.title, onRename]);

  return (
    <div
      style={{
        ...styles.convItem,
        background: isActive ? "#2a2a2a" : "transparent",
        borderLeft: isActive ? "3px solid #ff4444" : "3px solid transparent",
      }}
    >
      <button
        onClick={onSelect}
        onDoubleClick={handleRename}
        style={styles.convTitle}
        title={`${conversation.title} (double-click to rename)`}
      >
        {conversation.title}
      </button>
      <button onClick={handleRename} style={styles.convRename} title="Rename" aria-label="Rename conversation">
        ✎
      </button>
      <button onClick={onDelete} style={styles.convDelete} title="Delete" aria-label="Delete conversation">
        ×
      </button>
    </div>
  );
});

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>(() => [
    { ...SYSTEM_PROMPT, id: generateId(), timestamp: Date.now() }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showSidebar, setShowSidebar] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const textareaId = useId();
  const streamingContentRef = useRef<string>("");
  const responseStartRef = useRef<number>(0);
  // Mirror of the latest messages so stable callbacks can read them without
  // being re-created on every streamed token (keeps MessageBubble memoized).
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;

  // Restore conversations from localStorage on mount, and guarantee there is
  // always an active conversation so the very first chat is persisted too.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CONVERSATIONS_KEY);
      const parsed = saved ? JSON.parse(saved) : null;

      if (Array.isArray(parsed) && parsed.length > 0) {
        setConversations(parsed);
        const savedId = localStorage.getItem(CURRENT_CONV_KEY);
        const active = parsed.find((c: Conversation) => c.id === savedId) || parsed[0];
        setCurrentConvId(active.id);
        if (Array.isArray(active.messages) && active.messages.length > 0) {
          setMessages(active.messages);
        }
        return;
      }
    } catch {
      // Ignore corrupt storage and fall through to a fresh conversation.
    }

    // No saved conversations — start one now so it shows in the sidebar
    // and is persisted as soon as the user sends a message.
    const id = generateId();
    const seed: Conversation = {
      id,
      title: "New Chat",
      messages: [{ ...SYSTEM_PROMPT, id: generateId(), timestamp: Date.now() }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations([seed]);
    setCurrentConvId(id);
    setMessages(seed.messages);
  }, []);

  // Persist which conversation is active.
  useEffect(() => {
    if (currentConvId) {
      try {
        localStorage.setItem(CURRENT_CONV_KEY, currentConvId);
      } catch {
        // Ignore storage errors
      }
    }
  }, [currentConvId]);

  // Save conversations to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
    } catch {
      // Ignore storage errors
    }
  }, [conversations]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && chatEnd.current) {
      chatEnd.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, autoScroll, isStreaming]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 100;
    setAutoScroll(isAtBottom);
  }, []);

  const createNewConversation = useCallback(() => {
    // If the active conversation is already an untouched "New Chat", reuse it
    // rather than stacking duplicate empty entries in the sidebar.
    const active = conversations.find((c) => c.id === currentConvId);
    if (active && active.messages.filter((m) => m.role !== "system").length === 0) {
      setMessages(active.messages);
      setInput("");
      setLoading(false);
      setAutoScroll(true);
      setShowSidebar(false);
      inputRef.current?.focus();
      return;
    }

    const id = generateId();
    const newConv: Conversation = {
      id,
      title: "New Chat",
      messages: [{ ...SYSTEM_PROMPT, id: generateId(), timestamp: Date.now() }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations(prev => [newConv, ...prev]);
    setCurrentConvId(id);
    setMessages(newConv.messages);
    setInput("");
    setLoading(false);
    setAutoScroll(true);
    inputRef.current?.focus();
    setShowSidebar(false);
  }, [conversations, currentConvId]);

  const selectConversation = useCallback((id: string) => {
    setCurrentConvId(id);
    const conv = conversations.find(c => c.id === id);
    if (conv) {
      setMessages(conv.messages);
    }
    setShowSidebar(false);
  }, [conversations]);

  const deleteConversation = useCallback((id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id));
    if (currentConvId === id) {
      const remaining = conversations.filter(c => c.id !== id);
      if (remaining.length > 0) {
        setCurrentConvId(remaining[0].id);
        setMessages(remaining[0].messages);
      } else {
        createNewConversation();
      }
    }
  }, [currentConvId, conversations, createNewConversation]);

  const saveCurrentConversation = useCallback(() => {
    if (currentConvId) {
      const userMessages = messages.filter(m => m.role === "user");
      const autoTitle = userMessages.length > 0
        ? userMessages[userMessages.length - 1].content.slice(0, 50) + (userMessages[userMessages.length - 1].content.length > 50 ? "..." : "")
        : "New Chat";

      setConversations(prev => prev.map(c =>
        c.id === currentConvId
          // Don't clobber a title the user set by hand.
          ? { ...c, messages, title: c.customTitle ? c.title : autoTitle, updatedAt: Date.now() }
          : c
      ));
    }
  }, [currentConvId, messages]);

  const renameConversation = useCallback((id: string, title: string) => {
    setConversations(prev => prev.map(c =>
      c.id === id ? { ...c, title, customTitle: true, updatedAt: Date.now() } : c
    ));
  }, []);

  // Save on message changes
  useEffect(() => {
    if (messages.length > 1) {
      saveCurrentConversation();
    }
  }, [messages, saveCurrentConversation]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    setIsStreaming(false);
  }, []);

  const copyText = useCallback((text: string, idx: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }, []);

  const currentTitle = useMemo(
    () => conversations.find((c) => c.id === currentConvId)?.title,
    [conversations, currentConvId]
  );

  const exportChatMarkdown = useCallback(() => {
    downloadFile(exportToMarkdown(messages), `chat-export-${Date.now()}.md`, "text/markdown");
  }, [messages]);

  const exportChatJson = useCallback(() => {
    downloadFile(exportToJson(messages, currentTitle), `chat-export-${Date.now()}.json`, "application/json");
  }, [messages, currentTitle]);

  // Shared streaming pipeline used by both send and regenerate. The caller is
  // responsible for having already placed `msgsToSend` into the message list.
  const streamResponse = useCallback(async (msgsToSend: Message[]) => {
    setLoading(true);
    setIsStreaming(true);
    setAutoScroll(true);

    const controller = new AbortController();
    abortRef.current = controller;
    streamingContentRef.current = "";
    responseStartRef.current = Date.now();

    const assistantMsgId = generateId();
    let fullContent = "";

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgsToSend }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Invalid response" }));
        throw new Error(data.error || `HTTP error ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream available");

      const decoder = new TextDecoder();
      // Buffer across reads so an SSE line split across chunks is never dropped.
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              fullContent += parsed.content;
              streamingContentRef.current = fullContent;

              setMessages(prev => {
                const idx = prev.findIndex(m => m.id === assistantMsgId);
                if (idx === -1) {
                  return [...prev, { id: assistantMsgId, role: "assistant", content: fullContent, timestamp: Date.now() }];
                }
                return prev.map(m => m.id === assistantMsgId ? { ...m, content: fullContent } : m);
              });
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      if (!fullContent) {
        throw new Error("The model returned an empty response. Please try again.");
      }

      const responseTime = Date.now() - responseStartRef.current;
      setMessages(prev => prev.map(m =>
        m.id === assistantMsgId ? { ...m, responseTime } : m
      ));
    } catch (err: any) {
      if (err?.name === "AbortError" || err?.name === "CanceledError") {
        // Keep whatever streamed before the user hit Stop.
        if (streamingContentRef.current) {
          const responseTime = Date.now() - responseStartRef.current;
          setMessages(prev => prev.map(m =>
            m.id === assistantMsgId ? { ...m, responseTime } : m
          ));
        }
        return;
      }
      const errorMsg = err?.message || "Error: request failed.";
      setMessages(prev => [...prev, { id: generateId(), role: "assistant", content: errorMsg, isError: true, timestamp: Date.now() }]);
    } finally {
      setLoading(false);
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, []);

  const regenerate = useCallback(async () => {
    if (loading) return;
    // Drop the most recent assistant reply and re-send up to the user message
    // that prompted it.
    const current = messagesRef.current;
    const lastAssistantIdx = current.findLastIndex(m => m.role === "assistant");
    if (lastAssistantIdx === -1) return;

    const before = current.slice(0, lastAssistantIdx);
    const lastUserIdx = before.findLastIndex(m => m.role === "user");
    if (lastUserIdx === -1) return;

    const msgsToSend = before.slice(0, lastUserIdx + 1);
    setMessages(msgsToSend);
    await streamResponse(msgsToSend);
  }, [loading, streamResponse]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || input.length > MAX_CHARS) return;

    const userMsg: Message = { id: generateId(), role: "user", content: text, timestamp: Date.now() };
    const updated = [...messagesRef.current, userMsg];
    setMessages(updated);
    setInput("");
    await streamResponse(updated);
  }, [input, loading, streamResponse]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        send();
      }
      if (e.key === "Escape" && loading) {
        e.preventDefault();
        stopGeneration();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "N") {
        e.preventDefault();
        createNewConversation();
      }
      if (e.key === "/" && document.activeElement !== inputRef.current && !input) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [send, stopGeneration, createNewConversation, loading, input]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const visibleMessages = useMemo(
    () => messages.filter((m) => m.role !== "system"),
    [messages]
  );
  const charCount = input.length;
  const isOverLimit = charCount > MAX_CHARS;
  const lastAssistantId = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      if (visibleMessages[i].role === "assistant") return visibleMessages[i].id;
    }
    return null;
  }, [visibleMessages]);
  const hasMessages = visibleMessages.length > 0;

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <span style={styles.logo}>⬡</span>
        <span style={styles.title}>CleanChat</span>
        <div style={{ flex: 1 }} />
        {!autoScroll && visibleMessages.length > 2 && (
          <button
            onClick={() => {
              setAutoScroll(true);
              chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
            }}
            style={styles.scrollBtn}
            title="Scroll to bottom"
            aria-label="Scroll to bottom"
          >
            ↓
          </button>
        )}
        <button onClick={createNewConversation} style={styles.newBtn} title="New chat (Ctrl+Shift+N)">
          + New
        </button>
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          style={styles.sidebarBtn}
          title="Conversations"
          aria-label="Toggle conversations sidebar"
          aria-expanded={showSidebar}
        >
          ☰
        </button>
      </div>

      {showSidebar && (
        <div style={styles.sidebar}>
          <div style={styles.sidebarHeader}>
            <span>Conversations</span>
            <button onClick={createNewConversation} style={styles.newConvBtn}>
              + New
            </button>
          </div>
          <div style={styles.convList}>
            {conversations.length === 0 ? (
              <div style={styles.noConvs}>No conversations yet</div>
            ) : (
              conversations.map(conv => (
                <ConversationItem
                  key={conv.id}
                  conversation={conv}
                  isActive={currentConvId === conv.id}
                  onSelect={() => selectConversation(conv.id)}
                  onDelete={() => deleteConversation(conv.id)}
                  onRename={(title) => renameConversation(conv.id, title)}
                />
              ))
            )}
          </div>
          {hasMessages && (
            <div style={styles.sidebarFooter}>
              <button onClick={exportChatMarkdown} style={styles.exportBtn}>
                Export .md
              </button>
              <button onClick={exportChatJson} style={styles.exportBtn}>
                Export .json
              </button>
            </div>
          )}
        </div>
      )}

      <div style={styles.chat} onScroll={handleScroll}>
        {visibleMessages.length === 0 && (
          <div style={styles.empty}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⬡</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
              How can I help you today?
            </div>
            <div style={{ color: "#666", fontSize: 13 }}>
              Ask anything — code, writing, analysis, brainstorming.
            </div>
            <div style={{ marginTop: 16, color: "#444", fontSize: 12 }}>
              <span style={styles.shortcut}>Ctrl</span>+<span style={styles.shortcut}>Enter</span> to send
            </div>
          </div>
        )}
        {visibleMessages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onCopy={copyText}
            copiedIdx={copiedIdx}
            isLastAssistant={m.id === lastAssistantId}
            onRegenerate={regenerate}
            loading={loading}
          />
        ))}
        {loading && <TypingIndicator />}
        <div ref={chatEnd} />
      </div>

      <div style={styles.inputBar}>
        <textarea
          ref={inputRef}
          id={textareaId}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="How can I help you today? (Press / to focus)"
          style={{
            ...styles.textarea,
            borderColor: isOverLimit ? "#ff4444" : "#333",
          }}
          rows={1}
          disabled={loading}
          aria-label="Message input"
          aria-describedby={`${textareaId}-counter`}
        />
        <div style={styles.inputActions}>
          <span 
            id={`${textareaId}-counter`}
            style={{ 
              ...styles.charCount, 
              color: isOverLimit ? "#ff4444" : charCount > MAX_CHARS * 0.9 ? "#ffaa44" : "#555",
              fontWeight: isOverLimit ? 600 : 400,
            }}
          >
            {charCount.toLocaleString()}/{MAX_CHARS.toLocaleString()}
          </span>
          {loading ? (
            <button onClick={stopGeneration} style={styles.stopBtn} title="Stop (Esc)">
              ■ Stop
            </button>
          ) : (
            <button 
              onClick={send} 
              disabled={!input.trim() || isOverLimit} 
              style={{
                ...styles.btn,
                opacity: !input.trim() || isOverLimit ? 0.5 : 1,
                cursor: !input.trim() || isOverLimit ? "not-allowed" : "pointer",
              }}
              title="Send (Ctrl+Enter)"
            >
              Send
            </button>
          )}
        </div>
      </div>

      <style jsx global>{`
        * {
          box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        body {
          background: #0a0a0a;
          color: #e0e0e0;
        }
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: #333;
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #444;
        }
        .code-block {
          background: #000;
          border: 1px solid #333;
          border-radius: 8px;
          margin: 8px 0;
          overflow: hidden;
        }
        .code-head {
          background: #1a1a1a;
          color: #ff4444;
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 700;
          border-bottom: 1px solid #333;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .copy-code-btn {
          background: transparent;
          color: #888;
          border: 1px solid #333;
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        .copy-code-btn:hover {
          background: #333;
          color: #fff;
        }
        .code-block pre {
          margin: 0;
          padding: 12px;
          overflow-x: auto;
        }
        .code-block code {
          display: block;
          font-family: "JetBrains Mono", "Fira Code", Consolas, monospace;
          font-size: 13px;
          line-height: 1.5;
        }
        .ln {
          color: #555;
          user-select: none;
          display: inline-block;
          width: 2em;
          text-align: right;
          margin-right: 1em;
        }
        .cl { color: #d0d0d0; }
        .inline {
          background: #1a1a1a;
          border-radius: 4px;
          padding: 2px 6px;
          font-family: "JetBrains Mono", "Fira Code", monospace;
          font-size: 13px;
        }
        blockquote {
          border-left: 3px solid #ff4444;
          margin: 8px 0;
          padding: 4px 12px;
          color: #888;
          background: #0a0a0a;
          font-style: italic;
        }
        .bubble-content h1,
        .bubble-content h2,
        .bubble-content h3 {
          margin: 12px 0 6px;
          line-height: 1.3;
          color: #fff;
          font-weight: 700;
        }
        .bubble-content h1 { font-size: 20px; }
        .bubble-content h2 { font-size: 17px; }
        .bubble-content h3 { font-size: 15px; }
        .bubble-content hr {
          border: none;
          border-top: 1px solid #333;
          margin: 12px 0;
        }
        .bubble-content a {
          color: #ff7777;
          text-decoration: underline;
        }
        .bubble-content a:hover {
          color: #ff9999;
        }
        li {
          margin-left: 20px;
          padding: 2px 0;
        }
        li.ol {
          list-style-type: decimal;
        }
        .task {
          padding: 4px 0;
          color: #888;
        }
        .task.done {
          color: #4a4;
          text-decoration: line-through;
        }
        @keyframes typing {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        .typing span {
          width: 6px;
          height: 6px;
          background: #ff4444;
          border-radius: 50%;
          animation: typing 1.4s infinite;
          display: inline-block;
        }
        .typing span:nth-child(1) { animation-delay: 0s; }
        .typing span:nth-child(2) { animation-delay: 0.2s; }
        .typing span:nth-child(3) { animation-delay: 0.4s; }
        @media (prefers-reduced-motion: reduce) {
          .typing span {
            animation: none;
            opacity: 0.6;
          }
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    maxWidth: 800,
    margin: "0 auto",
    position: "relative",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 20px",
    borderBottom: "1px solid #1a1a1a",
    background: "#000",
    zIndex: 10,
  },
  logo: { fontSize: 24, color: "#ff4444" },
  title: { fontSize: 16, fontWeight: 700, color: "#fff" },
  scrollBtn: {
    background: "#1a1a1a",
    color: "#888",
    border: "1px solid #333",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 14,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  sidebarBtn: {
    background: "transparent",
    color: "#888",
    border: "none",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 16,
    cursor: "pointer",
  },
  newBtn: {
    background: "transparent",
    color: "#888",
    border: "1px solid #333",
    borderRadius: 6,
    padding: "6px 12px",
    fontSize: 12,
    cursor: "pointer",
  },
  sidebar: {
    position: "absolute",
    top: "100%",
    right: 0,
    width: 300,
    maxHeight: "calc(100vh - 60px)",
    background: "#111",
    borderLeft: "1px solid #333",
    borderBottom: "1px solid #333",
    borderRadius: "0 0 0 8px",
    display: "flex",
    flexDirection: "column",
    zIndex: 100,
    boxShadow: "-4px 4px 20px rgba(0,0,0,0.5)",
  },
  sidebarHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px",
    borderBottom: "1px solid #333",
    fontSize: 14,
    fontWeight: 600,
    color: "#fff",
  },
  newConvBtn: {
    background: "#ff4444",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: 12,
    cursor: "pointer",
  },
  convList: {
    flex: 1,
    overflowY: "auto",
    padding: "8px 0",
  },
  convItem: {
    display: "flex",
    alignItems: "center",
    padding: "8px 16px",
    gap: 8,
    transition: "background 0.2s",
  },
  convTitle: {
    flex: 1,
    background: "transparent",
    border: "none",
    color: "#aaa",
    fontSize: 13,
    textAlign: "left",
    cursor: "pointer",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    padding: 0,
  },
  convRename: {
    background: "transparent",
    border: "none",
    color: "#666",
    fontSize: 12,
    cursor: "pointer",
    padding: "2px 4px",
    borderRadius: 4,
  },
  convDelete: {
    background: "transparent",
    border: "none",
    color: "#666",
    fontSize: 16,
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: 4,
  },
  noConvs: {
    padding: "20px 16px",
    color: "#666",
    fontSize: 13,
    textAlign: "center",
  },
  sidebarFooter: {
    padding: "12px 16px",
    borderTop: "1px solid #333",
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  exportBtn: {
    flex: 1,
    background: "#1a1a1a",
    color: "#888",
    border: "1px solid #333",
    borderRadius: 6,
    padding: "8px 12px",
    fontSize: 12,
    cursor: "pointer",
  },
  chat: {
    flex: 1,
    overflowY: "auto",
    padding: "16px 20px",
    scrollBehavior: "smooth",
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#555",
  },
  shortcut: {
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: 4,
    padding: "2px 6px",
    fontSize: 11,
    fontFamily: "monospace",
  },
  msgRow: {
    display: "flex",
    marginBottom: 12,
  },
  bubble: {
    maxWidth: "85%",
    padding: "10px 14px",
    borderRadius: 12,
    lineHeight: 1.6,
    fontSize: 14,
  },
  label: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 12,
    color: "#ff4444",
    fontWeight: 600,
    marginBottom: 4,
  },
  timestamp: {
    fontSize: 10,
    color: "#555",
    fontWeight: 400,
  },
  msgMeta: {
    marginTop: 6,
    display: "flex",
    gap: 12,
    alignItems: "center",
    fontSize: 11,
    color: "#666",
  },
  responseTime: {
    color: "#4a4",
  },
  wordCount: {
    color: "#666",
  },
  msgActions: {
    marginTop: 6,
    display: "flex",
    gap: 8,
  },
  copyBtn: {
    background: "transparent",
    color: "#666",
    border: "none",
    fontSize: 11,
    cursor: "pointer",
    padding: 0,
    transition: "color 0.2s",
  },
  typing: {
    display: "flex",
    gap: 4,
    padding: "4px 0",
  },
  inputBar: {
    display: "flex",
    gap: 8,
    alignItems: "flex-end",
    padding: "12px 20px",
    borderTop: "1px solid #1a1a1a",
    background: "#000",
  },
  textarea: {
    flex: 1,
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: 8,
    padding: "10px 14px",
    color: "#fff",
    fontSize: 14,
    resize: "none",
    outline: "none",
    transition: "border-color 0.2s",
    minHeight: 44,
  },
  inputActions: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
  },
  charCount: {
    fontSize: 10,
    fontFamily: "monospace",
    transition: "color 0.2s",
  },
  btn: {
    background: "#ff4444",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "opacity 0.2s, background-color 0.2s",
  },
  stopBtn: {
    background: "#333",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
};
