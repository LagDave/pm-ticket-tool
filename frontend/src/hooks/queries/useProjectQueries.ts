/**
 * React Query hooks for the project + bits domain (§14.3, §15.1). Data-fetching
 * lives here, not inline in components. Each hook calls the api/ domain function,
 * then surfaces errors through the shared toast (§16.3). Server state is React
 * Query, never mirrored into useState (§15.1). Mirrors useTicketQueries /
 * useInterviewSessionQueries.
 *
 * The project detail (useProject) carries the project AND its bits, so every bit
 * mutation invalidates that one project key to refresh the grouped list.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  applyResolutions,
  createBit,
  createProject,
  deleteBit,
  deleteProject,
  getBitPrompt,
  getProject,
  importBits,
  listProjects,
  reconcileBits,
  updateBit,
  updateProject,
} from "../../api/projects";
import type { ApiError } from "../../api";
import { QUERY_KEYS } from "../../lib/queryClient";
import { toast } from "../../lib/toast";
import type {
  ApplyResolutionsInput,
  BitPrompt,
  CandidateBit,
  CreateBitInput,
  CreateProjectInput,
  ImportBitsInput,
  ImportResult,
  Project,
  ProjectBit,
  ProjectWithBits,
  ReconciliationPlan,
  UpdateBitInput,
  UpdateProjectInput,
} from "../../types/project";

/** The owner's projects list - used by the manager screen and the interview picker. */
export function useProjects() {
  return useQuery<Project[], ApiError>({
    queryKey: QUERY_KEYS.projects(),
    queryFn: () => listProjects(),
  });
}

/** Fetch one project + its bits; disabled until an id is present. */
export function useProject(id: number | null) {
  return useQuery<ProjectWithBits, ApiError>({
    queryKey: QUERY_KEYS.project(id ?? 0),
    queryFn: () => getProject(id as number),
    enabled: id !== null && id > 0,
  });
}

/** Create a project, refresh the list, and surface failures via toast (§16.1/§16.3). */
export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation<Project, ApiError, CreateProjectInput>({
    mutationFn: (input) => createProject(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.projects() });
      toast.success("Project created.");
    },
    onError: (error) => {
      toast.error(error.message || "Could not create the project.");
    },
  });
}

/** Rename/redescribe a project; refresh the list + the project detail. */
export function useUpdateProject(id: number | null) {
  const queryClient = useQueryClient();
  return useMutation<Project, ApiError, UpdateProjectInput>({
    mutationFn: (input) => updateProject(id as number, input),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.projects() });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.project(project.id) });
      toast.success("Project saved.");
    },
    onError: (error) => {
      toast.error(error.message || "Could not save the project.");
    },
  });
}

/**
 * Delete a project. Drops its detail cache and refreshes the list so the row
 * disappears; toasts success/failure.
 */
export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation<{ id: number }, ApiError, number>({
    mutationFn: (id) => deleteProject(id),
    onSuccess: ({ id }) => {
      queryClient.removeQueries({ queryKey: QUERY_KEYS.project(id) });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.projects() });
      toast.success("Project deleted.");
    },
    onError: (error) => {
      toast.error(error.message || "Could not delete the project.");
    },
  });
}

/** Add a single manual bit; refresh the project detail so the grouped list updates. */
export function useCreateBit(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<ProjectBit, ApiError, CreateBitInput>({
    mutationFn: (input) => createBit(projectId as number, input),
    onSuccess: (bit) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.project(bit.project_id) });
      toast.success("Bit added.");
    },
    onError: (error) => {
      toast.error(error.message || "Could not add the bit.");
    },
  });
}

/** Edit a bit; refresh the project detail. */
export function useUpdateBit(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<ProjectBit, ApiError, { bitId: number; input: UpdateBitInput }>({
    mutationFn: ({ bitId, input }) => updateBit(projectId as number, bitId, input),
    onSuccess: (bit) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.project(bit.project_id) });
      toast.success("Bit saved.");
    },
    onError: (error) => {
      toast.error(error.message || "Could not save the bit.");
    },
  });
}

/** Delete a bit; refresh the project detail so the row disappears. */
export function useDeleteBit(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<{ id: number }, ApiError, number>({
    mutationFn: (bitId) => deleteBit(projectId as number, bitId),
    onSuccess: () => {
      if (projectId !== null) {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.project(projectId) });
      }
      toast.success("Bit deleted.");
    },
    onError: (error) => {
      toast.error(error.message || "Could not delete the bit.");
    },
  });
}

/**
 * Fetch the server-owned generate-bits prompt for a project. Enabled-gated so it
 * only fetches when the prompt popup is open (the caller passes `enabled`), and
 * disabled until an id is present (§15.1).
 */
export function useBitPrompt(projectId: number | null, enabled: boolean) {
  return useQuery<BitPrompt, ApiError>({
    queryKey: QUERY_KEYS.bitPrompt(projectId ?? 0),
    queryFn: () => getBitPrompt(projectId as number),
    enabled: enabled && projectId !== null && projectId > 0,
  });
}

/**
 * Diff incoming candidates against the project's active bits → a plan to resolve.
 * No writes happen here, so there is nothing to invalidate; failures toast (§16.3).
 */
export function useReconcileBits(projectId: number | null) {
  return useMutation<ReconciliationPlan, ApiError, CandidateBit[]>({
    mutationFn: (candidates) => reconcileBits(projectId as number, candidates),
    onError: (error) => {
      toast.error(error.message || "Could not reconcile the bits.");
    },
  });
}

/**
 * Submit a parsed import. The result is a tagged union: a `reconcile` result
 * just hands back a plan for the PM to resolve (nothing written yet, so no
 * invalidation); an `applied` result means a forced import already replaced the
 * bits, so refresh the project detail and toast. Failures toast (§16.3).
 */
export function useImportBits(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<ImportResult, ApiError, ImportBitsInput>({
    mutationFn: (input) => importBits(projectId as number, input.bits, input.force),
    onSuccess: (result) => {
      if (result.mode === "applied" && projectId !== null) {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.project(projectId) });
        toast.success("Bits imported.");
      }
    },
    onError: (error) => {
      toast.error(error.message || "Could not import the bits.");
    },
  });
}

/**
 * Apply the PM-confirmed resolutions → the resulting bits. A multi-row write, so
 * refresh the project detail and toast; failures toast (§16.3).
 */
export function useApplyResolutions(projectId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<ProjectBit[], ApiError, ApplyResolutionsInput>({
    mutationFn: (input) =>
      applyResolutions(projectId as number, input.candidates, input.resolutions),
    onSuccess: () => {
      if (projectId !== null) {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.project(projectId) });
      }
      toast.success("Bits updated.");
    },
    onError: (error) => {
      toast.error(error.message || "Could not apply the changes.");
    },
  });
}
