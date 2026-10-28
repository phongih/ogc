import { useQuery } from "@tanstack/react-query";
import { directory } from "../../lib/api/directory";

export const useOrganizations = () =>
  useQuery({ queryKey: ["orgs"], queryFn: () => directory.listOrganizations() });

export const useOrganization = (orgId: string) =>
  useQuery({ queryKey: ["org", orgId], queryFn: () => directory.getOrganization(orgId) });

export const useBrands = (orgId: string) =>
  useQuery({ queryKey: ["brands", orgId], queryFn: () => directory.listBrands(orgId) });

export const useCenters = (orgId: string, brandId?: string) =>
  useQuery({
    queryKey: ["centers", orgId, brandId ?? "all"],
    queryFn: () => directory.listCenters(orgId, brandId),
  });

export const useCenter = (centerId: string) =>
  useQuery({ queryKey: ["center", centerId], queryFn: () => directory.getCenter(centerId) });
