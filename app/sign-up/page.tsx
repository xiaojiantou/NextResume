import { redirect } from "next/navigation";

export default function SignUpRedirect() {
  redirect("https://clerk.howbetech.com/sign-up");
}
