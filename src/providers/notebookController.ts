import * as vscode from 'vscode';
import { DSAgentClient } from '../api/client';

export class DSAgentNotebookController {
    readonly controllerId = 'dsagent-notebook-controller';
    readonly notebookType = 'jupyter-notebook';
    readonly label = 'DSAgent Kernel';
    readonly supportedLanguages = ['python'];

    private readonly controller: vscode.NotebookController;
    private executionOrder = 0;

    constructor(private readonly client: DSAgentClient) {
        this.controller = vscode.notebooks.createNotebookController(
            this.controllerId,
            this.notebookType,
            this.label
        );

        this.controller.supportedLanguages = this.supportedLanguages;
        this.controller.supportsExecutionOrder = true;
        this.controller.executeHandler = this.executeHandler.bind(this);
    }

    private async executeHandler(
        cells: vscode.NotebookCell[],
        _notebook: vscode.NotebookDocument,
        _controller: vscode.NotebookController
    ): Promise<void> {
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

            if (result.success) {
                if (result.output) {
                    outputs.push(new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text(result.output)
                    ]));
                }

                if (result.images && result.images.length > 0) {
                    for (const image of result.images) {
                        outputs.push(new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(
                                `<img src="data:${image.mime};base64,${image.data}" />`,
                                'text/html'
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
