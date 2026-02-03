import * as vscode from 'vscode';
import { DSAgentClient } from '../api/client';
import type { HITLMode } from '../api/types';

const HITL_LABELS: Record<HITLMode, string> = {
    none: 'Off',
    plan_only: 'Plan',
    full: 'Full',
    plan_and_answer: 'Plan+Answer',
    on_error: 'On Error',
};

export class StatusBarManager implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private hitlBarItem: vscode.StatusBarItem;
    private client: DSAgentClient;
    private disposables: vscode.Disposable[] = [];

    constructor(client: DSAgentClient) {
        this.client = client;

        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'dsagent.connectServer';

        this.hitlBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            99
        );
        this.hitlBarItem.command = 'dsagent.setHitlMode';

        this.setupEventListeners();
        this.updateStatus('disconnected');
        this.statusBarItem.show();
    }

    private setupEventListeners(): void {
        this.client.on('serverAvailable', () => {
            this.updateStatus('connected');
        });

        this.client.on('connected', () => {
            this.updateStatus('session');
            this.updateHitlBar();
        });

        this.client.on('sessionCreated', () => {
            this.updateHitlBar();
        });

        this.client.on('sessionResumed', () => {
            this.updateHitlBar();
        });

        this.client.on('sessionUpdated', () => {
            this.updateHitlBar();
        });

        this.client.on('disconnected', () => {
            this.updateStatus('disconnected');
            this.hitlBarItem.hide();
        });

        this.client.on('reconnecting', (attempt: number) => {
            this.updateStatus('reconnecting', attempt);
        });

        this.client.on('reconnectFailed', () => {
            this.updateStatus('error');
        });

        this.client.on('thinking', () => {
            this.updateStatus('thinking');
        });

        this.client.on('complete', () => {
            this.updateStatus('session');
        });

        this.client.on('error', () => {
            this.updateStatus('error');
        });

        this.client.on('hitl_request', () => {
            this.hitlBarItem.text = '$(bell) HITL: Awaiting';
            this.hitlBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground'
            );
        });
    }

    private updateHitlBar(): void {
        const session = this.client.session;
        if (!session) {
            this.hitlBarItem.hide();
            return;
        }

        const mode = session.hitl_mode || 'none';
        const label = HITL_LABELS[mode] || mode;
        this.hitlBarItem.text = `$(shield) HITL: ${label}`;
        this.hitlBarItem.tooltip = `Human-in-the-Loop: ${label}\nClick to change`;
        this.hitlBarItem.backgroundColor = mode === 'none'
            ? undefined
            : new vscode.ThemeColor('statusBarItem.prominentBackground');
        this.hitlBarItem.show();
    }

    private getServerUrl(): string {
        return this.client.getBaseUrl();
    }

    private updateStatus(
        status: 'disconnected' | 'connected' | 'session' | 'reconnecting' | 'thinking' | 'error',
        attempt?: number
    ): void {
        const url = this.getServerUrl();

        switch (status) {
            case 'disconnected':
                this.statusBarItem.text = '$(debug-disconnect) DSAgent';
                this.statusBarItem.tooltip = `Disconnected from ${url}\nClick to connect`;
                this.statusBarItem.backgroundColor = undefined;
                this.statusBarItem.command = 'dsagent.connectServer';
                break;

            case 'connected':
                this.statusBarItem.text = '$(plug) DSAgent';
                this.statusBarItem.tooltip = `Connected to ${url}\nClick to start chat`;
                this.statusBarItem.backgroundColor = undefined;
                this.statusBarItem.command = 'dsagent.startChat';
                break;

            case 'session':
                const sessionId = this.client.session?.id;
                this.statusBarItem.text = '$(comment-discussion) DSAgent';
                this.statusBarItem.tooltip = `Server: ${url}\nSession: ${sessionId || 'active'}\nClick to open chat`;
                this.statusBarItem.backgroundColor = undefined;
                this.statusBarItem.command = 'dsagent.openChat';
                break;

            case 'reconnecting':
                this.statusBarItem.text = `$(sync~spin) DSAgent (${attempt})`;
                this.statusBarItem.tooltip = `Reconnecting to ${url}... Attempt ${attempt}`;
                this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                    'statusBarItem.warningBackground'
                );
                break;

            case 'thinking':
                this.statusBarItem.text = '$(loading~spin) DSAgent';
                this.statusBarItem.tooltip = `Agent is thinking...\nServer: ${url}`;
                this.statusBarItem.backgroundColor = undefined;
                break;

            case 'error':
                this.statusBarItem.text = '$(error) DSAgent';
                this.statusBarItem.tooltip = `Connection error — ${url}\nClick to retry`;
                this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                    'statusBarItem.errorBackground'
                );
                this.statusBarItem.command = 'dsagent.connectServer';
                break;
        }
    }

    dispose(): void {
        this.statusBarItem.dispose();
        this.hitlBarItem.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
