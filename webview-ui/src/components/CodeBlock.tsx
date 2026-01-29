import { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeBlockProps {
  code: string;
  language?: string;
  status?: 'idle' | 'executing' | 'success' | 'error';
}

function CodeBlock({ code, language = 'python', status = 'idle' }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const statusLabels: Record<string, string | null> = {
    idle: null,
    executing: 'Running...',
    success: 'Executed',
    error: 'Error',
  };

  const getStatusClass = () => {
    switch (status) {
      case 'executing': return 'status-executing';
      case 'success': return 'status-success';
      case 'error': return 'status-error';
      default: return '';
    }
  };

  return (
    <div className={`code-block ${getStatusClass()}`}>
      <div className="code-block-header">
        <div className="code-block-info">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
          </svg>
          <span className="code-language">{language}</span>
          {statusLabels[status] && (
            <span className={`code-status ${status}`}>
              {status === 'executing' && (
                <span className="status-spinner"></span>
              )}
              {statusLabels[status]}
            </span>
          )}
        </div>
        <button className="copy-button" onClick={handleCopy}>
          {copied ? (
            <>
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          padding: '12px',
          fontSize: '12px',
          background: 'var(--vscode-textCodeBlock-background)',
          borderRadius: '0 0 4px 4px',
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

export default CodeBlock;
