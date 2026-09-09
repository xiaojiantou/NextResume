// Copyright (c) 2026 HowBe LLC. All rights reserved.
import { jsonCompletion } from "./ai";
import { reviewSemanticGrounding as review } from "./semanticGrounding";
export async function reviewSemanticGrounding(args: Omit<Parameters<typeof review>[0], "complete"> & { complete?: Parameters<typeof review>[0]["complete"] }) {
  return review({ ...args, complete: args.complete ?? (request => jsonCompletion({ ...request, model: args.model })) });
}
