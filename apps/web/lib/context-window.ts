// How full the context window is.
//
// A chat that answers from retrieved sources spends most of its window on the
// passages, not on the words either side. Every turn carries its cited
// passages back into the prompt, so a long conversation about long
// transcripts fills up far faster than the visible text suggests. That is the
// thing worth warning about before an answer starts losing the beginning of
// the conversation.
//
// ponytail: characters over four is a rough token estimate, good to about
// 10 per cent for English prose. Swap it for the model's own tokeniser when
// the worker exists and the real count is available.

import { findSource } from "./fixtures";
import type { ChatAnswer, Conversation } from "./types";

/** The window the brief's inference path gives us. */
export const CONTEXT_WINDOW_TOKENS = 200_000;

/** What the system prompt and the tool definitions cost before anything else. */
const OVERHEAD_TOKENS = 2_000;

const estimate = (text: string) => Math.ceil(text.length / 4);

/** One turn: the question, the answer, and every passage it cited. */
export function tokensForAnswer(answer: ChatAnswer): number {
  const passages = answer.citations.reduce((total, citation) => {
    const chunk = findSource(citation.sourceId)?.chunks.find(
      (c) => c.id === citation.chunkId
    );
    return total + (chunk ? estimate(chunk.text) : 0);
  }, 0);
  return estimate(answer.question) + estimate(answer.answer) + passages;
}

export function tokensUsed(
  answers: ChatAnswer[],
  carriedTokens = 0
): number {
  return (
    OVERHEAD_TOKENS +
    carriedTokens +
    answers.reduce((total, answer) => total + tokensForAnswer(answer), 0)
  );
}

export function conversationTokens(conversation: Conversation): number {
  return tokensUsed(conversation.answers, conversation.carriedTokens);
}

export type ContextLevel = "ample" | "filling" | "tight";

/** Where the window stands, and whether it is worth saying anything. */
export function contextUsage(tokens: number) {
  const percent = Math.min(100, (tokens / CONTEXT_WINDOW_TOKENS) * 100);
  // Below 70 there is nothing useful to say, so the meter stays quiet.
  // Past 90 a new chat is the answer, not a smaller question.
  const level: ContextLevel =
    percent >= 90 ? "tight" : percent >= 70 ? "filling" : "ample";
  return { tokens, percent, level };
}
