# DSAgent — AI Data Science Assistant for VS Code

AI-powered data science agent that integrates directly into VS Code. Analyze data, create visualizations, and build models using natural language.

## Features

- **Dual Chat Interface** — Use the `@dsagent` native chat participant or the custom chat panel
- **Session Management** — Create, resume, and manage analysis sessions
- **Live Artifacts** — View generated plots, CSVs, and other outputs in the sidebar
- **Notebook Sync** — Session notebooks sync with the DSAgent kernel
- **Variables Explorer** — Inspect DataFrames, variables, and imports in real time
- **File Attachments** — Upload CSV, Excel, JSON, Parquet, and other data files
- **Human-in-the-Loop** — Approve, reject, or modify agent actions before execution

## Requirements

- A running DSAgent server (`dsagent serve`)
- VS Code 1.85.0 or later

## Getting Started

1. Start the server:
   ```bash
   dsagent serve
   ```

2. Open VS Code — the extension auto-connects to `http://localhost:8000`

3. Open the chat: `Cmd+Shift+P` → **DSAgent: Open Chat**

## Remote Server

To connect to a remote DSAgent server:

1. `Cmd+Shift+P` → **DSAgent: Configure Server Connection**
2. Enter the server URL (e.g. `https://remote-host:8000`)
3. Enter the API key (if the server has `DSAGENT_API_KEY` set)

Or configure in settings:

```json
{
  "dsagent.serverUrl": "https://remote-host:8000",
  "dsagent.apiKey": "your-api-key"
}
```

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `dsagent.serverUrl` | `http://localhost:8000` | DSAgent server URL |
| `dsagent.apiKey` | | API key for remote server authentication |
| `dsagent.autoConnect` | `true` | Auto-connect on startup |
| `dsagent.model` | `gpt-5.1` | Default LLM model |
| `dsagent.hitlMode` | `none` | Human-in-the-Loop mode |

### Available Models

- `gpt-5.1` (default)
- `gpt-5.2`
- `gpt-5.2-codex`
- `claude-sonnet-4-20250514`
- `claude-opus-4-20250514`
- `gemini-3-pro-preview`
- `gemini-3-flash-preview`
- `groq/openai/gpt-oss-120b`
- `groq/qwen/qwen3-32b`
- `groq/moonshotai/kimi-k2-instruct-0905`
- `openrouter/qwen/qwen3-coder-next`
- `openrouter/minimax/minimax-m2.1`

### HITL Modes

- `none` — Agent runs autonomously
- `plan_only` — Approve before executing a plan
- `full` — Approve every plan and code execution
- `plan_and_answer` — Approve plans and final answers
- `on_error` — Approve only when errors occur

## License

MIT
