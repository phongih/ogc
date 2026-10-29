import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LessonContext } from "@ogc/contracts";
import { tutor } from "../../lib/api";

export const useConversations = (personaId: string) =>
  useQuery({
    queryKey: ["tutor", "list", personaId],
    queryFn: () => tutor.listConversations(personaId),
    enabled: personaId.length > 0,
  });

export const useConversation = (personaId: string, conversationId: string) =>
  useQuery({
    queryKey: ["tutor", "conv", personaId, conversationId],
    queryFn: () => tutor.getConversation(personaId, conversationId),
    enabled: personaId.length > 0 && conversationId.length > 0,
  });

export const useSuggestedPrompts = (personaId: string) =>
  useQuery({
    queryKey: ["tutor", "prompts"],
    queryFn: () => tutor.suggestedPrompts(),
    enabled: personaId.length > 0,
  });

export function useSendMessage(personaId: string, conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => tutor.send(personaId, conversationId, text),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tutor", "conv", personaId, conversationId] }),
  });
}

export function useCreateConversation(personaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { title: string; lessonContext?: LessonContext | null }) =>
      tutor.createConversation(personaId, args.title, args.lessonContext ?? null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tutor", "list", personaId] }),
  });
}
