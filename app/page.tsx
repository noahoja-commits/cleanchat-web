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

// Memoized components for performance
const MessageBubble = memo(function MessageBubble({ 
  message, 
  onCopy,
  copiedIdx,
}: { 
  message: Message; 
  onCopy: (text: string, idx: string) => void;
  copiedIdx: string | null;
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
              <button onClick={handleCopy} style={styles.copyBtn}>
                {copiedIdx === id ? "Copied!" : "Copy"}
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
}: {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        ...styles.convItem,
        background: isActive ? "#2a2a2a" : "transparent",
        borderLeft: isActive ? "3px solid #ff4444" : "3px solid transparent",
      }}
    >
      <button onClick={onSelect} style={styles.convTitle}>
        {conversation.title}
      </button>
      <button onClick={onDelete} style={styles.convDelete} title="Delete">
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

  // Load conversations from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CONVERSATIONS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setConversations(parsed);
        }
      }
      const currentId = localStorage.getItem(CURRENT_CONV_KEY);
      if (currentId) {
        setCurrentConvId(currentId);
      }
    } catch {
      // Ignore errors
    }
  }, []);

  // Load current conversation
  useEffect(() => {
    if (currentConvId) {
      const conv = conversations.find(c => c.id === currentConvId);
      if (conv) {
        setMessages(conv.messages);
      }
      localStorage.setItem(CURRENT_CONV_KEY, currentConvId);
    }
  }, [currentConvId, conversations]);

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
  }, []);

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
      const title = userMessages.length > 0 
        ? userMessages[userMessages.length - 1].content.slice(0, 50) + (userMessages[userMessages.length - 1].content.length > 50 ? "..." : "")
        : "New Chat";
      
      setConversations(prev => prev.map(c => 
        c.id === currentConvId 
          ? { ...c, messages, title, updatedAt: Date.now() }
          : c
      ));
    }
  }, [currentConvId, messages]);

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

  const exportChat = useCallback(() => {
    const md = exportToMarkdown(messages);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-export-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [messages]);

  const regenerate = useCallback(async () => {
    // Remove last assistant message if exists
    const lastAssistantIdx = messages.findLastIndex(m => m.role === "assistant");
    if (lastAssistantIdx === -1) return;
    
    const msgsWithoutLast = messages.slice(0, lastAssistantIdx);
    const userMsgs = msgsWithoutLast.filter(m => m.role === "user");
    if (userMsgs.length === 0) return;
    
    const lastUserMsg = userMsgs[userMsgs.length - 1];
    const msgsToSend = msgsWithoutLast.slice(0, msgsWithoutLast.indexOf(lastUserMsg) + 1);
    
    setMessages(msgsToSend);
    setInput("");
    setLoading(true);
    setIsStreaming(true);
    setAutoScroll(true);

    const controller = new AbortController();
    abortRef.current = controller;
    streamingContentRef.current = "";
    responseStartRef.current = Date.now();

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
      const decoder = new TextDecoder();
      
      if (!reader) throw new Error("No reader available");

      const assistantMsgId = generateId();
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              fullContent += parsed.content;
              streamingContentRef.current = fullContent;
              
              // Update message in real-time
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

      // Finalize message
      const responseTime = Date.now() - responseStartRef.current;
      setMessages(prev => prev.map(m => 
        m.id === assistantMsgId ? { ...m, responseTime } : m
      ));
    } catch (err: any) {
      if (err.name === "AbortError" || err.name === "CanceledError") {
        // If we have partial content, keep it
        if (streamingContentRef.current) {
          const responseTime = Date.now() - responseStartRef.current;
          setMessages(prev => prev.map(m => 
            m.content === streamingContentRef.current ? { ...m, responseTime } : m
          ));
        }
        return;
      }
      const errorMsg = err.message || "Error: request failed.";
      setMessages(prev => [...prev, { id: generateId(), role: "assistant", content: errorMsg, isError: true, timestamp: Date.now() }]);
    } finally {
      setLoading(false);
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { id: generateId(), role: "user", content: text, timestamp: Date.now() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setLoading(true);
    setIsStreaming(true);
    setAutoScroll(true);

    const controller = new AbortController();
    abortRef.current = controller;
    streamingContentRef.current = "";
    responseStartRef.current = Date.now();

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updated }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Invalid response" }));
        throw new Error(data.error || `HTTP error ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) throw new Error("No reader available");

      const assistantMsgId = generateId();
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
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

      const responseTime = Date.now() - responseStartRef.current;
      setMessages(prev => prev.map(m => 
        m.id === assistantMsgId ? { ...m, responseTime } : m
      ));
    } catch (err: any) {
      if (err.name === "AbortError" || err.name === "CanceledError") {
        if (streamingContentRef.current) {
          const responseTime = Date.now() - responseStartRef.current;
          setMessages(prev => prev.map(m => 
            m.content === streamingContentRef.current ? { ...m, responseTime } : m
          ));
        }
        return;
      }
      const errorMsg = err.message || "Error: request failed.";
      setMessages(prev => [...prev, { id: generateId(), role: "assistant", content: errorMsg, isError: true, timestamp: Date.now() }]);
    } finally {
      setLoading(false);
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, loading, messages]);

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
  const canRegenerate = visibleMessages.length > 0 && visibleMessages[visibleMessages.length - 1]?.role === "user";

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
          >
            ↓
          </button>
        )}
        <button onClick={createNewConversation} style={styles.newBtn} title="New chat (Ctrl+Shift+N)">
          + New
        </button>
        <button onClick={() => setShowSidebar(!showSidebar)} style={styles.sidebarBtn} title="Conversations">
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
                />
              ))
            )}
          </div>
          {messages.length > 1 && (
            <div style={styles.sidebarFooter}>
              <button onClick={exportChat} style={styles.exportBtn}>
                Export Chat
              </button>
              {canRegenerate && !loading && (
                <button onClick={regenerate} style={styles.regenBtn}>
                  Regenerate
                </button>
              )}
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
  regenBtn: {
    flex: 1,
    background: "#ff4444",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 600,
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
