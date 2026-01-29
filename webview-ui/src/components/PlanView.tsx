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

interface PlanViewProps {
  plan: Plan;
}

function PlanView({ plan }: PlanViewProps) {
  const completedSteps = plan.steps.filter((s) => s.completed).length;
  const totalSteps = plan.total_steps || plan.steps.length;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return (
    <div className="plan-view">
      <div className="plan-header">
        <h3>
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" style={{ marginRight: 6, verticalAlign: 'middle' }}>
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
          </svg>
          Execution Plan
        </h3>
        <span className="plan-progress">
          {completedSteps}/{totalSteps} steps ({progressPercent}%)
        </span>
      </div>

      {/* Progress bar */}
      <div style={{
        height: 4,
        backgroundColor: 'var(--vscode-progressBar-background, #3c3c3c)',
        borderRadius: 2,
        marginBottom: 12,
        overflow: 'hidden'
      }}>
        <div style={{
          height: '100%',
          width: `${progressPercent}%`,
          backgroundColor: 'var(--vscode-progressBar-background, #0078d4)',
          transition: 'width 0.3s ease'
        }} />
      </div>

      <div className="plan-steps">
        {plan.steps.map((step) => (
          <div
            key={step.number}
            className={`plan-step ${step.completed ? 'completed' : ''}`}
          >
            <span className="plan-step-number">
              {step.completed ? (
                <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
              ) : (
                step.number
              )}
            </span>
            <span className="plan-step-description">{step.description}</span>
          </div>
        ))}
      </div>

      {completedSteps === totalSteps && totalSteps > 0 && (
        <div style={{
          marginTop: 12,
          padding: '8px 12px',
          backgroundColor: 'rgba(115, 201, 145, 0.1)',
          borderRadius: 4,
          fontSize: 12,
          color: 'var(--vscode-testing-iconPassed, #73c991)',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
          Plan completed
        </div>
      )}
    </div>
  );
}

export default PlanView;
