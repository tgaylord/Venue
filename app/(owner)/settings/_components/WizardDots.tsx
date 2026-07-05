import Link from "next/link";

export default function WizardDots({ current, unlocked }: { current: number; unlocked: number }) {
  return (
    <div className="mb-7 flex gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const bar = (
          <div className={`h-1 flex-1 rounded-full ${n <= current ? "bg-owner-accent" : "bg-owner-border"}`} />
        );
        return n <= unlocked ? (
          <Link key={n} href={`/settings?step=${n}`} className="flex-1" aria-label={`Step ${n}`}>
            {bar}
          </Link>
        ) : (
          <div key={n} className="flex-1">{bar}</div>
        );
      })}
    </div>
  );
}
