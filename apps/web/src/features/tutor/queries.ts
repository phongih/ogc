import type { IiosGrantedContext } from "@ogc/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LessonContext } from "@ogc/contracts";
import { tutor } from "../../lib/api";
// Rename/delete are synthetic, in-memory conveniences on the tutor store. They are kept
// OFF the shared TutorPort contract on purpose (the contract is preserved as-is).
import { tutorStore } from "../../lib/adapters/store";
import { ogcAccountOf } from "../../lib/adapters/viewer";

export const useConversations = (viewer: IiosGrantedContext) =>
  useQuery({
    queryKey: ["tutor", "list", viewer],
    queryFn: () => tutor.listConversations(viewer),
    enabled: !!viewer,
  });

export const useConversation = (viewer: IiosGrantedContext, conversationId: string) =>
  useQuery({
    queryKey: ["tutor", "conv", viewer, conversationId],
    queryFn: () => tutor.getConversation(viewer, conversationId),
    enabled: !!viewer && conversationId.length > 0,
  });

export const useSuggestedPrompts = (viewer: IiosGrantedContext) =>
  useQuery({
    queryKey: ["tutor", "prompts"],
    queryFn: () => tutor.suggestedPrompts(),
    enabled: !!viewer,
  });

export function useSendMessage(viewer: IiosGrantedContext, conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => tutor.send(viewer, conversationId, text),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tutor", "conv", viewer, conversationId] }),
  });
}

export function useCreateConversation(viewer: IiosGrantedContext) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { title: string; lessonContext?: LessonContext | null }) =>
      tutor.createConversation(viewer, args.title, args.lessonContext ?? null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tutor", "list", viewer] }),
  });
}

export function useRenameConversation(viewer: IiosGrantedContext) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; title: string }) =>
      tutorStore.rename(ogcAccountOf(viewer), args.id, args.title),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tutor", "list", viewer] }),
  });
}

export function useDeleteConversation(viewer: IiosGrantedContext) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => tutorStore.remove(ogcAccountOf(viewer), id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tutor"] }),
  });
}
