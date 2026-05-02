export type ChannelId = 'whatsapp' | 'telegram' | 'slack';

export type ChannelStatus =
  | 'disconnected'
  | 'connecting'
  | 'qr_ready'
  | 'connected'
  | 'error';

export interface InboundMessage {
  channelId: ChannelId;
  from: string;
  fromName: string;
  text: string;
  timestamp: number;
  conversationId: string;
  messageId: string;
  replyToMessageId?: string;
}

export interface ChannelAdapter {
  readonly id: ChannelId;
  status: ChannelStatus;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(conversationId: string, text: string): Promise<string | null>;
  onMessage(handler: (msg: InboundMessage) => void): void;
  onStatusChange(handler: (status: ChannelStatus, detail?: string) => void): void;
  onQr?(handler: (qrDataUrl: string) => void): void;
  getIdentity(): string | null;
}
