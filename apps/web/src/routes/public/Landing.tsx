import { Link } from "react-router-dom";
import { Button } from "../../ui";

export function Landing() {
  return (
    <main id="main" className="mx-auto max-w-5xl px-4 py-16">
      <section className="text-center">
        <p className="text-sm font-medium text-brand">OGC Learning</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
          An AI-native English learning platform
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted">
          Courses, teachers and an AI tutor for language centers — organized by organization, brand
          and center. This is a non-production preview running on synthetic data.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/login">
            <Button>Enter the workspace</Button>
          </Link>
          <a href="#features">
            <Button variant="ghost">Learn more</Button>
          </a>
        </div>
      </section>

      <section id="features" className="mt-16 grid gap-4 sm:grid-cols-3">
        {[
          ["Multi-tenant by design", "Organization is the tenant root; brands and centers sit beneath it."],
          ["Teacher & learner workspaces", "Role-based views for everyday teaching and study."],
          ["AI Tutor", "Guided practice with an AI tutor (mock provider in this preview)."],
        ].map(([title, body]) => (
          <div key={title} className="rounded-ogc border border-border bg-surface p-5">
            <h2 className="font-medium">{title}</h2>
            <p className="mt-2 text-sm text-muted">{body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
