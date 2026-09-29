// Copyright (c) 2026 HowBe LLC. All rights reserved.

export class IncompleteCompletionError extends Error {
  constructor() {
    super("The analysis service returned an incomplete answer. Please try again.");
    this.name = "IncompleteCompletionError";
  }
}

// Retry once with room for both reasoning and the final answer. Never retry
// authentication, quota, network errors, or other provider failures here.
export async function withCompletionRetry<T>(
  maxTokens: number,
  complete: (budget: number) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    try {
      return await complete(maxTokens * (attempt + 1));
    } catch (error) {
      if (!(error instanceof IncompleteCompletionError) || attempt === 1) throw error;
    }
  }
  throw new IncompleteCompletionError();
}
