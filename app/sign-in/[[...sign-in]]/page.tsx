import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return (
    <main className="min-h-screen bg-owner-bg flex items-center justify-center p-8">
      <SignIn />
    </main>
  );
}
