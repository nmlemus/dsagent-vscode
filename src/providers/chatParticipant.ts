import * as vscode from 'vscode';
import { DSAgentClient } from '../api/client';
import type { AgentEvent } from '../api/types';

const PARTICIPANT_ID = 'dsagent.chat';

export class DSAgentChatParticipant {
    private participant: vscode.ChatParticipant;
    private currentStream: vscode.ChatResponseStream | null = null;
    private pendingHITL: { resolve: (approved: boolean) => void } | null = null;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly client: DSAgentClient
    ) {
        // Create the chat participant
        this.participant = vscode.chat.createChatParticipant(
            PARTICIPANT_ID,
            this.handleRequest.bind(this)
        );

        this.participant.iconPath = vscode.Uri.joinPath(
            context.extensionUri,
            'resources',
            'icons',
            'dsagent.png'
        );

        // Setup client event listeners
        this.setupClientListeners();

        // Register HITL commands
        this.registerCommands();
    }

    private setupClientListeners(): void {
        this.client.on('thinking', (event: AgentEvent) => {
            if (this.currentStream && event.content) {
                this.currentStream.progress(event.content);
            }
        });

        this.client.on('llm_response', (event: AgentEvent) => {
            if (this.currentStream && event.content) {
                this.currentStream.markdown(event.content);
            }
        });

        this.client.on('plan', (event: AgentEvent) => {
            if (this.currentStream && event.plan) {
                this.currentStream.markdown('\n\n### Plan\n');
                event.plan.steps.forEach((step, index) => {
                    const icon = step.completed ? '✅' : '⏳';
                    this.currentStream!.markdown(`${icon} **Step ${index + 1}:** ${step.description}\n`);
                });
                this.currentStream.markdown('\n');
            }
        });

        this.client.on('code_executing', (event: AgentEvent) => {
            if (this.currentStream && event.code) {
                this.currentStream.markdown('\n```python\n' + event.code + '\n```\n');
                this.currentStream.progress('Executing code...');
            }
        });

        this.client.on('code_result', (event: AgentEvent) => {
            if (this.currentStream && event.result) {
                if (event.result.output) {
                    this.currentStream.markdown('\n**Output:**\n```\n' + event.result.output + '\n```\n');
                }
                if (event.result.error) {
                    this.currentStream.markdown('\n**Error:**\n```\n' + event.result.error + '\n```\n');
                }
                // Handle images
                if (event.result.images && event.result.images.length > 0) {
                    for (const image of event.result.images) {
                        // Images in chat need to be served from a URL or use data URI
                        const dataUri = `data:${image.mime || 'image/png'};base64,${image.data}`;
                        this.currentStream.markdown(`\n![Visualization](${dataUri})\n`);
                    }
                }
            }
        });

        this.client.on('hitl_request', (event: AgentEvent) => {
            if (this.currentStream) {
                this.currentStream.markdown('\n\n---\n**Action Required:** ' + (event.message || 'Approve this action?') + '\n');
                this.currentStream.button({
                    command: 'dsagent.approveAction',
                    title: '✅ Approve'
                });
                this.currentStream.button({
                    command: 'dsagent.rejectAction',
                    title: '❌ Reject'
                });
            }
        });

        this.client.on('error', (event: AgentEvent) => {
            if (this.currentStream && event.message) {
                this.currentStream.markdown('\n\n❌ **Error:** ' + event.message + '\n');
            }
        });
    }

    private registerCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('dsagent.approveAction', () => {
                this.client.approveAction();
                if (this.pendingHITL) {
                    this.pendingHITL.resolve(true);
                    this.pendingHITL = null;
                }
            })
        );

        this.context.subscriptions.push(
            vscode.commands.registerCommand('dsagent.rejectAction', () => {
                this.client.rejectAction();
                if (this.pendingHITL) {
                    this.pendingHITL.resolve(false);
                    this.pendingHITL = null;
                }
            })
        );
    }

    private async handleRequest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        this.currentStream = stream;

        try {
            // Ensure we have a session
            if (!this.client.session) {
                stream.progress('Creating session...');
                try {
                    await this.client.connect();
                    await this.client.createSession();
                } catch (error) {
                    stream.markdown('❌ **Failed to connect to DSAgent server.** Make sure `dsagent serve` is running.\n');
                    return { metadata: { error: 'connection_failed' } };
                }
            }

            // Handle slash commands
            let prompt = request.prompt;
            if (request.command) {
                switch (request.command) {
                    case 'analyze':
                        prompt = `Analyze the following: ${request.prompt}`;
                        break;
                    case 'visualize':
                        prompt = `Create a visualization for: ${request.prompt}`;
                        break;
                    case 'model':
                        prompt = `Build a machine learning model for: ${request.prompt}`;
                        break;
                }
            }

            // Handle file references from the chat context
            if (request.references) {
                for (const ref of request.references) {
                    const value = ref.value as any;
                    if (value && value.uri) {
                        const uri = value.uri as vscode.Uri;
                        const fileName = uri.path.split('/').pop() || 'file';
                        try {
                            const fileData = await vscode.workspace.fs.readFile(uri);
                            await this.client.uploadFile(fileName, fileData);
                            stream.markdown(`📎 Attached: ${fileName}\n\n`);
                        } catch (error) {
                            stream.markdown(`⚠️ Could not attach ${fileName}\n\n`);
                        }
                    }
                }
            }

            // Send message to DSAgent
            stream.progress('Thinking...');

            // Create a promise that resolves when the response is complete
            await new Promise<void>((resolve, reject) => {
                const onComplete = () => {
                    this.client.off('complete', onComplete);
                    this.client.off('error', onError);
                    resolve();
                };
                const onError = (event: AgentEvent) => {
                    this.client.off('complete', onComplete);
                    this.client.off('error', onError);
                    // Don't reject, just resolve - error is already shown in stream
                    resolve();
                };

                this.client.on('complete', onComplete);
                this.client.on('error', onError);

                // Handle cancellation
                token.onCancellationRequested(() => {
                    this.client.off('complete', onComplete);
                    this.client.off('error', onError);
                    resolve();
                });

                // Send the message
                this.client.sendMessage(prompt).catch((error) => {
                    stream.markdown(`\n\n❌ **Error:** ${error.message}\n`);
                    resolve();
                });
            });

            return { metadata: { command: request.command } };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            stream.markdown(`\n\n❌ **Error:** ${errorMsg}\n`);
            return { metadata: { error: errorMsg } };
        } finally {
            this.currentStream = null;
        }
    }

    dispose(): void {
        this.participant.dispose();
    }
}
