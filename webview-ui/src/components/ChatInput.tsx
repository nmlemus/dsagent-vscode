import { useState, useRef, useEffect, KeyboardEvent, ChangeEvent } from 'react';

interface ChatInputProps {
  onSend: (message: string) => void;
  onAttach: () => void;
  onRemoveFile: (index: number) => void;
  disabled?: boolean;
  attachedFiles?: { name: string }[];
  isUploading?: boolean;
}

function ChatInput({ onSend, onAttach, onRemoveFile, disabled = false, attachedFiles = [], isUploading }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [message]);

  const handleSend = () => {
    const trimmedMessage = message.trim();
    if (trimmedMessage && !disabled) {
      onSend(trimmedMessage);
      setMessage('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
  };

  return (
    <div className="chat-input-container">
      {attachedFiles.length > 0 && (
        <div className="attached-file-preview">
          {attachedFiles.map((file, index) => (
            <div className="file-chip" key={index}>
              <span className="file-chip-name">{file.name}</span>
              <button
                className="file-chip-remove"
                onClick={() => onRemoveFile(index)}
                title="Remove file"
                disabled={disabled}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
      {isUploading && (
        <div className="upload-progress">
          <div className="upload-spinner" />
          <span>Uploading files...</span>
        </div>
      )}
      <div className="chat-input-wrapper">
        <button
          className="attach-button"
          onClick={onAttach}
          disabled={disabled || isUploading}
          title="Attach files"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Connecting...' : 'Ask DSAgent anything...'}
          disabled={disabled}
          rows={1}
        />
        <button onClick={handleSend} disabled={disabled || !message.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}

export default ChatInput;
