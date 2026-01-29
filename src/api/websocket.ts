import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type { AgentEvent } from './types';

export interface WebSocketOptions {
    reconnect?: boolean;
    maxReconnectAttempts?: number;
    reconnectInterval?: number;
}

export class WebSocketHandler extends EventEmitter {
    private ws: WebSocket | null = null;
    private url: string;
    private options: Required<WebSocketOptions>;
    private reconnectAttempts = 0;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private intentionalClose = false;

    constructor(url: string, options: WebSocketOptions = {}) {
        super();
        this.url = url;
        this.options = {
            reconnect: options.reconnect ?? true,
            maxReconnectAttempts: options.maxReconnectAttempts ?? 5,
            reconnectInterval: options.reconnectInterval ?? 1000,
        };
    }

    get isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.intentionalClose = false;
            this.ws = new WebSocket(this.url);

            const timeout = setTimeout(() => {
                this.ws?.close();
                reject(new Error('Connection timeout'));
            }, 10000);

            this.ws.onopen = () => {
                clearTimeout(timeout);
                this.reconnectAttempts = 0;
                this.emit('open');
                resolve();
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(event);
            };

            this.ws.onerror = (error) => {
                clearTimeout(timeout);
                this.emit('error', error);
            };

            this.ws.onclose = (event) => {
                clearTimeout(timeout);
                this.emit('close', event.code, event.reason);

                if (!this.intentionalClose && this.options.reconnect) {
                    this.attemptReconnect();
                }
            };
        });
    }

    disconnect(): void {
        this.intentionalClose = true;
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    send(data: unknown): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not connected');
        }
        this.ws.send(JSON.stringify(data));
    }

    private handleMessage(event: WebSocket.MessageEvent): void {
        try {
            const data = JSON.parse(event.data.toString()) as AgentEvent;
            this.emit('message', data);
            this.emit(data.type, data);
        } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
            this.emit('parseError', error);
        }
    }

    private attemptReconnect(): void {
        if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
            this.emit('reconnectFailed');
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(
            this.options.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1),
            30000
        );

        this.emit('reconnecting', this.reconnectAttempts, delay);

        this.reconnectTimeout = setTimeout(() => {
            this.connect().catch(() => {
                // Reconnect attempt failed, will trigger another attempt
            });
        }, delay);
    }
}
