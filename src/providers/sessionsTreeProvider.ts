import * as vscode from 'vscode';
import { DSAgentClient } from '../api/client';
import type { Session } from '../api/types';

export class SessionsTreeProvider implements vscode.TreeDataProvider<SessionItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SessionItem | undefined | null | void> =
        new vscode.EventEmitter<SessionItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SessionItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private sessions: Session[] = [];

    constructor(private readonly client: DSAgentClient) {
        this.client.on('sessionCreated', () => this.refresh());
        this.client.on('sessionDeleted', () => this.refresh());
        this.client.on('sessionResumed', () => this.refresh());
        this.client.on('sessionUpdated', () => this.refresh());
    }

    refresh(): void {
        this.loadSessions().then(() => {
            this._onDidChangeTreeData.fire();
        });
    }

    private async loadSessions(): Promise<void> {
        try {
            const result = await this.client.listSessions();
            // Handle both array and object with sessions property
            if (Array.isArray(result)) {
                this.sessions = result;
            } else if (result && typeof result === 'object' && 'sessions' in result) {
                this.sessions = (result as { sessions: Session[] }).sessions || [];
            } else {
                this.sessions = [];
            }
        } catch {
            this.sessions = [];
        }
    }

    getTreeItem(element: SessionItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SessionItem): Promise<SessionItem[]> {
        if (element) {
            return [];
        }

        await this.loadSessions();

        if (this.sessions.length === 0) {
            return [new SessionItem(
                'No sessions',
                'none',
                vscode.TreeItemCollapsibleState.None,
                undefined,
                true
            )];
        }

        return this.sessions.map(session => {
            const isActive = session.id === this.client.session?.id;
            return new SessionItem(
                this.formatSessionLabel(session),
                session.id,
                vscode.TreeItemCollapsibleState.None,
                session,
                false,
                isActive
            );
        });
    }

    private formatSessionLabel(session: Session): string {
        const date = new Date(session.created_at);
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });

        const label = session.name || session.task;
        if (label) {
            const truncated = label.length > 30 ? label.substring(0, 30) + '...' : label;
            return `${truncated} (${dateStr} ${timeStr})`;
        }

        return `Session ${session.id.substring(0, 8)} (${dateStr} ${timeStr})`;
    }

    async resumeSession(sessionId: string): Promise<void> {
        try {
            await this.client.resumeSession(sessionId);
            this.refresh();
            vscode.window.showInformationMessage('Session resumed');
        } catch (error) {
            vscode.window.showErrorMessage('Failed to resume session');
        }
    }

    async deleteSession(sessionId: string): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            'Are you sure you want to delete this session?',
            { modal: true },
            'Delete'
        );

        if (confirm === 'Delete') {
            try {
                await this.client.deleteSession(sessionId);
                this.refresh();
                vscode.window.showInformationMessage('Session deleted');
            } catch (error) {
                vscode.window.showErrorMessage('Failed to delete session');
            }
        }
    }
}

export class SessionItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly sessionId: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly session?: Session,
        public readonly isPlaceholder?: boolean,
        public readonly isActive?: boolean
    ) {
        super(label, collapsibleState);

        if (isPlaceholder) {
            this.contextValue = 'placeholder';
            this.iconPath = new vscode.ThemeIcon('info');
        } else {
            this.contextValue = 'session';
            this.tooltip = this.getTooltip();
            this.iconPath = this.getIcon();

            this.command = {
                command: 'dsagent.resumeSession',
                title: 'Resume Session',
                arguments: [sessionId],
            };
        }
    }

    private getIcon(): vscode.ThemeIcon {
        if (this.isActive) {
            return new vscode.ThemeIcon('comment-discussion', new vscode.ThemeColor('charts.green'));
        }

        switch (this.session?.status) {
            case 'active':
                return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.blue'));
            case 'completed':
                return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
            case 'error':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }

    private getTooltip(): string {
        if (!this.session) {
            return this.label;
        }

        const lines = [
            `ID: ${this.session.id}`,
        ];

        if (this.session.name) {
            lines.push(`Name: ${this.session.name}`);
        }

        lines.push(`Status: ${this.session.status}`);
        lines.push(`Created: ${new Date(this.session.created_at).toLocaleString()}`);

        if (this.session.message_count !== undefined) {
            lines.push(`Messages: ${this.session.message_count}`);
        }

        if (this.session.model) {
            lines.push(`Model: ${this.session.model}`);
        }

        if (this.isActive) {
            lines.unshift('** Active Session **');
        }

        return lines.join('\n');
    }
}
