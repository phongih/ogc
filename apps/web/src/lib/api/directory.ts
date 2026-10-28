// Single seam where the app selects an adapter for the OgcDirectoryPort contract.
// Swap `mockDirectory` for a governed backend adapter later without touching features.
import type { OgcDirectoryPort } from "@ogc/contracts";
import { mockDirectory } from "../adapters/mockDirectory";

export const directory: OgcDirectoryPort = mockDirectory;
