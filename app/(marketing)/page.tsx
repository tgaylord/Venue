import Header from "./_components/Header";
import Hero from "./_components/Hero";
import ProblemCards from "./_components/ProblemCards";
import HowItWorks from "./_components/HowItWorks";
import PricingCta from "./_components/PricingCta";
import Footer from "./_components/Footer";

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-[960px] px-8">
      <Header />
      <Hero />
      <ProblemCards />
      <HowItWorks />
      <PricingCta />
      <Footer />
    </div>
  );
}
