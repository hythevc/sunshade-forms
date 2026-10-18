const steps = ["Conversational forms", "Consent-aware contacts", "Segments", "Campaign drafts", "Safe agent access"];

const Index = () => (
  <div className="min-h-screen bg-background">
    <header className="container flex items-center justify-between py-6">
      <span className="font-display text-2xl">Sunshade</span>
      <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">Private beta</span>
    </header>
    <main className="container py-20">
      <h1 className="font-display max-w-3xl text-5xl leading-tight md:text-6xl">
        Forms, audience and campaign drafts — <span className="text-primary">one quiet workspace</span> for small marketing teams.
      </h1>
      <p className="mt-6 max-w-xl text-lg text-muted-foreground">
        Collect answers, keep consent records honest, build segments and draft campaigns without stacking five subscriptions.
      </p>
      <ol className="mt-12 grid gap-3 md:grid-cols-5">
        {steps.map((s, i) => (
          <li key={s} className="rounded-lg border bg-card p-4 shadow-sm">
            <span className="text-xs text-muted-foreground">0{i + 1}</span>
            <p className="mt-1 font-medium">{s}</p>
          </li>
        ))}
      </ol>
      <p className="mt-10 text-sm text-muted-foreground">Email delivery and paid plans are not connected yet.</p>
    </main>
  </div>
);

export default Index;
