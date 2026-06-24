/**
 * Project + bits domain API - thin typed functions over the one client (§12.1,
 * §14.2). One file per backend domain; never calls axios/fetch directly. Bits
 * hang off the project resource; the project's detail read returns the project
 * plus its bits (spec — project context grounding).
 */
import { apiDelete, apiGet, apiPatch, apiPost } from "./index";
import type {
  CreateBitInput,
  CreateProjectInput,
  Project,
  ProjectBit,
  ProjectWithBits,
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
