export interface Session {
    id: string;
    name?: string;
    created_at: string;
    updated_at: string;
    status: 'active' | 'completed' | 'error';
    message_count?: number;
    kernel_variables?: number;
    workspace_path?: string | null;
    task?: string;
    model?: string;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    metadata?: {
        code?: string;
        has_plan?: boolean;
        has_answer?: boolean;
    };
}

export interface PlanStep {
    number: number;
    description: string;
    completed: boolean;
}

export interface PlanState {
    steps: PlanStep[];
    raw_text: string;
    progress: string;
    total_steps: number;
}

export interface ExecutionResult {
    success: boolean;
    output: string;
    error?: string;
    images?: Array<{
        mime: string;
        data: string;
    }>;
}

export interface AgentEvent {
    type: 'thinking' | 'plan' | 'code_executing' | 'code_result' | 'answer' | 'error' | 'complete' | 'hitl_request' | 'connected';
    content?: string;
    code?: string;
    plan?: PlanState;
    result?: ExecutionResult;
    message?: string;
    session_id?: string;
}

export interface KernelState {
    variables: Record<string, {
        type: string;
        value?: string;
        shape?: string;
    }>;
    dataframes: Record<string, {
        shape: [number, number];
        columns: string[];
        dtypes: Record<string, string>;
    }>;
    imports: string[];
}

export interface HITLRequest {
    type: 'plan' | 'code' | 'answer';
    plan?: PlanState;
    code?: string;
    message?: string;
}

export interface Artifact {
    name: string;
    size: number;
    modified: string;
    type: string;
    url: string;
}

export interface Turn {
    round: number;
    timestamp: string;
    user_message: string | null;
    content: string;
    code: string | null;
    execution_result: ExecutionResult | null;
    plan: PlanState | null;
    has_answer: boolean;
    answer: string | null;
    thinking: string | null;
    is_complete: boolean;
}
