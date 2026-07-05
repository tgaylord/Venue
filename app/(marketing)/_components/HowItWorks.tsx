const STEPS = [
  {
    n: "01",
    title: "Renter requests",
    body: "From your public booking link. You approve or decline in one tap.",
  },
  {
    n: "02",
    title: "Contract signed",
    body: "A Georgia venue agreement is generated for the booking; you send it for signature.",
  },
  {
    n: "03",
    title: "Photo walkthrough",
    body: "Document the space before and after — locked the moment you finish.",
  },
  {
    n: "04",
    title: "Close-out",
    body: "A locked photo record and the deposit's status, on file for every event.",
  },
];

export default function HowItWorks() {
  return (
    <section className="border-t border-[#1d1e24] pb-16 pt-12">
      <div className="mb-[26px] font-mono text-[10.5px] uppercase tracking-[.12em] text-[#5e6070]">
        How a booking runs on VenueDash
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-4 md:gap-0">
        {STEPS.map((step, i) => (
          <div key={step.n} className={i < STEPS.length - 1 ? "md:pr-[14px]" : ""}>
            <div className="mb-[10px] flex items-center gap-[10px]">
              <div className="min-w-5 font-mono text-[11px] font-semibold text-owner-accent">
                {step.n}
              </div>
              {i < STEPS.length - 1 && (
                <div className="hidden flex-1 border-t-[1.5px] border-dashed border-[#2c2d35] md:block" />
              )}
            </div>
            <div className="mb-[5px] text-[13.5px] font-semibold">{step.title}</div>
            <div className="text-xs leading-relaxed text-owner-muted">{step.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
