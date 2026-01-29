import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  type: 'user' | 'assistant' | 'code';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
}

interface ChatMessageProps {
  message: Message;
}

// Strip XML-like tags from content
function stripTags(content: string): string {
  return content
    // Remove <plan>...</plan> or <plan>... (unclosed)
    .replace(/<plan>[\s\S]*?(<\/plan>|$)/g, '')
    // Remove <code>...</code> or <code>... (unclosed)
    .replace(/<code>[\s\S]*?(<\/code>|$)/g, '')
    // Remove <answer>...</answer> but keep the content inside
    .replace(/<answer>([\s\S]*?)(<\/answer>|$)/g, '$1')
    // Remove markdown code blocks that might be duplicated
    .replace(/```[\w]*\n[\s\S]*?```/g, '')
    .trim();
}

function ChatMessage({ message }: ChatMessageProps) {
  if (message.type === 'user') {
    return (
      <div className="message user">
        <div className="message-avatar user-avatar">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
          </svg>
        </div>
        <div className="message-content">
          <span className="message-role">You</span>
          <p className="user-text">{message.content}</p>
        </div>
      </div>
    );
  }

  if (message.type === 'assistant') {
    const cleanContent = stripTags(message.content);

    // Show loading state
    if (!cleanContent && message.isStreaming) {
      return (
        <div className="message assistant">
          <div className="message-avatar assistant-avatar">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
          </div>
          <div className="message-content">
            <span className="message-role">Assistant</span>
            <div className="thinking-inline">
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
            </div>
          </div>
        </div>
      );
    }

    if (!cleanContent) return null;

    return (
      <div className="message assistant">
        <div className="message-avatar assistant-avatar">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
          </svg>
        </div>
        <div className="message-content">
          <span className="message-role">Assistant</span>
          <div className={`markdown-content ${message.isStreaming ? 'streaming' : ''}`}>
            <ReactMarkdown>{cleanContent}</ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default ChatMessage;
