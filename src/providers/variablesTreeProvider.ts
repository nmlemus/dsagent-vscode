import * as vscode from 'vscode';
import { DSAgentClient } from '../api/client';
import type { KernelState } from '../api/types';

export class VariablesTreeProvider implements vscode.TreeDataProvider<VariableItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<VariableItem | undefined | null | void> =
        new vscode.EventEmitter<VariableItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<VariableItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private kernelState: KernelState | null = null;
    private refreshTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly client: DSAgentClient) {
        // Debounced refresh after code execution — wait for the kernel to
        // finish processing before querying its state.
        this.client.on('code_result', () => this.debouncedRefresh());
        this.client.on('disconnected', () => {
            this.kernelState = null;
            this._onDidChangeTreeData.fire();
        });
    }

    private debouncedRefresh(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            this.refresh();
        }, 1500);
    }

    refresh(): void {
        this.loadKernelState().then(() => {
            this._onDidChangeTreeData.fire();
        });
    }

    private async loadKernelState(): Promise<void> {
        this.kernelState = await this.client.getKernelState();
    }

    getTreeItem(element: VariableItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: VariableItem): Promise<VariableItem[]> {
        if (!this.client.session) {
            return [new VariableItem(
                'No active session',
                '',
                'info',
                vscode.TreeItemCollapsibleState.None,
                true
            )];
        }

        if (!this.kernelState) {
            await this.loadKernelState();
        }

        if (!this.kernelState) {
            return [new VariableItem(
                'Kernel not ready',
                '',
                'info',
                vscode.TreeItemCollapsibleState.None,
                true
            )];
        }

        if (element) {
            return this.getChildrenForElement(element);
        }

        const items: VariableItem[] = [];

        // DataFrames section
        const dfNames = Object.keys(this.kernelState.dataframes);
        if (dfNames.length > 0) {
            items.push(new VariableItem(
                'DataFrames',
                '',
                'category',
                vscode.TreeItemCollapsibleState.Expanded,
                false,
                'dataframes'
            ));
        }

        // Variables section
        const varNames = Object.keys(this.kernelState.variables);
        if (varNames.length > 0) {
            items.push(new VariableItem(
                'Variables',
                '',
                'category',
                vscode.TreeItemCollapsibleState.Expanded,
                false,
                'variables'
            ));
        }

        // Imports section
        if (this.kernelState.imports.length > 0) {
            items.push(new VariableItem(
                'Imports',
                '',
                'category',
                vscode.TreeItemCollapsibleState.Collapsed,
                false,
                'imports'
            ));
        }

        if (items.length === 0) {
            return [new VariableItem(
                'No variables defined',
                '',
                'info',
                vscode.TreeItemCollapsibleState.None,
                true
            )];
        }

        return items;
    }

    private getChildrenForElement(element: VariableItem): VariableItem[] {
        if (!this.kernelState) {
            return [];
        }

        switch (element.category) {
            case 'dataframes':
                return Object.entries(this.kernelState.dataframes).map(([name, df]) => {
                    const shape = `${df.shape[0]} rows × ${df.shape[1]} cols`;
                    return new VariableItem(
                        name,
                        shape,
                        'dataframe',
                        vscode.TreeItemCollapsibleState.Collapsed,
                        false,
                        'dataframe-columns',
                        { name, columns: df.columns, dtypes: df.dtypes }
                    );
                });

            case 'dataframe-columns':
                if (element.data) {
                    return element.data.columns.map((col: string) => {
                        const dtype = element.data.dtypes[col] || 'unknown';
                        return new VariableItem(
                            col,
                            dtype,
                            'column',
                            vscode.TreeItemCollapsibleState.None
                        );
                    });
                }
                return [];

            case 'variables':
                return Object.entries(this.kernelState.variables).map(([name, variable]) => {
                    const description = variable.shape
                        ? `${variable.type} ${variable.shape}`
                        : variable.type;
                    return new VariableItem(
                        name,
                        description,
                        'variable',
                        vscode.TreeItemCollapsibleState.None
                    );
                });

            case 'imports':
                return this.kernelState.imports.map(imp => new VariableItem(
                    imp,
                    '',
                    'import',
                    vscode.TreeItemCollapsibleState.None
                ));

            default:
                return [];
        }
    }
}

export class VariableItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly itemType: 'category' | 'dataframe' | 'column' | 'variable' | 'import' | 'info',
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly isPlaceholder?: boolean,
        public readonly category?: string,
        public readonly data?: Record<string, unknown>
    ) {
        super(label, collapsibleState);

        this.contextValue = itemType;
        this.iconPath = this.getIcon();

        if (description) {
            this.description = description;
        }

        // Click to preview dataframes or inspect variables
        if (itemType === 'dataframe') {
            this.command = {
                command: 'dsagent.previewDataFrame',
                title: 'Preview DataFrame',
                arguments: [label],
            };
        } else if (itemType === 'variable') {
            this.command = {
                command: 'dsagent.inspectVariable',
                title: 'Inspect Variable',
                arguments: [label],
            };
        }
    }

    private getIcon(): vscode.ThemeIcon {
        switch (this.itemType) {
            case 'category':
                return new vscode.ThemeIcon('symbol-folder');
            case 'dataframe':
                return new vscode.ThemeIcon('table', new vscode.ThemeColor('charts.blue'));
            case 'column':
                return new vscode.ThemeIcon('symbol-field');
            case 'variable':
                return new vscode.ThemeIcon('symbol-variable');
            case 'import':
                return new vscode.ThemeIcon('package');
            case 'info':
                return new vscode.ThemeIcon('info');
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }
}
