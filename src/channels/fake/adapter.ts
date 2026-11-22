import type {
  ChatAdapter,
  ChatEvent,
  ChatHandlers,
  InboundMessage,
  OutboundMessage,
} from '../types.ts';

export const FAKE_CHANNEL = 'fake';

export interface SentMessage extends OutboundMessage {
  externalId: string;
}

// An in-memory chat platform: tests and the REPL deliver messages to the app with `deliver`
// and read what it sent from `sent`.
export class FakeAdapter implements ChatAdapter {
  readonly channel: string;
  readonly sent: SentMessage[] = [];
  private handlers: ChatHandlers | undefined;
  private nextId = 1;

  constructor(channel: string = FAKE_CHANNEL) {
    this.channel = channel;
  }

  start(handlers: ChatHandlers): Promise<void> {
    this.handlers = handlers;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.handlers = undefined;
    return Promise.resolve();
  }

  send(message: OutboundMessage): Promise<{ externalId: string }> {
    const externalId = this.newId('out');
    this.sent.push({ ...message, externalId });
    return Promise.resolve({ externalId });
  }

  setTyping(): Promise<void> {
    return Promise.resolve();
  }

  // Delivers a message as if a person sent it; fields left out get defaults.
  async deliver(
    message: Omit<InboundMessage, 'externalId' | 'mentionsBot' | 'hasMedia' | 'sentAt'> &
      Partial<InboundMessage>,
  ): Promise<InboundMessage> {
    const inbound: InboundMessage = {
      externalId: this.newId('in'),
      mentionsBot: true,
      hasMedia: false,
      sentAt: new Date(),
      ...message,
    };
    await this.requireHandlers().onMessage(inbound);
    return inbound;
  }

  async emit(event: ChatEvent): Promise<void> {
    await this.requireHandlers().onChatEvent(event);
  }

  lastSent(): SentMessage | undefined {
    return this.sent.at(-1);
  }

  newId(prefix: 'in' | 'out'): string {
    return `${prefix}-${String(this.nextId++)}`;
  }

  private requireHandlers(): ChatHandlers {
    if (this.handlers === undefined) throw new Error('FakeAdapter: call start() first');
    return this.handlers;
  }
}
