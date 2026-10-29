import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tutor } from "../../lib/api";

export const useConversations = (personaId: string) =>
  useQuery({ queryKey: ["tutor", "list", personaId], queryFn: () => tutor.listConversations(personaId) });

export const useConversation = (conversationId: string) =>
  useQuery({
    queryKey: ["tutor", "conv", conversationId],
    queryFn: () => tutor.getConversation(conversationId),
    enabled: conversationId.length > 0,
  });

export const useSuggestedPrompts = (conversationId: string) =>
  useQuery({
    queryKey: ["tutor", "prompts", conversationId],
    queryFn: () => tutor.suggestedPrompts(conversationId),
    enabled: conversationId.length > 0,
  });

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => tutor.send(conversationId, text),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tutor", "conv", conversationId] }),
  });
}
