import type { ChatRef, SenderRef } from '../domain/households.ts';

// What the rest of the app sees of a chat platform. WhatsApp (Baileys) is the only real
// channel; the fake one drives tests, evals and the dev REPL.

export type { ChatRef, SenderRef };

export interface InboundMessage {
  chat: ChatRef;
  externalId: string; // the platform's message id, unique within the chat
  sender: SenderRef;
  text: string;
  mentionsBot: boolean;
  quotedExternalId?: string | undefined; // the message this one replies to, if any
  hasMedia: boolean; // a photo or other attachment came with it
  sentAt: Date;
}

export interface OutboundMessage {
  chat: ChatRef;
  text: string;
  quoteExternalId?: string | undefined; // group replies quote the trigger
}

// The bot was added to a chat or removed from it.
export interface ChatEvent {
  type: 'added' | 'removed';
  chat: ChatRef;
}

export interface ChatHandlers {
  onMessage(message: InboundMessage): Promise<void>;
  onChatEvent(event: ChatEvent): Promise<void>;
}

export interface ChatAdapter {
  readonly channel: string;
  start(handlers: ChatHandlers): Promise<void>;
  stop(): Promise<void>;
  // Resolves with the platform's id for the sent message.
  send(message: OutboundMessage): Promise<{ externalId: string }>;
  setTyping(chat: ChatRef, typing: boolean): Promise<void>;
}
