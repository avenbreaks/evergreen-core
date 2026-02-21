import { redirect } from "next/navigation";

export default function RegisterOnboardingRedirectPage() {
  redirect("/login?mode=signup&next=%2Fonboarding%2Fens");
}
