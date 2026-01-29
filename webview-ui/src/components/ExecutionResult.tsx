interface ExecutionResultData {
  success: boolean;
  stdout?: string;
  stderr?: string;
  output?: string;
  error?: string;
  images?: Array<{ format?: string; mime?: string; data: string }>;
}

interface ExecutionResultProps {
  result: ExecutionResultData;
}

function ExecutionResult({ result }: ExecutionResultProps) {
  const stdout = result.stdout || result.output || '';
  const hasOutput = stdout || result.stderr || result.error;
  const hasImages = result.images && result.images.length > 0;

  if (!hasOutput && !hasImages) return null;

  return (
    <div className="execution-result-container">
      {/* Output */}
      {hasOutput && (
        <div className={`execution-output ${result.success ? 'success' : 'error'}`}>
          <div className="execution-header">
            {result.success ? (
              <>
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" className="icon-success">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
                <span>Output</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" className="icon-error">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
                <span>Error</span>
              </>
            )}
          </div>
          <div className="execution-content">
            {stdout && (
              <pre className="output-stdout">{stdout}</pre>
            )}
            {result.stderr && (
              <pre className="output-stderr">{result.stderr}</pre>
            )}
            {result.error && (
              <pre className="output-error">{result.error}</pre>
            )}
          </div>
        </div>
      )}

      {/* Images */}
      {hasImages && (
        <div className="execution-images">
          {result.images!.map((img, i) => {
            const mimeType = img.mime || `image/${img.format || 'png'}`;
            return (
              <div key={i} className="execution-image">
                <img
                  src={`data:${mimeType};base64,${img.data}`}
                  alt={`Output ${i + 1}`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ExecutionResult;
