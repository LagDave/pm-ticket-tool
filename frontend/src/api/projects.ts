/**
 * Project + bits domain API - thin typed functions over the one client (§12.1,
 * §14.2). One file per backend domain; never calls axios/fetch directly. Bits
 * hang off the project resource; the project's detail read returns the project
 * plus its bits (spec — project context grounding).
 */
import { apiDelete, apiGet, apiPatch, apiPost } from "./index";
import type {
  BitPrompt,
  CandidateBit,
  CreateBitInput,
  CreateProjectInput,
  ImportResult,
  Project,
  ProjectBit,
  ProjectWithBits,
  ReconciliationPlan,
  Resolution,
  UpdateBitInput,
  UpdateProjectInput,
} from "../types/project";

/** GET /projects - the caller's projects. */
export async function listProjects(): Promise<Project[]> {
  return apiGet<Project[]>("/projects");
}

/** GET /projects/:id - one project the caller owns, plus its bits. */
export async function getProject(id: number): Promise<ProjectWithBits> {
  return apiGet<ProjectWithBits>(`/projects/${id}`);
}

/** POST /projects - create a project → the new project. */
export async function createProject(
  input: CreateProjectInput,
): Promise<Project> {
  return apiPost<Project>("/projects", input);
}

/** PATCH /projects/:id - rename/redescribe a project → the updated project. */
export async function updateProject(
  id: number,
  input: UpdateProjectInput,
): Promise<Project> {
  return apiPatch<Project>(`/projects/${id}`, input);
}

/** DELETE /projects/:id - delete a project the caller owns. Returns the deleted id. */
export async function deleteProject(id: number): Promise<{ id: number }> {
  return apiDelete<{ id: number }>(`/projects/${id}`);
}

/** GET /projects/:id/bits - the project's bits. */
export async function listBits(projectId: number): Promise<ProjectBit[]> {
  return apiGet<ProjectBit[]>(`/projects/${projectId}/bits`);
}

/** POST /projects/:id/bits - add a single manual bit → the new bit. */
export async function createBit(
  projectId: number,
  input: CreateBitInput,
): Promise<ProjectBit> {
  return apiPost<ProjectBit>(`/projects/${projectId}/bits`, input);
}

/** PATCH /projects/:id/bits/:bitId - edit a bit → the updated bit. */
export async function updateBit(
  projectId: number,
  bitId: number,
  input: UpdateBitInput,
): Promise<ProjectBit> {
  return apiPatch<ProjectBit>(`/projects/${projectId}/bits/${bitId}`, input);
}

/** DELETE /projects/:id/bits/:bitId - delete a bit. Returns the deleted id. */
export async function deleteBit(
  projectId: number,
  bitId: number,
): Promise<{ id: number }> {
  return apiDelete<{ id: number }>(`/projects/${projectId}/bits/${bitId}`);
}

/**
 * POST /projects/:id/bits/reconcile - diff incoming candidates against the
 * project's active bits → a reconciliation plan. No writes happen here; the PM
 * resolves the plan, then calls applyResolutions (spec T11/T9).
 */
export async function reconcileBits(
  projectId: number,
  candidates: CandidateBit[],
): Promise<ReconciliationPlan> {
  return apiPost<ReconciliationPlan>(`/projects/${projectId}/bits/reconcile`, {
    candidates,
  });
}

/**
 * POST /projects/:id/bits/apply - apply the PM-confirmed resolutions for the
 * given candidates → the resulting project bits. Multi-row write, transactional
 * on the server (spec T9).
 */
export async function applyResolutions(
  projectId: number,
  candidates: CandidateBit[],
  resolutions: Resolution[],
): Promise<ProjectBit[]> {
  return apiPost<ProjectBit[]>(`/projects/${projectId}/bits/apply`, {
    candidates,
    resolutions,
  });
}

/**
 * POST /projects/:id/bits/import - submit the parsed import bits. Returns a
 * tagged union (spec T10): additive imports come back as `{ mode: "reconcile",
 * plan }` for the PM to resolve; a forced import has already replaced the bits
 * server-side and comes back as `{ mode: "applied", bits }`, so the caller skips
 * the resolve step (spec T11).
 */
export async function importBits(
  projectId: number,
  bits: CandidateBit[],
  force = false,
): Promise<ImportResult> {
  return apiPost<ImportResult>(`/projects/${projectId}/bits/import`, {
    bits,
    force,
  });
}

/**
 * GET /projects/:id/bit-prompt - the server-owned generate-bits prompt to paste
 * into a separate Claude Code session run against the app's repo (spec T10/T11).
 */
export async function getBitPrompt(projectId: number): Promise<BitPrompt> {
  return apiGet<BitPrompt>(`/projects/${projectId}/bit-prompt`);
}
