import * as vscode from 'vscode';
import { DSAgentClient } from '../api/client';
import type { NotebookSyncService } from '../services/notebookSync';

export class DSAgentNotebookController {
    readonly controllerId = 'dsagent-notebook-controller';
    readonly notebookType = 'jupyter-notebook';
    readonly label = 'DSAgent Kernel';
    readonly supportedLanguages = ['python'];

    private readonly controller: vscode.NotebookController;
    private executionOrder = 0;
    private notebookSync?: NotebookSyncService;

    constructor(private readonly client: DSAgentClient) {
        this.controller = vscode.notebooks.createNotebookController(
            this.controllerId,
            this.notebookType,
            this.label
        );

        this.controller.supportedLanguages = this.supportedLanguages;
        this.controller.supportsExecutionOrder = true;
        this.controller.description = 'Execute cells in the DSAgent session kernel';
        this.controller.executeHandler = this.executeHandler.bind(this);
    }

    /**
     * Set the NotebookSyncService to validate which notebooks can be executed.
     */
    setNotebookSync(sync: NotebookSyncService): void {
        this.notebookSync = sync;
    }

    private async executeHandler(
        cells: vscode.NotebookCell[],
        notebook: vscode.NotebookDocument,
        _controller: vscode.NotebookController
    ): Promise<void> {
        // Validate: only execute if this is the session notebook
        if (this.notebookSync && !this.notebookSync.isSessionNotebook(notebook)) {
            vscode.window.showWarningMessage(
                'DSAgent Kernel can only execute cells in the active session notebook. ' +
                'Open the session notebook via "DSAgent: Open Session Notebook" command.'
            );
            return;
        }

        // Validate: need an active session
        if (!this.client.session) {
            vscode.window.showWarningMessage(
                'No active DSAgent session. Start a chat first to create a session.'
            );
            return;
        }

        for (const cell of cells) {
            await this.executeCell(cell);
        }
    }

    private async executeCell(cell: vscode.NotebookCell): Promise<void> {
        const execution = this.controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this.executionOrder;
        execution.start(Date.now());

        try {
            const code = cell.document.getText();
            const result = await this.client.executeCode(code);

            const outputs: vscode.NotebookCellOutput[] = [];

            // API returns stdout/stderr, not output
            const stdout = (result as { stdout?: string }).stdout || result.output || '';
            const stderr = (result as { stderr?: string }).stderr || '';

            if (result.success !== false) {
                if (stdout) {
                    outputs.push(new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text(stdout)
                    ]));
                }
                if (stderr) {
                    outputs.push(new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.stderr(stderr)
                    ]));
                }

                if (result.images && result.images.length > 0) {
                    for (const image of result.images) {
                        const mime = image.mime || 'image/png';
                        outputs.push(new vscode.NotebookCellOutput([
                            new vscode.NotebookCellOutputItem(
                                Buffer.from(image.data, 'base64'),
                                mime
                            )
                        ]));
                    }
                }

                execution.replaceOutput(outputs);
                execution.end(true, Date.now());
            } else {
                execution.replaceOutput([
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.error({
                            name: 'ExecutionError',
                            message: result.error || 'Unknown error',
                        })
                    ])
                ]);
                execution.end(false, Date.now());
            }
        } catch (error) {
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error({
                        name: 'Error',
                        message: error instanceof Error ? error.message : 'Execution failed',
                    })
                ])
            ]);
            execution.end(false, Date.now());
        }
    }

    dispose(): void {
        this.controller.dispose();
    }
}
