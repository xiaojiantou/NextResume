// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { redirect } from "next/navigation";

export default function SignInRedirect() {
  redirect("https://clerk.howbetech.com/sign-in");
}
