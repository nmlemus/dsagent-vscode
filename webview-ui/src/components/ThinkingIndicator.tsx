interface ThinkingIndicatorProps {
  content?: string;
}

function ThinkingIndicator({ content }: ThinkingIndicatorProps) {
  return (
    <div className="thinking-indicator">
      <div className="thinking-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
      {content && <span className="thinking-content">{content}</span>}
    </div>
  );
}

export default ThinkingIndicator;
