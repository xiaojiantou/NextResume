// Copyright (c) 2026 HowBe LLC. All rights reserved.

/**
 * The upload was understood and is simply not something we can process — a
 * multi-file .tex, a renamed archive, a corrupt document.
 *
 * Distinct from a genuine fault so that these do not land in the 5xx rate the
 * way an outage does. Retrying the same file will always fail; the user has to
 * supply a different one, and the message says which.
 */
export class UnprocessableFileError extends Error {
  readonly status = 422;

  constructor(message: string) {
    super(message);
    this.name = "UnprocessableFileError";
  }
}
