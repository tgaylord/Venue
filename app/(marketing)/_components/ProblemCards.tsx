const CARDS = [
  {
    problem: '"We agreed over DM"',
    pain: "A verbal agreement won't hold up when a renter's guest cracks your cyc wall.",
    solution:
      "every booking generates a Georgia venue agreement, signed before anyone gets a key.",
  },
  {
    problem: 'Camera-roll "evidence"',
    pain: "Photos with no verified timestamp are your word against theirs.",
    solution:
      "a guided pre/post walkthrough — every photo server-timestamped, geotagged, and locked.",
  },
  {
    problem: "Deposit chaos",
    pain: "Who paid, who got refunded, and what were the terms? It's scattered across three text threads.",
    solution:
      "your deposit terms printed in the contract and the deposit's status tracked on every booking — you collect it the way you already do.",
  },
];

export default function ProblemCards() {
  return (
    <section className="grid grid-cols-1 gap-[14px] pb-16 md:grid-cols-3">
      {CARDS.map((card) => (
        <div key={card.problem} className="rounded-xl border border-[#23242b] bg-[#14151a] p-[22px]">
          <div className="mb-[10px] font-mono text-[10px] uppercase tracking-[.1em] text-[#e46a5a]">
            The problem
          </div>
          <div className="mb-2 text-[15px] font-semibold">{card.problem}</div>
          <p className="mb-[14px] text-[12.5px] leading-relaxed text-owner-muted">{card.pain}</p>
          <div className="border-t border-[#23242b] pt-3 text-[12.5px] leading-relaxed text-[#c9cad2]">
            <span className="font-semibold text-success">VenueDash:</span> {card.solution}
          </div>
        </div>
      ))}
    </section>
  );
}
