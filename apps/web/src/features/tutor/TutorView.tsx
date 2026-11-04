import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { useSession } from "../../app/session";
import {
  useConversation,
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useRenameConversation,
  useSendMessage,
  useSuggestedPrompts,
} from "./queries";

export function TutorView() {
  const { session } = useSession();
  const personaId = session?.personaId ?? "";
  const { convId } = useParams();
  const navigate = useNavigate();
  const list = useConversations(personaId);
  const activeId = convId ?? list.data?.[0]?.id ?? "";
  const conv = useConversation(personaId, activeId);
  const prompts = useSuggestedPrompts(personaId);
  const send = useSendMessage(personaId, activeId);
  const create = useCreateConversation(personaId);
  const rename = useRenameConversation(personaId);
  const del = useDeleteConversation(personaId);
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const submit = (value: string) => {
    const v = value.trim();
    if (!v || send.isPending || !activeId) return;
    send.mutate(v);
    setText("");
  };

  const startNew = () => {
    if (create.isPending) return;
    const n = (list.data?.length ?? 0) + 1;
    create.mutate(
      { title: `New conversation ${n}`, lessonContext: null },
      { onSuccess: (c) => navigate(`/app/tutor/${c.id}`) },
    );
  };

  return (
    <section className="space-y-6">
      <PageHeader title="AI Tutor" subtitle="Deterministic mock provider · no external LLM · synthetic history" />
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <nav aria-label="Conversations" className="space-y-2">
          <Button variant="ghost" className="w-full" onClick={startNew} disabled={create.isPending}>
            + New conversation
          </Button>
          {list.isLoading ? (
            <Spinner label="Loading conversations" />
          ) : (list.data ?? []).length === 0 ? (
            <p className="px-1 text-xs text-muted">No conversations yet.</p>
          ) : (
            (list.data ?? []).map((c) => (
              <div
                key={c.id}
                className={`rounded-ogc border px-2 py-1.5 ${
                  c.id === activeId ? "border-brand bg-surface" : "border-border"
                }`}
              >
                {editingId === c.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      rename.mutate(
                        { id: c.id, title: draftTitle.trim() || c.title },
                        { onSuccess: () => setEditingId(null) },
                      );
                    }}
                  >
                    <input
                      autoFocus
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onBlur={() => setEditingId(null)}
                      aria-label={`Rename ${c.title}`}
                      className="w-full rounded-ogc border border-border bg-surface px-2 py-1 text-sm"
                    />
                  </form>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => navigate(`/app/tutor/${c.id}`)}
                      className="flex-1 truncate text-left text-sm"
                    >
                      {c.title}
                    </button>
                    <button
                      aria-label={`Rename ${c.title}`}
                      onClick={() => {
                        setEditingId(c.id);
                        setDraftTitle(c.title);
                      }}
                      className="text-xs text-muted hover:text-fg"
                    >
                      Rename
                    </button>
                    <button
                      aria-label={`Delete ${c.title}`}
                      onClick={() =>
                        del.mutate(c.id, {
                          onSuccess: () => {
                            if (c.id === activeId) navigate("/app/tutor");
                          },
                        })
                      }
                      className="text-xs text-danger hover:opacity-80"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </nav>

        <div className="space-y-3">
          {conv.isLoading ? (
            <Spinner label="Loading conversation" />
          ) : conv.isError ? (
            <ErrorState message="Could not load the conversation." onRetry={() => conv.refetch()} />
          ) : !conv.data ? (
            <EmptyState title="Select or start a conversation" />
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
                {conv.data.messages.length === 0 ? (
                  <li className="text-sm text-muted">Start by asking a question below.</li>
                ) : null}
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
