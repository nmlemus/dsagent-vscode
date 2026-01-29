# DSAgent for VS Code

AI-powered data science assistant for Visual Studio Code. Analyze data, create visualizations, and build machine learning models using natural language.

## Features

- **Chat Interface**: Natural language conversations with an AI data science agent
- **Code Execution**: Execute Python code with a persistent Jupyter kernel
- **Session Management**: Save and resume analysis sessions
- **Variable Inspector**: View DataFrames and variables in real-time
- **Context Actions**: Right-click on CSV/data files to analyze them

## Requirements

- VS Code 1.85.0 or higher
- Python 3.9+
- DSAgent server running (`pip install dsagent && dsagent serve`)

## Quick Start

1. Install the extension
2. Start the DSAgent server:
   ```bash
   pip install dsagent
   dsagent serve
   ```
3. Open the DSAgent panel in VS Code sidebar
4. Start chatting!

## Extension Settings

- `dsagent.serverUrl`: DSAgent server URL (default: `http://localhost:8000`)
- `dsagent.autoConnect`: Auto-connect on startup (default: `true`)
- `dsagent.model`: Default LLM model (default: `gpt-4o`)

## Development

See [SETUP.md](./SETUP.md) for detailed development instructions.

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run watch

# Package extension
npm run package
```

## License

MIT
