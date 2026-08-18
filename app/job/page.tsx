// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { redirect } from "next/navigation";

// The JD step now lives on /upload alongside the resume drop zone. Kept as a
// redirect so old links and bookmarks still land in the right place.
export default function JobPage() {
  redirect("/upload");
}
