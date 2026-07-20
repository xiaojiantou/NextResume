import { redirect } from "next/navigation";

export default function SignInRedirect() {
  redirect("https://clerk.howbetech.com/sign-in");
}
