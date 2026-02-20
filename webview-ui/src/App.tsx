import { useState, useEffect, useRef, useCallback } from 'react';
import { vscode } from './vscode';
import ChatInput from './components/ChatInput';
import ChatMessage from './components/ChatMessage';
import CodeBlock from './components/CodeBlock';
import ExecutionResult from './components/ExecutionResult';
import PlanView from './components/PlanView';

// Message types
interface ChatMessageData {
  id: string;
  type: 'user' | 'assistant' | 'code';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  plan?: Plan;
  code?: string;
  codeStatus?: 'idle' | 'executing' | 'success' | 'error';
  executionResult?: ExecutionResultData;
}

interface PlanStep {
  number: number;
  description: string;
  completed: boolean;
}

interface Plan {
  steps: PlanStep[];
  raw_text: string;
  progress: string;
  total_steps: number;
}

interface ExecutionResultData {
  success: boolean;
  stdout?: string;
  stderr?: string;
  output?: string;
  error?: string;
  images?: Array<{ format?: string; mime?: string; data: string }>;
}

type HITLAwaitingType = 'plan' | 'code' | 'answer' | 'error' | null;

interface HITLRequestData {
  awaitingType: HITLAwaitingType;
  plan?: Plan | null;
  code?: string | null;
  error?: string | null;
  answer?: string | null;
  message?: string | null;
}

function App() {
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [serverAvailable, setServerAvailable] = useState(true);
  const [hitlRequest, setHitlRequest] = useState<HITLRequestData | null>(null);
  const [hitlFeedback, setHitlFeedback] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<{ name: string }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track current assistant message for updates
  const currentAssistantIdRef = useRef<string | null>(null);
  const lastCodeMessageIdRef = useRef<string | null>(null);
  const hasAddedCodeRef = useRef<boolean>(false);

  const addMessage = useCallback((message: ChatMessageData) => {
    setMessages(prev => [...prev, message]);
  }, []);

  const updateMessage = useCallback((id: string, updates: Partial<ChatMessageData>) => {
    setMessages(prev => prev.map(msg =>
      msg.id === id ? { ...msg, ...updates } : msg
    ));
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case 'syncState':
          if (message.messages) {
            setMessages(message.messages);
          }
          if (message.plan) {
            setCurrentPlan(message.plan);
          }
          setIsStreaming(message.isStreaming || false);
          setServerAvailable(message.serverAvailable !== false);
          break;

        case 'userMessage': {
          // Reset state for new conversation turn
          hasAddedCodeRef.current = false;
          lastCodeMessageIdRef.current = null;

          // Add user message
          addMessage({
            id: message.message.id,
            type: 'user',
            content: message.message.content,
            timestamp: message.message.timestamp,
          });

          // Create placeholder for assistant response
          const assistantId = `assistant-${Date.now()}`;
          currentAssistantIdRef.current = assistantId;
          addMessage({
            id: assistantId,
            type: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            isStreaming: true,
          });
          setIsStreaming(true);
          break;
        }

        case 'thinking':
          if (currentAssistantIdRef.current) {
            updateMessage(currentAssistantIdRef.current, {
              content: message.content || 'Thinking...',
            });
          }
          break;

        case 'llm_response':
        case 'assistantMessage': {
          const content = message.content || message.message?.content || '';

          if (hasAddedCodeRef.current && currentAssistantIdRef.current) {
            // Mark previous assistant as done
            updateMessage(currentAssistantIdRef.current, { isStreaming: false });

            // Create new assistant message after code
            const newId = `assistant-${Date.now()}-response`;
            currentAssistantIdRef.current = newId;
            addMessage({
              id: newId,
              type: 'assistant',
              content: content,
              timestamp: new Date().toISOString(),
              isStreaming: true,
            });
            hasAddedCodeRef.current = false;
          } else if (currentAssistantIdRef.current) {
            updateMessage(currentAssistantIdRef.current, { content });
          }
          break;
        }

        case 'plan':
          setCurrentPlan(message.plan);
          if (currentAssistantIdRef.current) {
            updateMessage(currentAssistantIdRef.current, { plan: message.plan });
          }
          break;

        case 'codeExecuting': {
          hasAddedCodeRef.current = true;
          const codeId = `code-${Date.now()}`;
          lastCodeMessageIdRef.current = codeId;

          addMessage({
            id: codeId,
            type: 'code',
            content: message.code,
            code: message.code,
            timestamp: new Date().toISOString(),
            codeStatus: 'executing',
          });
          break;
        }

        case 'codeResult':
          if (lastCodeMessageIdRef.current) {
            const result = message.result;
            updateMessage(lastCodeMessageIdRef.current, {
              codeStatus: result?.success ? 'success' : 'error',
              executionResult: {
                success: result?.success ?? true,
                stdout: result?.output || result?.stdout || '',
                stderr: result?.stderr || '',
                error: result?.error,
                images: result?.images,
              },
            });
          }
          break;

        case 'answer':
          if (currentAssistantIdRef.current) {
            updateMessage(currentAssistantIdRef.current, {
              content: message.content || message.message?.content || '',
              isStreaming: false,
            });
          }
          setIsStreaming(false);
          break;

        case 'error':
          setIsStreaming(false);
          if (currentAssistantIdRef.current) {
            updateMessage(currentAssistantIdRef.current, {
              content: `Error: ${message.message}`,
              isStreaming: false,
            });
          }
          break;

        case 'complete':
        case 'done':
          setIsStreaming(false);
          if (currentAssistantIdRef.current) {
            updateMessage(currentAssistantIdRef.current, { isStreaming: false });
          }
          break;

        case 'hitlRequest':
          setHitlRequest({
            awaitingType: message.awaitingType || 'plan',
            plan: message.plan || null,
            code: message.code || null,
            error: message.error || null,
            answer: message.answer || null,
            message: message.message || null,
          });
          // Pre-fill feedback for editing when plan or code is pending
          const at = message.awaitingType || 'plan';
          setHitlFeedback(
            at === 'plan' && message.plan?.raw_text
              ? message.plan.raw_text
              : at === 'code' && message.code
                ? message.code
                : ''
          );
          break;

        case 'connected':
        case 'serverAvailable':
          setServerAvailable(true);
          break;

        case 'disconnected':
        case 'serverUnavailable':
          setServerAvailable(false);
          break;

        case 'loadHistory': {
          // Replace all messages with historical ones
          const historyMessages = (message.messages || []) as ChatMessageData[];
          setMessages(historyMessages);
          setIsStreaming(false);
          setHitlRequest(null);
          currentAssistantIdRef.current = null;
          lastCodeMessageIdRef.current = null;
          hasAddedCodeRef.current = false;
          // Set plan from last assistant message that has one
          const lastPlan = [...historyMessages].reverse().find(m => m.plan)?.plan;
          if (lastPlan) {
            setCurrentPlan(lastPlan);
          }
          break;
        }

        case 'newChat':
          setMessages([]);
          setCurrentPlan(null);
          setIsStreaming(false);
          setHitlRequest(null);
          setAttachedFiles([]);
          setIsUploading(false);
          currentAssistantIdRef.current = null;
          lastCodeMessageIdRef.current = null;
          hasAddedCodeRef.current = false;
          break;

        case 'filesAttached':
          setAttachedFiles(prev => [
            ...prev,
            ...(message.fileNames as string[]).map((n: string) => ({ name: n })),
          ]);
          setIsUploading(false);
          break;

        case 'fileUploadError':
          setIsUploading(false);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });

    return () => window.removeEventListener('message', handleMessage);
  }, [addMessage, updateMessage]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const handleSendMessage = (content: string) => {
    if (isStreaming) return;
    if (attachedFiles.length > 0) {
      const fileList = attachedFiles.map(f => f.name).join(', ');
      vscode.postMessage({
        type: 'sendMessage',
        content: `[Attached files: ${fileList}]\n${content}`,
      });
      setAttachedFiles([]);
    } else {
      vscode.postMessage({ type: 'sendMessage', content });
    }
  };

  const handleAttachFile = () => {
    setIsUploading(true);
    vscode.postMessage({ type: 'attachFile' });
  };

  const handleRemoveFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const sendHitlRespond = (action: 'approve' | 'reject' | 'modify' | 'retry' | 'skip' | 'feedback', payload?: { message?: string; modified_plan?: string; modified_code?: string }) => {
    vscode.postMessage({
      type: 'hitlRespond',
      action,
      ...(payload?.message !== undefined && { message: payload.message }),
      ...(payload?.modified_plan !== undefined && { modified_plan: payload.modified_plan }),
      ...(payload?.modified_code !== undefined && { modified_code: payload.modified_code }),
    });
    setHitlRequest(null);
    setHitlFeedback('');
  };

  const handleApprove = () => {
    sendHitlRespond('approve', hitlFeedback.trim() ? { message: hitlFeedback.trim() } : undefined);
  };

  const handleReject = () => {
    sendHitlRespond('reject', hitlFeedback.trim() ? { message: hitlFeedback.trim() } : undefined);
  };

  const handleModify = () => {
    const text = hitlFeedback.trim();
    if (!text) return;
    const isPlan = hitlRequest?.awaitingType === 'plan';
    sendHitlRespond('modify', isPlan ? { modified_plan: text } : { modified_code: text });
  };

  const handleRetry = () => sendHitlRespond('retry');
  const handleSkip = () => sendHitlRespond('skip');

  const handleFeedback = () => {
    if (!hitlFeedback.trim()) return;
    sendHitlRespond('feedback', { message: hitlFeedback.trim() });
  };

  // Render message based on type
  const renderMessage = (msg: ChatMessageData) => {
    if (msg.type === 'user') {
      return <ChatMessage key={msg.id} message={msg} />;
    }

    if (msg.type === 'code') {
      return (
        <div key={msg.id} className="code-message">
          <CodeBlock
            code={msg.code || msg.content}
            language="python"
            status={msg.codeStatus || 'idle'}
          />
          {msg.executionResult && (
            <ExecutionResult result={msg.executionResult} />
          )}
        </div>
      );
    }

    if (msg.type === 'assistant') {
      return (
        <div key={msg.id} className="assistant-message-container">
          <ChatMessage message={msg} />
          {msg.plan && <PlanView plan={msg.plan} />}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="app">
      <div className="messages-container">
        {messages.length === 0 && !isStreaming && (
          <div className="welcome">
            <h2>DSAgent</h2>
            <p>AI-powered data science assistant</p>
            <div className="suggestions">
              <button onClick={() => handleSendMessage('Load and analyze the data in my current file')}>
                Analyze current file
              </button>
              <button onClick={() => handleSendMessage('Show me the first 10 rows of the data')}>
                Preview data
              </button>
              <button onClick={() => handleSendMessage('Create a visualization of the data')}>
                Create visualization
              </button>
            </div>
          </div>
        )}

        {messages.map(renderMessage)}

        {/* Show current plan if not attached to a message */}
        {currentPlan && !messages.some(m => m.plan) && (
          <PlanView plan={currentPlan} />
        )}

        {hitlRequest && (
          <div className="hitl-request">
            <div className="hitl-header">
              <span className="hitl-icon">
                {hitlRequest.awaitingType === 'plan' && '$(checklist)'}
                {hitlRequest.awaitingType === 'code' && '$(code)'}
                {hitlRequest.awaitingType === 'answer' && '$(comment-discussion)'}
                {hitlRequest.awaitingType === 'error' && '$(warning)'}
              </span>
              <span className="hitl-title">
                {hitlRequest.awaitingType === 'plan' && 'Plan Approval Required'}
                {hitlRequest.awaitingType === 'code' && 'Code Approval Required'}
                {hitlRequest.awaitingType === 'answer' && 'Answer Approval Required'}
                {hitlRequest.awaitingType === 'error' && 'Error — Action Required'}
                {!hitlRequest.awaitingType && 'Approval Required'}
              </span>
            </div>

            {hitlRequest.message && (
              <p className="hitl-message">{hitlRequest.message}</p>
            )}

            {hitlRequest.awaitingType === 'plan' && hitlRequest.plan && (
              <div className="hitl-content">
                <PlanView plan={hitlRequest.plan} />
              </div>
            )}

            {hitlRequest.awaitingType === 'code' && hitlRequest.code && (
              <div className="hitl-content">
                <CodeBlock code={hitlRequest.code} language="python" status="idle" />
              </div>
            )}

            {hitlRequest.awaitingType === 'answer' && hitlRequest.answer && (
              <div className="hitl-content hitl-answer">
                <p>{hitlRequest.answer}</p>
              </div>
            )}

            {hitlRequest.awaitingType === 'error' && hitlRequest.error && (
              <div className="hitl-content hitl-error">
                <pre>{hitlRequest.error}</pre>
              </div>
            )}

            <textarea
              className="hitl-feedback"
              placeholder={
                hitlRequest.awaitingType === 'plan'
                  ? 'Edit plan above or add feedback...'
                  : hitlRequest.awaitingType === 'code'
                    ? 'Edit code above or add feedback...'
                    : 'Optional feedback or message...'
              }
              value={hitlFeedback}
              onChange={(e) => setHitlFeedback(e.target.value)}
              rows={hitlRequest.awaitingType === 'code' ? 6 : 3}
            />

            <div className="hitl-actions">
              <button className="approve" onClick={handleApprove}>
                Approve
              </button>
              <button className="reject" onClick={handleReject}>
                Reject
              </button>
              {(hitlRequest.awaitingType === 'plan' || hitlRequest.awaitingType === 'code') && (
                <button className="modify" onClick={handleModify} disabled={!hitlFeedback.trim()}>
                  Modify
                </button>
              )}
              <button className="hitl-retry" onClick={handleRetry}>
                Retry
              </button>
              <button className="hitl-skip" onClick={handleSkip}>
                Skip
              </button>
              <button className="hitl-feedback-btn" onClick={handleFeedback} disabled={!hitlFeedback.trim()}>
                Feedback
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        onSend={handleSendMessage}
        onAttach={handleAttachFile}
        onRemoveFile={handleRemoveFile}
        disabled={isStreaming}
        attachedFiles={attachedFiles}
        isUploading={isUploading}
      />

      {!serverAvailable && (
        <div className="connection-status">
          Server not available - run "dsagent serve"
        </div>
      )}
    </div>
  );
}

export default App;
