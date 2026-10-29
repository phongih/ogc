import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { useSession } from "../../app/session";
import { useConversation, useConversations, useSendMessage, useSuggestedPrompts } from "./queries";

export function TutorView() {
  const { session } = useSession();
  const { convId } = useParams();
  const navigate = useNavigate();
  const list = useConversations(session?.personaId ?? "");
  const activeId = convId ?? list.data?.[0]?.id ?? "";
  const conv = useConversation(activeId);
  const prompts = useSuggestedPrompts(activeId);
  const send = useSendMessage(activeId);
  const [text, setText] = useState("");

  const submit = (value: string) => {
    const v = value.trim();
    if (!v || send.isPending) return;
    send.mutate(v);
    setText("");
  };

  return (
    <section className="space-y-6">
      <PageHeader title="AI Tutor" subtitle="Deterministic mock provider · no external LLM · synthetic history" />
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <nav aria-label="Conversations" className="space-y-2">
          {list.isLoading ? (
            <Spinner label="Loading conversations" />
          ) : (
            (list.data ?? []).map((c) => (
              <button
                key={c.id}
                onClick={() => navigate(`/app/tutor/${c.id}`)}
                className={`block w-full rounded-ogc border px-3 py-2 text-left text-sm ${
                  c.id === activeId ? "border-brand bg-surface" : "border-border hover:bg-surface"
                }`}
              >
                {c.title}
              </button>
            ))
          )}
        </nav>

        <div className="space-y-3">
          {conv.isLoading ? (
            <Spinner label="Loading conversation" />
          ) : conv.isError ? (
            <ErrorState message="Could not load the conversation." onRetry={() => conv.refetch()} />
          ) : !conv.data ? (
            <EmptyState title="Select a conversation" />
          ) : (
            <>
              {conv.data.lessonContext ? (
                <p className="rounded-ogc border border-border bg-surface px-3 py-2 text-xs text-muted">
                  Lesson context: {conv.data.lessonContext.title}
                </p>
              ) : null}
              <ul className="space-y-2" aria-live="polite">
                {conv.data.messages.map((m) => (
                  <li key={m.id} className={m.role === "learner" ? "text-right" : ""}>
                    <Card
                      className={`inline-block max-w-[85%] text-left ${
                        m.role === "tutor" ? "bg-surface" : "border-brand/40"
                      }`}
                    >
                      <p className="text-xs text-muted">{m.role === "tutor" ? "AI Tutor" : "You"}</p>
                      <p className="mt-1 text-sm">{m.text}</p>
                    </Card>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap gap-2">
                {(prompts.data ?? []).map((p) => (
                  <Button key={p} variant="ghost" onClick={() => submit(p)}>
                    {p}
                  </Button>
                ))}
              </div>

              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(text);
                }}
              >
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  aria-label="Message the tutor"
                  placeholder="Ask the tutor…"
                  className="flex-1 rounded-ogc border border-border bg-surface px-3 py-2 text-sm"
                />
                <Button type="submit" disabled={send.isPending}>
                  Send
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
